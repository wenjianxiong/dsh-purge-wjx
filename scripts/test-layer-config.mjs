import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseLayers, selectLayers, layerText } from "../lib/inject-layers.js";
import { readInjectLayers, setInjectLayers, layerConfigPath } from "../lib/rules.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "layers-"));
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n));

console.log("配置读写：");
t("缺文件回退 all", readInjectLayers(tmp) === "all");
await setInjectLayers(tmp, ["core", "tools"]);
t("写入后读回数组", JSON.stringify(readInjectLayers(tmp)) === '["core","tools"]');
t("配置文件落在 purge 子目录", layerConfigPath(tmp).endsWith(path.join("purge", "inject-layers.json")));
await setInjectLayers(tmp, "all");
t("显式 all 归一为字符串", readInjectLayers(tmp) === "all");
await setInjectLayers(tmp, ["  core  ", "core", ""]);
t("去空白去重", JSON.stringify(readInjectLayers(tmp)) === '["core"]');
await setInjectLayers(tmp, null);
t("null 等价 all", readInjectLayers(tmp) === "all");
fs.writeFileSync(layerConfigPath(tmp), "{ 坏 JSON", "utf8");
t("坏 JSON 回退 all", readInjectLayers(tmp) === "all");
fs.writeFileSync(layerConfigPath(tmp), '{"layers":[]}', "utf8");
t("空数组回退 all", readInjectLayers(tmp) === "all");

console.log("带标记的来源：");
const src = [
  "# 基础规则",
  "始终生效",
  "<!-- purge:layer web -->",
  "## Web 渗透",
  "注入探测",
  "<!-- /purge:layer -->",
  "<!-- purge:layer ctf -->",
  "## CTF",
  "解题",
  "<!-- /purge:layer -->",
].join("\n");
const p = parseLayers(src);
t("识别出 3 层", JSON.stringify(p.names) === '["core","web","ctf"]');
t("全量保留全部正文", selectLayers(p, "all").text === p.clean);
t("全量含 web 正文", p.clean.includes("注入探测"));
t("只选 web：有 web 正文、无 ctf 正文", (() => {
  const s = selectLayers(p, ["web"]);
  return s.text.includes("注入探测") && !s.text.includes("解题");
})());
t("只选 core：两层正文都不在", (() => {
  const s = selectLayers(p, ["core"]);
  return !s.text.includes("注入探测") && !s.text.includes("解题") && s.text.includes("始终生效");
})());
t("layerText 取 web", layerText(p, "web").includes("注入探测"));
t("任意选择下基础规则都在", ["all", ["web"], ["ctf"], ["core"]].every((sel) =>
  selectLayers(p, sel).text.includes("始终生效")));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exitCode = fail ? 1 : 0;
