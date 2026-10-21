/**
 * 文件系统探针：isFile / isDir / collectDirs。
 *
 * 与 desktop.js 里同名的私有函数不是一回事 —— 这里先问 desktop.isAsarSealedPath：
 * 密封的 app.asar 在文件系统上表现为"文件"，但补丁绝不该往里写，所以直接判否。
 * 把这条判断集中在一处，省得每个调用点各写一遍。
 */

import path from "node:path";
import * as desktop from "./desktop.js";
import { hostFs as fs } from "./extract-asar.js";

export function isFile(fp) {
  try {
    if (desktop.isAsarSealedPath(fp)) return false;
    return fs.existsSync(fp) && fs.statSync(fp).isFile();
  } catch {
    return false;
  }
}

export function isDir(fp) {
  try {
    if (desktop.isAsarSealedPath(fp)) return false;
    return fs.existsSync(fp) && fs.statSync(fp).isDirectory();
  } catch {
    return false;
  }
}

/** 过滤出不重复的现存目录，保持输入顺序。 */
export function collectDirs(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p || !isDir(p)) continue;
    const n = path.normalize(p);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
