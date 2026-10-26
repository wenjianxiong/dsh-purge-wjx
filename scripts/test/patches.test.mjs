/**
 * 83 条清洗补丁的定义完整性。
 *
 * 这些断言只查"定义是否自洽"，不查"补丁打在哪些字面量上对不对"——
 * 后者需要真实 dsh 安装树，属于集成测试。这里的价值是：改 defs.js 时
 * id 重复、分组引用失效、动作缺失能立刻暴露，而不是等 apply 时报错。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_PATCHES, PATCH_DISPLAY_GROUPS } from "../../lib/patches/defs.js";

// 一条补丁只要带其中任意一种，就算有动作；全都没有等于这条定义是死的。
const ACTION_KEYS = ["replacements", "markers", "marker", "patterns", "replace", "config"];

test("补丁总数是 83", () => {
  assert.equal(ALL_PATCHES.length, 83);
});

test("id 全部唯一", () => {
  const ids = ALL_PATCHES.map((p) => p.id);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepEqual(dup, [], `重复 id: ${dup.join(",")}`);
});

test("每条补丁都有 id / name / layer / file", () => {
  const bad = ALL_PATCHES.filter(
    (p) => !Number.isInteger(p.id) || !p.name || !p.layer || !p.file,
  ).map((p) => p.id ?? "(无 id)");
  assert.deepEqual(bad, []);
});

test("每条补丁都带至少一种动作", () => {
  const bad = ALL_PATCHES.filter((p) => !ACTION_KEYS.some((k) => p[k] !== undefined)).map(
    (p) => p.id,
  );
  assert.deepEqual(bad, [], `这些补丁没有任何动作字段: ${bad.join(",")}`);
});

test("replacements 里每条 pattern 都是非空的字符串或 RegExp", () => {
  const bad = [];
  for (const p of ALL_PATCHES) {
    if (!Array.isArray(p.replacements)) continue;
    p.replacements.forEach((r, i) => {
      const pat = r?.pattern;
      // 少数几条用 RegExp 做跨行匹配，其余是字面量字符串；两者都算有效。
      const ok = pat instanceof RegExp ? pat.source.length > 0 : typeof pat === "string" && pat.length > 0;
      if (!ok) bad.push(`${p.id}[${i}]`);
    });
  }
  assert.deepEqual(bad, []);
});

test("显示分组引用的 id 都真实存在", () => {
  const ids = new Set(ALL_PATCHES.map((p) => p.id));
  const missing = [];
  for (const [group, list] of Object.entries(PATCH_DISPLAY_GROUPS)) {
    for (const id of list) if (!ids.has(id)) missing.push(`${group}:${id}`);
  }
  assert.deepEqual(missing, []);
});

test("同一条补丁不会同时出现在两个显示分组里", () => {
  const seen = new Map();
  const dup = [];
  for (const [group, list] of Object.entries(PATCH_DISPLAY_GROUPS)) {
    for (const id of list) {
      if (seen.has(id)) dup.push(`${id} 同时在 ${seen.get(id)} 与 ${group}`);
      else seen.set(id, group);
    }
  }
  assert.deepEqual(dup, []);
});

test("notApplicable 声明必须自带理由和可验证条件", () => {
  const declared = ALL_PATCHES.filter((p) => p.notApplicable);
  assert.ok(declared.length >= 2, "至少 #71 / #80 应声明 notApplicable");
  for (const p of declared) {
    const spec = p.notApplicable;
    assert.equal(typeof spec.reason, "string", `#${p.id} reason 必须是字符串`);
    assert.ok(spec.reason.length >= 8, `#${p.id} reason 太短，说不清为什么不适用`);
    const hasAbsent = Array.isArray(spec.whenAbsent) && spec.whenAbsent.length > 0;
    const hasNoPattern = spec.whenNoPattern === true;
    assert.ok(hasAbsent || hasNoPattern, `#${p.id} 没有可验证条件，等于无条件免责`);
    if (hasAbsent) {
      // 条件必须落在自己能解析的文件键上，否则永远不会触发，声明就成了死字段。
      for (const key of spec.whenAbsent) {
        assert.ok(p.file.includes(key), `#${p.id} whenAbsent 里的 ${key} 不在 file 里`);
      }
    }
  }
});

test("回退型补丁不能只靠 whenNoPattern 结案", () => {
  // 只有「文件在 + 一条 pattern 都没命中」才等于正常终态；文件不在必须另有交代。
  const noPatternOnly = ALL_PATCHES.filter((p) => p.notApplicable?.whenNoPattern === true && !(p.notApplicable?.whenAbsent?.length > 0));
  assert.deepEqual(noPatternOnly.map((p) => p.id), [], "whenNoPattern 必须配 whenAbsent，否则目标包缺失时会静默");
});
