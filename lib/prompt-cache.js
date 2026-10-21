/**
 * 提示词注入正文：进程内状态 + 磁盘读写。
 *
 * 从 lib/core.js 拆出来的原因：这一块没有任何外部依赖（只用 node:path 与 node:fs），
 * 却被 core 内部二十多处和 rules.js 直接调用 —— 埋在 8000 行里没人找得到。
 *
 * 这里只管"文本从哪来"，不管"要不要按层过滤"。分层在 inject-layers.js，
 * 选层逻辑在 rules.js 的 applyLayerSelection。
 */

import fs from "node:fs";
import path from "node:path";

/** 统一换行并去首尾空白。所有"这段文本算不算空 / 是不是同一份"的判断都以它为准。 */
export function normalizeOverride(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

export function findOverrideFile(dshHome) {
  return path.join(dshHome, "prompt-inject.md");
}

let committedOverride = null;

/**
 * 丢掉本进程的提示词框提交缓存，让后续解析回落到磁盘的 prompt-inject.md。
 * 没有这个入口时，进程起来时提交过一次的正文会一直压住磁盘，用户改完文件
 * 在界面上看到的仍是启动那一刻的旧文本（只能重启 dsh 才恢复）。
 */
export function clearCommittedOverride() {
  committedOverride = null;
}

/** 本进程里提示词框刚提交的正文；与磁盘上用户自改正文合并使用。 */
export function rememberCommittedOverride(dshHome, text) {
  const home = path.normalize(String(dshHome || ""));
  if (!home) return;
  committedOverride = { home, text: typeof text === "string" ? text : "" };
}

/** $DSH_HOME/prompt-inject.md 正文（应用/解包后由加密槽落下；注入与设置框以它为准）。 */
export function readPromptInjectFileSync(dshHome) {
  const fp = findOverrideFile(dshHome);
  let disk = "";
  try {
    if (fp && fs.existsSync(fp)) disk = fs.readFileSync(fp, "utf8");
  } catch {
    disk = "";
  }
  const norm = normalizeOverride(disk);
  return norm ? disk.replace(/\r\n/g, "\n") : "";
}

/** 仅本进程提示词框提交；重启后为空，注入改读 prompt-inject.md（#74）。 */
export function peekCommittedOverride(dshHome) {
  if (!committedOverride) return null;
  const home = path.normalize(String(dshHome || ""));
  if (home !== committedOverride.home) return null;
  return committedOverride.text;
}

let hungOperatorPromptText = "";

/** 本进程挂上的操作者正文。没有框里刚提交的字时，就是插件加密默认。 */
export function hangOperatorPrompt(text) {
  hungOperatorPromptText = typeof text === "string" ? text : "";
}

export function hungOperatorPrompt() {
  return hungOperatorPromptText;
}
