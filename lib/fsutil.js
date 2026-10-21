/**
 * 原子写：write-to-tmp + rename。EBUSY / ENOSPC 都不会半写坏原文件。
 *
 * 走 hostFs 而不是 node:fs —— 它按路径在 node:fs 与 asar 内部文件系统之间路由，
 * 异步写还会顺手让 asar 探针缓存失效。
 *
 * 不走 FileHandle：hostFs.promises 只包了 readFile/writeFile/mkdir/unlink/rm/
 * copyFile/rename，没有 open。
 * 不显式 fsync：原子性靠 rename；KB 级配置文件断电丢一次写入可接受，下一次 apply 会补。
 */

import path from "node:path";
import { hostFs } from "./extract-asar.js";

const fsp = hostFs.promises;

export function atomicWriteSync(fp, content, encoding = "utf8") {
  const dir = path.dirname(fp);
  hostFs.mkdirSync(dir, { recursive: true });
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  hostFs.writeFileSync(tmp, content, encoding);
  try {
    hostFs.renameSync(tmp, fp);
  } catch (e) {
    try { hostFs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export async function atomicWriteFile(fp, content, encoding = "utf8") {
  const dir = path.dirname(fp);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, encoding);
  try {
    await fsp.rename(tmp, fp);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export async function atomicCopyFile(src, dst) {
  const dir = path.dirname(dst);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${dst}.${process.pid}.${Date.now()}.copytmp`;
  await fsp.copyFile(src, tmp);
  try {
    await fsp.rename(tmp, dst);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}
