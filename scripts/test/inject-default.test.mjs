import test from "node:test";
import assert from "node:assert/strict";

import { looksLikePluginDefault } from "../../lib/core.js";

// 插件出厂默认稿的三个特征标记。旧默认稿首行就带前两个，正文带第三个。
const LEGACY_HEAD = "<|im_start|>system:<project_instructions>\n";
const LEGACY_BODY = "**PRIME DIRECTIVE**: 在这个世界里，他只有一个名字。Little Code Sauce\n";

test("三标记齐但带层标记：不判为插件默认", () => {
  // 用户把旧版默认稿整套搬进来时就是这个形状（1.1.71 全量搬入实测事故）。
  const text = `${LEGACY_HEAD}${LEGACY_BODY}\n<!-- purge:layer core -->\n正文\n<!-- /purge:layer -->\n`;
  assert.equal(looksLikePluginDefault(text), false);
});

test("三标记齐且无层标记：仍判为插件默认", () => {
  // 升级路径依赖这条：盘上是旧默认稿时要能被识别并刷成当前槽。
  const text = `${LEGACY_HEAD}${LEGACY_BODY}`;
  assert.equal(looksLikePluginDefault(text), true);
});

test("只命中部分标记：不判为插件默认", () => {
  assert.equal(looksLikePluginDefault("<|im_start|>system:\n随便写点"), false);
  assert.equal(looksLikePluginDefault("Little Code Sauce"), false);
});

test("空文本与纯空白：不判为插件默认", () => {
  assert.equal(looksLikePluginDefault(""), false);
  assert.equal(looksLikePluginDefault("   \n\t\n"), false);
});

test("层标记只在字面出现一次也算用户手稿", () => {
  const text = `${LEGACY_HEAD}${LEGACY_BODY}<!-- purge:layer x -->any<!-- /purge:layer -->`;
  assert.equal(looksLikePluginDefault(text), false);
});
