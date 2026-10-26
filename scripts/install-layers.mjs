#!/usr/bin/env node
// 把 presets/layers/*.md 装进 prompt-inject.md：同名层替换、新层追加，写前备份。
// 只改本插件自己的投放层，不动用户手工写的其它层。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OPEN = /<!--\s*purge:layer\s+([A-Za-z0-9_.-]+)\s*-->/g;
const CLOSE = /<!--\s*\/\s*purge:layer\s*-->/;

function findHome() {
  const env = String(process.env.DSH_HOME || "").trim();
  if (env) return env;
  const guess = path.join(os.homedir(), ".dsh");
  return fs.existsSync(guess) ? guess : "";
}

function splitSegments(text) {
  const out = [];
  let cursor = 0;
  OPEN.lastIndex = 0;
  for (;;) {
    const open = OPEN.exec(text);
    if (!open) break;
    if (open.index > cursor) out.push({ kind: "raw", text: text.slice(cursor, open.index) });
    const rest = text.slice(open.index);
    const close = CLOSE.exec(rest);
    if (!close) {
      out.push({ kind: "raw", text: text.slice(open.index) });
      cursor = text.length;
      break;
    }
    const end = open.index + close.index + close[0].length;
    out.push({ kind: "layer", name: open[1], text: text.slice(open.index, end) });
    cursor = end;
    OPEN.lastIndex = cursor;
  }
  if (cursor < text.length) out.push({ kind: "raw", text: text.slice(cursor) });
  return out;
}

function readLayerFile(fp) {
  const text = fs.readFileSync(fp, "utf8").replace(/\r\n/g, "\n").trim();
  const m = /<!--\s*purge:layer\s+([A-Za-z0-9_.-]+)\s*-->/.exec(text);
  if (!m) throw new Error(`${path.basename(fp)} 没有层标记`);
  if (!CLOSE.test(text)) throw new Error(`${path.basename(fp)} 缺少 <!-- /purge:layer -->`);
  return { name: m[1], text };
}

function tokenEstimate(text) {
  // 中文按 1.5 字/token，其余按 4 字符/token —— 只用于给用户看差值量级。
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.round(cn / 1.5 + (text.length - cn) / 4);
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const fileIdx = args.indexOf("--file");
  const home = findHome();
  const target = fileIdx >= 0 ? args[fileIdx + 1] : home ? path.join(home, "prompt-inject.md") : "";
  const dirIdx = args.indexOf("--from");
  const srcDir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : path.join(REPO, "presets", "layers");

  if (!target) {
    console.error("找不到目标：没有 DSH_HOME，也没有 ~/.dsh");
    process.exit(1);
  }
  if (!fs.existsSync(target)) {
    console.error(`目标不存在：${target}（先让插件跑一次 apply 生成 prompt-inject.md）`);
    process.exit(1);
  }
  if (!fs.existsSync(srcDir)) {
    console.error(`层目录不存在：${srcDir}`);
    process.exit(1);
  }

  const incoming = fs
    .readdirSync(srcDir)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => readLayerFile(path.join(srcDir, n)));

  if (!incoming.length) {
    console.error(`${srcDir} 下没有 .md`);
    process.exit(1);
  }

  const before = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  const segs = splitSegments(before);
  const byName = new Map(incoming.map((l) => [l.name, l.text]));
  const replaced = [];
  const added = [];
  const dropped = [];
  const seen = new Set();

  // 同名层出现两次是历史遗留（core 被追加过一块）：只认第一处，后面的丢掉。
  // 不丢的话每次安装都会把同一份 content 再写一遍，越装越长。
  const out = segs.map((seg) => {
    if (seg.kind !== "layer") return seg.text;
    const next = byName.get(seg.name);
    if (next == null) return seg.text;
    if (seen.has(seg.name)) {
      const i = dropped.indexOf(seg.name);
      if (i < 0) dropped.push(seg.name);
      return "";
    }
    seen.add(seg.name);
    replaced.push(seg.name);
    return next;
  });

  for (const layer of incoming) {
    if (seen.has(layer.name)) continue;
    added.push(layer.name);
    out.push("\n" + layer.text + "\n");
  }

  const after = out.join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  if (dry) {
    console.log(`[dry] 目标：${target}`);
    console.log(`[dry] 替换：${replaced.join(", ") || "无"}`);
    console.log(`[dry] 新增：${added.join(", ") || "无"}`);
    console.log(`[dry] 去重：${dropped.join(", ") || "无"}`);
    console.log(`[dry] token：${tokenEstimate(before)} → ${tokenEstimate(after)}`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backup = `${target}.bak-layers-${stamp}`;
  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, after, "utf8");

  console.log(`目标：${target}`);
  console.log(`备份：${backup}`);
  console.log(`替换：${replaced.join(", ") || "无"}`);
  console.log(`新增：${added.join(", ") || "无"}`);
  console.log(`去重：${dropped.join(", ") || "无"}`);
  console.log(`token：${tokenEstimate(before)} → ${tokenEstimate(after)}`);
  console.log("重启 dsh 或 /layers reload 后生效");
}

main();
