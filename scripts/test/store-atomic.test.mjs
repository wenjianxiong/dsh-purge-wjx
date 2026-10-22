/**
 * atomicWriteSync 的行为保证。
 *
 * 它守的是「写坏即丢靶标」那一类文件：engagement.yaml、current 指针、
 * prompt manifest。测的重点不是写得进去，而是**没留下半截状态**——
 * 每次写完目录里只该有目标文件，一个多余 .tmp 都不能有。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteSync } from "../../lib/fsutil.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "purge-atomic-"));
}

test("写入后内容正确，目录里没有残留临时文件", () => {
  const dir = tmpDir();
  try {
    const fp = path.join(dir, "engagement.yaml");
    atomicWriteSync(fp, "id: demo\n");
    assert.equal(fs.readFileSync(fp, "utf8"), "id: demo\n");
    assert.deepEqual(fs.readdirSync(dir), ["engagement.yaml"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("覆盖写会整体替换旧内容", () => {
  const dir = tmpDir();
  try {
    const fp = path.join(dir, "current");
    atomicWriteSync(fp, "OLD-ENGAGEMENT");
    atomicWriteSync(fp, "NEW");
    assert.equal(fs.readFileSync(fp, "utf8"), "NEW");
    assert.deepEqual(fs.readdirSync(dir), ["current"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("父目录不存在时自动递归创建", () => {
  const dir = tmpDir();
  try {
    const fp = path.join(dir, "a", "b", "c", "meta.json");
    atomicWriteSync(fp, '{"ok":true}');
    assert.equal(fs.readFileSync(fp, "utf8"), '{"ok":true}');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("连续 20 次写同一文件不留任何临时残留", () => {
  const dir = tmpDir();
  try {
    const fp = path.join(dir, "score.json");
    for (let i = 0; i < 20; i++) atomicWriteSync(fp, `{"n":${i}}`);
    assert.equal(fs.readFileSync(fp, "utf8"), '{"n":19}');
    assert.deepEqual(fs.readdirSync(dir), ["score.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("支持非 utf8 编码写二进制内容", () => {
  const dir = tmpDir();
  try {
    const fp = path.join(dir, "blob.bin");
    const buf = Buffer.from([0x00, 0xff, 0x10, 0x7f]);
    atomicWriteSync(fp, buf);
    assert.deepEqual(fs.readFileSync(fp), buf);
    assert.deepEqual(fs.readdirSync(dir), ["blob.bin"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
