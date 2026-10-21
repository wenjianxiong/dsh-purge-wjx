/**
 * 注入文本分析器 —— 只读。
 *
 * 目的：把「提示词太大 / 有重复」从感觉变成数字。
 * 输入是 prompt-inject.md 的全文，输出分段、token 估算、重复簇、预算判定。
 * 不改任何用户文件。
 */

const CJK_RE = /[\u4e00-\u9fa5]/g;
const SEPARATOR_RE = /^[═─━=_*\-—\s]{4,}$/;
const SHINGLE = 3;

/** 粗估 token：中文约 1.5 字/token，其余约 4 字符/token。 */
export function estimateTokens(text) {
  const s = String(text || "");
  if (!s) return 0;
  const cjk = (s.match(CJK_RE) || []).length;
  return Math.round(cjk / 1.5 + (s.length - cjk) / 4);
}

/** 纯分隔视觉块（一长串 ═ 之类），没有信息量。 */
export function isSeparator(block) {
  const t = String(block || "").trim();
  if (!t) return true;
  return t.length <= 200 && SEPARATOR_RE.test(t);
}

/**
 * 按空行切段，丢掉纯分隔块。
 * 保留 index 指向原始顺序，方便回报行号。
 */
export function splitBlocks(text) {
  const raw = String(text || "").split(/\n[ \t]*\n/);
  const out = [];
  let line = 1;
  for (let i = 0; i < raw.length; i++) {
    const body = raw[i];
    const startLine = line;
    line += body.split("\n").length + 1;
    const trimmed = body.trim();
    if (!trimmed || isSeparator(trimmed)) continue;
    out.push({ index: out.length, startLine, text: trimmed, chars: trimmed.length });
  }
  return out;
}

/** 归一化：压空白、去标点、转小写。用于判重，不做展示。 */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** 字符 n-gram 集合。 */
function shingles(text, n = SHINGLE) {
  const s = normalize(text).replace(/\s+/g, "");
  const set = new Set();
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
  return set;
}

/** Jaccard 相似度。两个都太短时退回全等判断。 */
export function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < SHINGLE || nb.length < SHINGLE) return 0;
  const sa = shingles(a);
  const sb = shingles(b);
  let inter = 0;
  for (const it of sa) if (sb.has(it)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

/**
 * 找出互相高度相似的块，聚成簇。
 * 阈值默认 0.55 —— 同一规则换措辞复述通常落在这个区间。
 */
export function findDuplicateClusters(blocks, threshold = 0.55) {
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < blocks.length; i++) {
    if (used.has(i)) continue;
    const members = [i];
    for (let j = i + 1; j < blocks.length; j++) {
      if (used.has(j)) continue;
      if (similarity(blocks[i].text, blocks[j].text) >= threshold) {
        members.push(j);
        used.add(j);
      }
    }
    if (members.length > 1) {
      used.add(i);
      clusters.push({
        members,
        peak: Math.max(...members.map((k) => similarity(blocks[members[0]].text, blocks[k].text))),
        sample: blocks[i].text.split("\n")[0].replace(/[*#>]/g, "").trim().slice(0, 70),
        chars: members.reduce((n, k) => n + blocks[k].chars, 0),
      });
    }
  }
  clusters.sort((a, b) => b.chars - a.chars);
  return clusters;
}

/**
 * 一次算完。
 * budget 传的是「希望压到多少 token」，用来给结论。
 */
export function analyze(text, options = {}) {
  const budget = Number(options.budget) || 0;
  const threshold = Number(options.threshold) || 0.55;
  const source = String(text || "");
  const blocks = splitBlocks(source);
  const perBlock = blocks.map((b) => ({
    index: b.index,
    startLine: b.startLine,
    chars: b.chars,
    tokens: estimateTokens(b.text),
    head: b.text.split("\n")[0].replace(/[*#>]/g, "").trim().slice(0, 70),
  }));
  const tokens = estimateTokens(source);
  const clusters = findDuplicateClusters(blocks, threshold);
  const duplicateTokens = clusters.reduce((n, c) => n + estimateTokens(c.members.map((k) => blocks[k].text).join("\n")), 0);
  return {
    chars: source.length,
    tokens,
    blocks: blocks.length,
    perBlock,
    clusters,
    duplicateTokens,
    wasteRatio: tokens ? duplicateTokens / tokens : 0,
    budget,
    overBudget: budget > 0 ? tokens > budget : false,
  };
}

/** 给终端看的一段话。 */
export function formatReport(report) {
  const lines = [];
  lines.push(`注入文本：${report.chars} 字符 / ${report.blocks} 有效段 / 约 ${report.tokens} tokens`);
  if (report.budget) {
    const mark = report.overBudget ? "超" : "在";
    lines.push(`预算：${report.budget} tokens —— ${mark}预算内`);
  }
  lines.push(`疑似重复：${report.clusters.length} 簇，合计约 ${report.duplicateTokens} tokens（占 ${(report.wasteRatio * 100).toFixed(1)}%）`);
  if (report.clusters.length) {
    lines.push("");
    lines.push("按体积排前 5 簇：");
    for (const c of report.clusters.slice(0, 5)) {
      const where = c.members.map((k) => `#${k}`).join(" ");
      lines.push(`  ${String(c.chars).padStart(5)} 字符 | ${where} | ${c.sample}`);
    }
  }
  const heavy = [...report.perBlock].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
  lines.push("");
  lines.push("最重的 5 段：");
  for (const b of heavy) {
    lines.push(`  ${String(b.tokens).padStart(4)} tok | 第 ${b.startLine} 行 | ${b.head}`);
  }
  return lines.join("\n");
}
