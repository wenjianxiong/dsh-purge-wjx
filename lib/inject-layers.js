/**
 * 注入文本分层。
 *
 * 标记：<!-- purge:layer NAME --> … <!-- /purge:layer -->
 * 未标记的部分一律算 core —— 这样老文件不改也能照常运作，
 * 只是「全量 = core」，分层能力要用户自己加标记才启用。
 *
 * 设计取舍：标记用 HTML 注释，因为 prompt-inject.md 是 Markdown，
 * 注释在渲染时不显示，也不会被模型当成内容。
 */

// 层名允许点号：route.re / route.web 这类带命名空间的层名很自然，
// 早先只认 [A-Za-z0-9_-] 会让 `<!-- purge:layer route.re -->` 静默失配 ——
// 失配的那一段会被并进上一层，用户看不到任何报错，只看到层内容串味。
const OPEN_RE = /<!--\s*purge:layer\s+([A-Za-z0-9_.-]+)\s*-->/g;
const CLOSE_RE = /<!--\s*\/\s*purge:layer\s*-->/;

export const DEFAULT_ALWAYS = ["core"];

function pushText(out, text) {
  const t = String(text || "").trim();
  if (t) out.push(t);
}

/**
 * 切层。返回：
 *   layers: [{ name, text, chars, startLine }]  —— core 永远排第一
 *   names:  [..] 去重后的层名
 *   clean:  去掉标记后的原文（无标记时等于输入）
 *
 * 容错策略：遇到未闭合的开标记，把余下全文归给该层并结束解析；
 * 不会丢内容，也不会把后半段错算成 core。
 */
export function parseLayers(text) {
  const source = String(text || "");
  const layers = [];
  const pieces = [];
  let cursor = 0;
  let coreBuf = [];
  let line = 1;
  let lastIndex = 0;

  const countLines = (s) => (s.match(/\n/g) || []).length;

  while (cursor < source.length) {
    OPEN_RE.lastIndex = cursor;
    const open = OPEN_RE.exec(source);
    if (!open) {
      coreBuf.push(source.slice(cursor));
      break;
    }
    coreBuf.push(source.slice(cursor, open.index));
    const name = open[1];
    const bodyStart = open.index + open[0].length;
    const rest = source.slice(bodyStart);
    const close = CLOSE_RE.exec(rest);
    // 直接用「开标记之前的换行数 + 1」，比维护增量 line 变量更不容易错。
    const startLine = countLines(source.slice(0, open.index)) + 1;

    let body;
    let next;
    if (!close) {
      body = rest;
      next = source.length;
      pieces.push({ kind: "open", index: open.index, length: open[0].length, startLine });
    } else {
      body = rest.slice(0, close.index);
      next = bodyStart + close.index + close[0].length;
      pieces.push({ kind: "open", index: open.index, length: open[0].length, startLine });
      pieces.push({ kind: "close", index: bodyStart + close.index, length: close[0].length, startLine });
    }
    layers.push({ name, text: body.trim(), chars: body.trim().length, startLine });
    cursor = next;
    lastIndex = next;
  }

  const coreText = coreBuf.join("").trim();
  const all = [];
  if (coreText) all.push({ name: "core", text: coreText, chars: coreText.length, startLine: 1 });
  all.push(...layers);

  // 去标记版本：直接把标记片段删掉，保留全部正文，用于「全量但干净」的场合。
  let clean = "";
  let at = 0;
  for (const p of pieces.sort((a, b) => a.index - b.index)) {
    clean += source.slice(at, p.index);
    at = p.index + p.length;
  }
  clean += source.slice(at);

  const names = [];
  for (const l of all) if (!names.includes(l.name)) names.push(l.name);
  return { layers: all, names, clean: clean.trim() };
}

/** 该层是否启用。names 为空表示不过滤。 */
export function isEnabled(name, selected) {
  if (!selected || selected === "all") return true;
  const list = Array.isArray(selected) ? selected : [selected];
  if (!list.length) return true;
  return list.includes(name);
}

/**
 * 按选择拼接。always 里的层无条件保留（默认只有 core）。
 * 没有匹配到任何层时回退全量 —— 宁可多花 token，也不让模型裸奔。
 */
export function selectLayers(parsed, selected, options = {}) {
  // 全量直接用 clean：逐层 join 会归一化块间空行，改变原始排版。
  if (!selected || selected === "all") {
    return { text: parsed.clean, kept: parsed.names, fallback: false, unmatched: [] };
  }
  const always = Array.isArray(options.always) ? options.always : DEFAULT_ALWAYS;
  const keep = parsed.layers.filter((l) => always.includes(l.name) || isEnabled(l.name, selected));
  // unmatched 表示「选了但一个都没命中」—— 调用方据此提示配置写错，
  // 否则用户以为开了某层，实际只拿到 core。
  const wants = selected && selected !== "all" ? (Array.isArray(selected) ? selected : [selected]) : [];
  const unmatched = wants.filter((n) => !parsed.names.includes(n));
  if (!keep.length) {
    return { text: parsed.clean, kept: parsed.names, fallback: true, unmatched };
  }
  const text = keep.map((l) => l.text).filter(Boolean).join("\n\n");
  return { text, kept: keep.map((l) => l.name), fallback: false, unmatched };
}

/** 按层名取正文，给 UI 预览用。 */
export function layerText(parsed, name) {
  const hit = parsed.layers.find((l) => l.name === name);
  return hit ? hit.text : "";
}
