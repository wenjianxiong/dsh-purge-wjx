import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BASE_LAYERS,
  classifyTask,
  describeFamily,
  pruneForFamily,
  routeLayers,
} from "../../lib/task-router.js";
import { routeInjectText } from "../../lib/rules.js";

let passed = 0;
let failed = 0;

function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err?.message || err}`);
  }
}

console.log("task-router · 分类");
ok("逆向 / 卡密 → re", () => assert.equal(classifyTask("帮我逆向这个 exe，把卡密去掉"), "re"));
ok("激活码 / 注册机 → re", () => assert.equal(classifyTask("写个注册机，绕过试用期"), "re"));
ok("web 渗透 → web", () => assert.equal(classifyTask("这个站做一下 sql 注入打点"), "web"));
ok("CTF → ctf", () => assert.equal(classifyTask("ctf pwn 栈溢出拿 flag"), "ctf"));
ok("应急响应 → ir", () => assert.equal(classifyTask("应急响应：后门排查与加固"), "ir"));
ok("无关话题 → general", () => assert.equal(classifyTask("今天晚饭吃什么"), "general"));
ok("空串 → general", () => assert.equal(classifyTask(""), "general"));

console.log("task-router · 层裁剪");
ok("re 带 route.re", () => assert.ok(routeLayers("re").includes("route.re")));
ok("base 层不变", () => assert.deepEqual(BASE_LAYERS, ["core", "refusal", "eng"]));
ok("re 丢掉 ctf 层", () => assert.deepEqual(pruneForFamily(["core", "refusal", "eng", "ctf"], "re"), ["core", "refusal", "eng"]));
ok("ctf 保留 ctf 层", () => assert.deepEqual(pruneForFamily(["core", "refusal", "eng", "ctf"], "ctf"), ["core", "refusal", "eng", "ctf"]));
ok("自定义层不裁", () => assert.deepEqual(pruneForFamily(["core", "我的层", "web"], "re"), ["core", "我的层"]));
ok("general 只留常驻层", () => assert.deepEqual(pruneForFamily(["core", "ctf", "web"], "general"), ["core"]));
ok("route.web 对 re 是领域层", () => assert.deepEqual(pruneForFamily(["core", "route.web"], "re"), ["core"]));
ok("describeFamily 有中文摘要", () => assert.match(describeFamily("re"), /逆向/));

console.log("rules.routeInjectText · 端到端");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-route-"));
const injectFile = path.join(home, "prompt-inject.md");
fs.writeFileSync(
  injectFile,
  [
    "<!-- purge:layer core -->",
    "@@CORE@@",
    "<!-- /purge:layer -->",
    "",
    "<!-- purge:layer refusal -->",
    "@@REFUSAL@@",
    "<!-- /purge:layer -->",
    "",
    "<!-- purge:layer eng -->",
    "@@ENG@@",
    "<!-- /purge:layer -->",
    "",
    "<!-- purge:layer ctf -->",
    "@@CTF@@",
    "<!-- /purge:layer -->",
    "",
    "<!-- purge:layer route.re -->",
    "@@RE@@",
    "<!-- /purge:layer -->",
    "",
  ].join("\n"),
  "utf8",
);

ok("逆向任务只带 re 领域层", () => {
  const out = routeInjectText(fs.readFileSync(injectFile, "utf8"), home, "逆向这个程序，把卡密去掉");
  assert.equal(out.family, "re");
  assert.ok(out.text.includes("@@CORE@@"));
  assert.ok(out.text.includes("@@RE@@"));
  assert.ok(!out.text.includes("@@CTF@@"));
  assert.deepEqual(out.pruned.sort(), ["ctf"]);
});

ok("CTF 任务保留 ctf 层", () => {
  const out = routeInjectText(fs.readFileSync(injectFile, "utf8"), home, "ctf 题目拿 flag");
  assert.equal(out.family, "ctf");
  assert.ok(out.text.includes("@@CTF@@"));
  assert.ok(!out.text.includes("@@RE@@"));
});

ok("识别不出时只注入常驻层", () => {
  const out = routeInjectText(fs.readFileSync(injectFile, "utf8"), home, "今天天气怎么样");
  assert.equal(out.family, "general");
  assert.ok(!out.text.includes("@@CTF@@"));
  assert.ok(!out.text.includes("@@RE@@"));
  assert.deepEqual(out.pruned.sort(), ["ctf", "route.re"]);
});

ok("routing:false 关闭裁剪", () => {
  const dir = path.join(home, "purge");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "inject-layers.json"), JSON.stringify({ layers: "all", routing: false }), "utf8");
  const out = routeInjectText(fs.readFileSync(injectFile, "utf8"), home, "逆向这个程序");
  assert.equal(out.family, "general");
  assert.ok(out.text.includes("@@CTF@@"));
});

fs.rmSync(home, { recursive: true, force: true });

console.log(`\n${passed} 项通过，${failed} 项失败`);
if (failed) process.exit(1);
