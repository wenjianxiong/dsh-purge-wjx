/**
 * 路径解析结果的进程内记忆化。
 *
 * 四个槽位各对应一次昂贵的文件系统遍历：npm prefix、桌面 shim 目录、
 * CLI shim 目录、aiBase。命中之后本轮不再重扫。
 *
 * ai 槽位的空结果故意不缓存 —— 启动早期宿主目录可能还没就绪，
 * 一旦把 null 记成"已就绪"，整次进程都会按 0 条处理、每条补丁都跳过。
 */

import * as desktop from "./desktop.js";

const memo = {
  prefix: { ready: false, value: null },
  shim: { ready: false, value: null },
  desktopShim: { ready: false, value: null },
  ai: { ready: false, value: null },
};

export function remember(slot, compute) {
  if (memo[slot].ready) return memo[slot].value;
  const value = compute();
  // 启动早期可能还看不到宿主目录。空结果不缓存，否则整次进程都是 0/52、每条跳过。
  if (slot === "ai" && !value) return value;
  memo[slot] = { ready: true, value };
  return value;
}

export function resetPathMemo() {
  for (const slot of Object.keys(memo)) memo[slot] = { ready: false, value: null };
}

/** 让 Apply 阶段重新探测一次空的 ai 槽位（依赖可能此时才组好）。 */
export function retryAiPathProbe() {
  if (memo.ai.ready && !memo.ai.value) memo.ai = { ready: false, value: null };
}

export function clearDesktopLocateCache() {
  try { desktop.clearDesktopLocateCache(); } catch { /* ignore */ }
  resetPathMemo();
}
