import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_LAYERS,
  DOMAIN_LAYERS,
  FAMILY_LAYERS,
  GENERAL,
  classifyTask,
  pruneForFamily,
  routeLayers,
} from "../../lib/task-router.js";

const ALL = ["core", "refusal", "eng", "ctf", "route.re", "route.web", "route.ir", "web", "ir"];
const MY_LAYER = "my-custom-layer";

test("BASE_LAYERS 就是常驻三件", () => {
  assert.deepEqual(BASE_LAYERS, ["core", "refusal", "eng"]);
});

test("通用族不裁：认不出任务时全留", () => {
  assert.deepEqual(pruneForFamily(ALL, GENERAL), ALL);
  assert.deepEqual(pruneForFamily(ALL, undefined), ALL);
  assert.deepEqual(pruneForFamily(ALL, null), ALL);
  assert.deepEqual(pruneForFamily(ALL, "不存在族"), ALL);
});

test("认得出的族只留常驻层 + 自己的专层", () => {
  assert.deepEqual(pruneForFamily(ALL, "re"), ["core", "refusal", "eng", "route.re"]);
  assert.deepEqual(pruneForFamily(ALL, "web"), ["core", "refusal", "eng", "route.web", "web"]);
  assert.deepEqual(pruneForFamily(ALL, "ctf"), ["core", "refusal", "eng", "ctf"]);
  assert.deepEqual(pruneForFamily(ALL, "ir"), ["core", "refusal", "eng", "route.ir", "ir"]);
});

test("专层内容不在正文里时不裁，避免族认对却把内容裁空", () => {
  // 只有 ctf 层存在，没有 route.ctf；ctf 族的专层表是 ["route.ctf","ctf"]，ctf 在 → 正常裁
  assert.deepEqual(pruneForFamily(["core", "refusal", "eng", "ctf", "web"], "ctf"), [
    "core",
    "refusal",
    "eng",
    "ctf",
  ]);
  // 只有 web 层，却按 re 族裁：re 的专层 route.re 不在正文里 → 放弃裁剪
  const layers = ["core", "refusal", "eng", "web"];
  assert.deepEqual(pruneForFamily(layers, "re"), layers);
});

test("用户自定义层永不被裁", () => {
  const layers = ["core", "refusal", "eng", "web", MY_LAYER];
  for (const fam of [GENERAL, "re", "web", "ctf", "ir"]) {
    assert.ok(pruneForFamily(layers, fam).includes(MY_LAYER), `${fam} 把自定义层裁掉了`);
    assert.ok(pruneForFamily(layers, fam).includes("core"), `${fam} 把常驻层裁掉了`);
  }
});

test("领域层表与专层表名字对得上", () => {
  // DOMAIN_LAYERS 允许别名（pentest / redteam 归 web），所以只要求：
  // 每个值指向一个真实任务族，且该族的专层里至少有同名层或它的归属层之一。
  for (const [name, fam] of Object.entries(DOMAIN_LAYERS)) {
    assert.ok(FAMILY_LAYERS[fam], `DOMAIN_LAYERS 里的 ${name} 指向未定义的任务族 ${fam}`);
    const own = routeLayers(fam);
    const covered = own.includes(name) || Object.keys(DOMAIN_LAYERS).some((alias) => own.includes(alias) && DOMAIN_LAYERS[alias] === fam);
    assert.ok(covered, `${name} 归属 ${fam}，但 ${fam} 的专层 ${JSON.stringify(own)} 覆盖不到它`);
  }
});

test("分类：逆向 / 卡密", () => {
  for (const q of ["这个卡密怎么破", "帮我写个注册机", "把这个 APK 脱壳看看什么算法", "去授权"]) {
    assert.equal(classifyTask(q), "re", q);
  }
});

test("分类：web 渗透", () => {
  for (const q of ["打点 www.example.com 拿后台", "找一下注入点", "目录爆破"]) {
    assert.equal(classifyTask(q), "web", q);
  }
});

test("分类：二进制 / 溢出归入赛题族（pwn 打法在 ctf 层）", () => {
  for (const q of ["把这个溢出打穿拿 shell", "栈溢出怎么利用", "用 ROP 绕过 NX"]) {
    assert.equal(classifyTask(q), "ctf", q);
  }
});

test("分类：应急响应", () => {
  for (const q of ["把这段日志里的后门找出来", "排查一下这个木马", "查杀 webshell"]) {
    assert.equal(classifyTask(q), "ir", q);
  }
});

test("分类：普通工程任务保持 general", () => {
  for (const q of ["改一下这个页面的样式", "又得更新 dsh-purge，提示词清洗不行了", "今天吃什么"]) {
    assert.equal(classifyTask(q), GENERAL, q);
  }
});

test("空输入一律 general", () => {
  for (const q of ["", "   ", null, undefined]) {
    assert.equal(classifyTask(q), GENERAL);
  }
});
