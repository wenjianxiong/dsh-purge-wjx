#!/usr/bin/env node
// 给 prompt-inject.md 插入 <!-- purge:layer --> 标记，把它切成可开关的层。
//
// 用法：
//   node scripts/split-inject-layers.mjs                 预览（不写文件）
//   node scripts/split-inject-layers.mjs --write         写入（自动备份原文件）
//   node scripts/split-inject-layers.mjs --file PATH     指定目标文件
//   node scripts/split-inject-layers.mjs --plan core=0-59,104-124,refusal=60-79
//                                                        自定义分段（段索引区间）
//
// 默认分段按实测的 125 段结构切：人格+思考模式常驻，红队/工程/CTF 三段按需。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { splitBlocks, estimateTokens } from "../lib/inject-analyzer.js";
import { parseLayers, selectLayers } from "../lib/inject-layers.js";

const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");

function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

const TARGET = argValue("--file") || path.join(HOME, "prompt-inject.md");

// 默认分段：段索引区间 → 层名。数组顺序即文件顺序。
// 依据实测：段 0-59 人格与反注入、60-79 拒绝加固/中文归一/web canned slots、
// 80-93 工程规范与 final answer 风格、94-103 CTF 合约与工具、104-124 思考模式。
const DEFAULT_PLAN = [
  { name: "core", from: 0, to: 59 },
  { name: "refusal", from: 60, to: 79 },
  { name: "eng", from: 80, to: 93 },
  { name: "ctf", from: 94, to: 103 },
  { name: "core", from: 104, to: null },
];

/** 解析 `--plan core=0-59,104-124,refusal=60-79` 形式。 */
function parsePlan(raw) {
  const out = [];
  for (const part of raw.split(",")) {
    const m = /^([A-Za-z0-9_-]+)=(\d+)-(\d+|\*)$/.exec(part.trim());
    if (!m) throw new Error(`--plan 段格式不对: ${part}（要 name=from-to 或 name=from-*）`);
    out.push({ name: m[1], from: Number(m[2]), to: m[3] === "*" ? null : Number(m[3]) });
  }
  return out;
}

const PLAN = argValue("--plan") ? parsePlan(argValue("--plan")) : DEFAULT_PLAN;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) fail(`找不到 ${TARGET}`);

const original = fs.readFileSync(TARGET, "utf8");

if (original.includes("purge:layer")) {
  fail("该文件已含 purge:layer 标记，先清理再跑（避免嵌套）");
}

const blocks = splitBlocks(original);
if (blocks.length === 0) fail("文件里没切出任何段落，检查编码或空行格式");

// 把段索引区间翻译成「在哪一行之前插入标记」。
// 段索引越界时钳到末尾，保证 --plan 写多一个也不炸。
const marks = [];
for (const seg of PLAN) {
  const b = blocks[Math.min(seg.from, blocks.length - 1)];
  if (!b) continue;
  marks.push({ line: b.startLine, name: seg.name, from: seg.from, to: seg.to });
}
marks.sort((a, b) => a.line - b.line);

const lines = original.split("\n");
const out = [];
let mi = 0;
for (let i = 0; i < lines.length; i++) {
  const cur = i + 1;
  while (mi < marks.length && marks[mi].line === cur) {
    if (mi > 0) out.push("<!-- /purge:layer -->");
    out.push(`<!-- purge:layer ${marks[mi].name} -->`);
    mi++;
  }
  out.push(lines[i]);
}
if (mi > 0) out.push("<!-- /purge:layer -->");

const layered = out.join("\n");

// ---- 写出前先自检：标记必须可解析，且分层后正文与原文逐字等价 ----
const parsed = parseLayers(layered);
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
if (norm(parsed.clean) !== norm(original)) {
  fail("自检失败：去标记后的正文与原文不一致，放弃写入");
}

const totalTok = estimateTokens(original);
console.log(`文件: ${TARGET}`);
console.log(`原文: ${original.length} 字符 / 约 ${totalTok} tokens / ${blocks.length} 段`);
console.log("");
console.log("分层结果：");
for (const l of parsed.layers) {
  const tok = estimateTokens(l.text);
  console.log(
    `  ${l.name.padEnd(8)} L${String(l.startLine).padStart(4)}  ${String(l.chars).padStart(6)} 字符  ~${String(tok).padStart(5)} tok  ${((tok / totalTok) * 100).toFixed(1).padStart(5)}%`
  );
}
console.log(`  层名: ${parsed.names.join(", ")}`);
console.log("");

for (const pick of [["core"], ["core", "eng"], "all"]) {
  const sel = selectLayers(parsed, pick);
  const tok = estimateTokens(sel.text);
  const label = pick === "all" ? "all（全量）" : pick.join("+");
  console.log(`  /layers use ${label.padEnd(14)} → ~${String(tok).padStart(5)} tok  (省 ${(100 - (tok / totalTok) * 100).toFixed(0)}%)`);
}
console.log("");

if (!WRITE) {
  console.log("--- 预览（前 40 行插入点）---");
  const preview = out.filter((l) => l.startsWith("<!--")).slice(0, 12);
  for (const p of preview) console.log("  " + p);
  console.log("");
  console.log("未写入。加 --write 落盘（会自动备份原文件）。");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const backup = `${TARGET}.bak-${stamp}`;
fs.copyFileSync(TARGET, backup);
fs.writeFileSync(TARGET, layered, "utf8");

console.log(`✓ 已写入 ${TARGET}`);
console.log(`✓ 备份 ${backup}`);
console.log("");
console.log(`回滚: cp "${backup}" "${TARGET}"`);
