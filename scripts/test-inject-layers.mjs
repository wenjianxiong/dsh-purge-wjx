/**
 * 注入分层的回归测试。用 node:assert，不引依赖。
 * 跑法：node scripts/test-inject-layers.mjs
 */
import assert from "node:assert/strict";
import { parseLayers, selectLayers, isEnabled, layerText } from "../lib/inject-layers.js";
import { analyze, similarity } from "../lib/inject-analyzer.js";

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("解析：");
ok("无标记时整体算 core", () => {
  const r = parseLayers("你好\n\n世界");
  assert.deepEqual(r.names, ["core"]);
  assert.equal(r.layers.length, 1);
  assert.match(r.layers[0].text, /你好/);
});

ok("单层标记正确切出", () => {
  const src = "核心规则\n\n<!-- purge:layer web -->\n渗透内容\n<!-- /purge:layer -->";
  const r = parseLayers(src);
  assert.deepEqual(r.names, ["core", "web"]);
  assert.equal(r.layers[1].text, "渗透内容");
});

ok("多层按出现顺序保留，core 始终第一", () => {
  const src = [
    "<!-- purge:layer web -->",
    "W",
    "<!-- /purge:layer -->",
    "核心",
    "<!-- purge:layer ctf -->",
    "C",
    "<!-- /purge:layer -->",
  ].join("\n");
  const r = parseLayers(src);
  assert.deepEqual(r.names, ["core", "web", "ctf"]);
  assert.equal(r.layers[0].name, "core");
});

ok("未闭合的开标记不丢内容", () => {
  const src = "核心\n\n<!-- purge:layer tail -->\n后半段全部";
  const r = parseLayers(src);
  assert.deepEqual(r.names, ["core", "tail"]);
  assert.equal(r.layers[1].text, "后半段全部");
});

ok("clean 去掉标记但保留全部正文", () => {
  const src = "A\n<!-- purge:layer x -->\nB\n<!-- /purge:layer -->\nC";
  const r = parseLayers(src);
  assert.equal(r.clean.includes("purge:layer"), false);
  for (const piece of ["A", "B", "C"]) assert.ok(r.clean.includes(piece), piece);
});

console.log("选择：");
ok("selected=null 时全量", () => {
  const r = parseLayers("core\n<!-- purge:layer web -->\nW\n<!-- /purge:layer -->");
  const s = selectLayers(r, null);
  assert.equal(s.fallback, false);
  assert.deepEqual(s.kept, ["core", "web"]);
});

ok("只选 core 时丢掉其它层", () => {
  const r = parseLayers("core\n<!-- purge:layer web -->\nW\n<!-- /purge:layer -->");
  const s = selectLayers(r, ["core"]);
  assert.equal(s.kept.includes("web"), false);
  assert.match(s.text, /core/);
  assert.doesNotMatch(s.text, /W$/m);
});

ok("选错层名时保留 core 并报 unmatched", () => {
  const r = parseLayers("core\n<!-- purge:layer web -->\nW\n<!-- /purge:layer -->");
  const s = selectLayers(r, ["nope"]);
  assert.deepEqual(s.kept, ["core"]);
  assert.deepEqual(s.unmatched, ["nope"]);
  assert.equal(s.fallback, false);
});

ok("选对层名时 unmatched 为空", () => {
  const r = parseLayers("core\n<!-- purge:layer web -->\nW\n<!-- /purge:layer -->");
  const s = selectLayers(r, ["web"]);
  assert.deepEqual(s.unmatched, []);
  assert.ok(s.kept.includes("web"));
});

ok("isEnabled 认 all/数组/单值", () => {
  assert.equal(isEnabled("a", "all"), true);
  assert.equal(isEnabled("a", ["a"]), true);
  assert.equal(isEnabled("b", ["a"]), false);
  assert.equal(isEnabled("a", null), true);
});

ok("layerText 取正文", () => {
  const r = parseLayers("core\n<!-- purge:layer web -->\nW\n<!-- /purge:layer -->");
  assert.equal(layerText(r, "web"), "W");
  assert.equal(layerText(r, "nope"), "");
});

console.log("分析器：");
ok("token 估算随长度单调递增", () => {
  const a = analyze("短");
  const b = analyze("短".repeat(100));
  assert.ok(b.tokens > a.tokens);
});

ok("相同文本相似度为 1", () => {
  assert.equal(similarity("完全一样的句子", "完全一样的句子"), 1);
});

ok("无关文本相似度低", () => {
  const s = similarity("今天天气不错适合出门", "数据库索引优化需要考虑回表代价");
  assert.ok(s < 0.2, `got ${s}`);
});

ok("纯分隔块被丢弃", () => {
  const r = analyze("A\n\n═══════════════════\n\nB");
  assert.equal(r.blocks, 2);
});

console.log(`\n${passed} 项通过${process.exitCode ? "（有失败）" : ""}`);
