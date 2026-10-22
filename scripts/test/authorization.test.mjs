/**
 * 授权声明状态机。
 *
 * 这里测的是「记录得准不准」，不是「授权是否成立」——后者只能由外部事实回答。
 * 每个用例都用独立 mkdtemp 的 dshHome，不碰真实 ~/.dsh。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_TTL_MS,
  authStatePath,
  readAuthState,
  grantAuth,
  revokeAuth,
  formatAuthState,
  authPromptSection,
  withAuthSection,
} from "../../lib/authorization.js";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "purge-auth-"));
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

test("没有文件时报未声明", () => {
  const home = tmpHome();
  try {
    const st = readAuthState(home);
    assert.equal(st.active, false);
    assert.equal(st.grantedAt, null);
    assert.equal(st.expired, false);
  } finally {
    cleanup(home);
  }
});

test("grant 之后 active，过期时间等于 now + DEFAULT_TTL_MS", () => {
  const home = tmpHome();
  try {
    const before = Date.now();
    const st = grantAuth(home);
    const after = Date.now();
    assert.equal(st.active, true);
    assert.equal(st.expired, false);
    assert.ok(st.grantedAt >= before && st.grantedAt <= after);
    assert.ok(st.expiresAt - st.grantedAt === DEFAULT_TTL_MS);
    assert.ok(fs.existsSync(authStatePath(home)));
  } finally {
    cleanup(home);
  }
});

test("note 被保存并原样读回", () => {
  const home = tmpHome();
  try {
    grantAuth(home, { note: "本地靶场 2026-10-22" });
    assert.equal(readAuthState(home).note, "本地靶场 2026-10-22");
  } finally {
    cleanup(home);
  }
});

test("note 超长会被截到 500 字", () => {
  const home = tmpHome();
  try {
    grantAuth(home, { note: "x".repeat(1200) });
    assert.equal(readAuthState(home).note.length, 500);
  } finally {
    cleanup(home);
  }
});

test("revoke 删除文件并回到未声明", () => {
  const home = tmpHome();
  try {
    grantAuth(home);
    const st = revokeAuth(home);
    assert.equal(st.active, false);
    assert.equal(fs.existsSync(authStatePath(home)), false);
  } finally {
    cleanup(home);
  }
});

test("过期后 active 为 false 但记录保留（expired=true）", () => {
  const home = tmpHome();
  try {
    grantAuth(home, { ttlMs: 1000 });
    const st = readAuthState(home, Date.now() + 5000);
    assert.equal(st.active, false);
    assert.equal(st.expired, true);
    assert.equal(fs.existsSync(authStatePath(home)), true, "过期不该删文件，那是证据");
  } finally {
    cleanup(home);
  }
});

test("坏 JSON 当作未声明，不抛异常", () => {
  const home = tmpHome();
  try {
    fs.mkdirSync(path.join(home, "purge"), { recursive: true });
    fs.writeFileSync(authStatePath(home), "{ not json");
    assert.equal(readAuthState(home).active, false);
  } finally {
    cleanup(home);
  }
});

test("ttlMs <= 0 表示不设到期", () => {
  const home = tmpHome();
  try {
    grantAuth(home, { ttlMs: 0 });
    const st = readAuthState(home);
    assert.equal(st.active, true, "不设到期应当一直有效");
    assert.equal(st.expiresAt, null, "不设到期时 expiresAt 应为 null，而不是 0");
  } finally {
    cleanup(home);
  }
});

test("不设到期时 formatAuthState 显示「不设到期」", () => {
  const home = tmpHome();
  try {
    grantAuth(home, { ttlMs: 0 });
    assert.match(formatAuthState(readAuthState(home)), /不设到期/);
  } finally {
    cleanup(home);
  }
});

test("authPromptSection 在未声明时返回空串", () => {
  const home = tmpHome();
  try {
    assert.equal(authPromptSection(readAuthState(home)), "");
  } finally {
    cleanup(home);
  }
});

test("authPromptSection 用「操作员声明」而不是「处置权成立」", () => {
  const home = tmpHome();
  try {
    grantAuth(home);
    const s = authPromptSection(readAuthState(home));
    assert.match(s, /\*\*授权状态\*\*/);
    assert.match(s, /操作员已于/);
    assert.match(s, /助手不核验其真实性/);
    assert.equal(s.includes("处置权已成立"), false);
  } finally {
    cleanup(home);
  }
});

test("withAuthSection 重复调用不叠加状态段", () => {
  const home = tmpHome();
  try {
    grantAuth(home);
    const st = readAuthState(home);
    const once = withAuthSection("正文", st);
    const twice = withAuthSection(once, st);
    assert.equal(twice.split("**授权状态**").length - 1, 1);
  } finally {
    cleanup(home);
  }
});

test("withAuthSection 在撤销后剥掉旧状态段", () => {
  const home = tmpHome();
  try {
    grantAuth(home);
    const withSection = withAuthSection("正文", readAuthState(home));
    const cleared = withAuthSection(withSection, readAuthState(home, Date.now() + 10 * 3600 * 1000));
    assert.equal(cleared.includes("**授权状态**"), false);
    assert.equal(cleared, "正文");
  } finally {
    cleanup(home);
  }
});
