#!/usr/bin/env node
/**
 * 备份目录清理。
 *
 * deploy.sh 每跑一次就在 ~/.dsh/backups 里留两份（源目录 + pnpm store），
 * lib/update.js 的 applyUpdate 也会留一份 —— 全都没有回收逻辑，
 * 跑上几十次就是几百 MB。这个脚本按 mtime 保留最近 N 个，其余删掉。
 *
 *   node scripts/prune-backups.mjs            # 执行
 *   node scripts/prune-backups.mjs --dry      # 只列出会删什么
 *   node scripts/prune-backups.mjs --keep 5   # 每组保留 5 个
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const DEFAULT_KEEP = 3;

// 每组独立计数：备份来源不同，混在一起排会把刚建的源目录备份挤掉。
const GROUPS = [
  { dir: path.join(HOME, ".dsh/backups"), prefix: "dsh-purge-src-" },
  { dir: path.join(HOME, ".dsh/backups"), prefix: "dsh-purge-store-" },
  { dir: path.join(HOME, ".dsh/backups"), prefix: "dsh-purge-full-" },
  { dir: path.join(HOME, ".dsh/backups"), prefix: "dsh-purge-" },
  { dir: path.join(HOME, ".dsh/plugins"), prefix: ".dsh-purge-full-backup-" },
  { dir: path.join(HOME, ".dsh/plugins"), prefix: ".dsh-purge-backup-" },
];

function parseArgs(argv) {
  const out = { dry: false, keep: DEFAULT_KEEP };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry" || a === "--dry-run") out.dry = true;
    else if (a === "--keep") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n >= 1) out.keep = Math.trunc(n);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function dirSize(fp) {
  let total = 0;
  const stack = [fp];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.lstatSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      let names;
      try { names = fs.readdirSync(cur); } catch { continue; }
      for (const n of names) stack.push(path.join(cur, n));
    } else {
      total += st.size;
    }
  }
  return total;
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/prune-backups.mjs [--dry] [--keep N]");
    return 0;
  }

  let removed = 0;
  let freed = 0;
  let kept = 0;

  // 长前缀组排在前，短前缀组靠 claimed 跳过已被认领的条目。
  const claimed = new Set();

  for (const group of GROUPS) {
    if (!fs.existsSync(group.dir)) continue;

    let entries;
    try { entries = fs.readdirSync(group.dir); } catch { continue; }

    const items = [];
    for (const name of entries) {
      const key = path.join(group.dir, name);
      if (!name.startsWith(group.prefix) || claimed.has(key)) continue;
      const fp = key;
      let st;
      try { st = fs.lstatSync(fp); } catch { continue; }
      if (!st.isDirectory()) continue;
      items.push({ name, fp, mtime: st.mtimeMs });
      claimed.add(key);
    }
    if (items.length === 0) continue;

    items.sort((a, b) => b.mtime - a.mtime);
    const drop = items.slice(args.keep);
    const keepItems = items.slice(0, args.keep);
    kept += keepItems.length;

    if (drop.length === 0) continue;

    console.log(`\n${group.prefix}  (${group.dir})`);
    for (const it of drop) {
      const size = dirSize(it.fp);
      freed += size;
      removed += 1;
      console.log(`  ${args.dry ? "会删" : "删除"} ${it.name}  ${human(size)}`);
      if (!args.dry) {
        try {
          fs.rmSync(it.fp, { recursive: true, force: true });
        } catch (e) {
          console.error(`  失败 ${it.name}: ${e.message}`);
        }
      }
    }
  }

  console.log(
    `\n${args.dry ? "[dry-run] " : ""}删除 ${removed} 个，释放 ${human(freed)}，保留 ${kept} 个（每组 ${args.keep}）`,
  );
  return 0;
}

process.exit(main());
