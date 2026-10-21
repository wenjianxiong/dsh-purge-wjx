#!/usr/bin/env node
/**
 * 把本仓库的上游地址整体改向一个新的 GitHub 仓库。
 *
 * 上游 YuJunZhiXue/dsh-purge 已于 2026-10 下线，本仓库是自维护 fork。
 * 首次接手时跑一次，把更新链路指向你自己的仓库：
 *
 *   node scripts/set-repo.mjs yourname/dsh-purge
 *   node scripts/set-repo.mjs yourname/dsh-purge --dry   # 只看会改什么
 *
 * 改了哪几处：
 *   - package.json          repository / homepage / bugs / dsh.install 三条下载地址
 *   - lib/update.js         FALLBACK_REPO（正常路径从 package.json 解析，仅兜底）
 *   - lib/redteam/ui.js     githubRepoOf() 的兜底仓库
 *   - client.js             welcome.repo（用户须知里展示的仓库链接，中英各一处）
 *   - .github/workflows/    release 的仓库守卫与发布提示
 *
 * 不动 README / release-notes：那里是上游署名与历史记录，必须保留。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD = "YuJunZhiXue/dsh-purge";

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const target = argv.find((a) => !a.startsWith("-"));

if (!target || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(target)) {
	console.error("用法: node scripts/set-repo.mjs <owner/repo> [--dry]");
	console.error("示例: node scripts/set-repo.mjs yourname/dsh-purge");
	process.exit(1);
}
if (target === OLD) {
	console.error("目标与上游相同，无需改动。");
	process.exit(1);
}

/** 替换一个文件里的旧地址；返回实际改动的处数（按文本变化判定，兼容只改部分引用的文件）。 */
function patch(rel, transform = (s) => s.split(OLD).join(target)) {
	const file = join(root, rel);
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		console.warn(`  跳过 ${rel}: ${err.code || err.message}`);
		return 0;
	}
	if (!text.includes(OLD)) return 0;
	const next = transform(text);
	if (next === text) return 0;
	if (!dry) writeFileSync(file, next);
	// 默认替换器按剩余旧地址数算；自定义变换器按"是否变化"算 1 处
	const removed = text.split(OLD).length - next.split(OLD).length;
	return removed > 0 ? removed : 1;
}

console.log(`${dry ? "[dry-run] " : ""}改向 ${OLD} → ${target}\n`);

let total = 0;
const jobs = [
	// package.json 六处：repository / homepage / bugs / install 三连
	["package.json"],
	// update.js 只改兜底常量：注释里的旧仓库名是溯源记录，必须原样留着
	[
		"lib/update.js",
		(s) => s.replace(/const FALLBACK_REPO = "[^"]*";/, `const FALLBACK_REPO = "${target}";`),
	],
	// ui.js 的 githubRepoOf() 兜底值
	["lib/redteam/ui.js"],
	// client.js 的中英 welcome.repo
	["client.js"],
	// CI 守卫 + 发布提示
	[".github/workflows/release.yml"],
];

for (const [rel, transform] of jobs) {
	const n = patch(rel, transform);
	total += n;
	console.log(`  ${rel.padEnd(28)} ${n ? `改了 ${n} 处` : "无旧地址"}`);
}

console.log(`\n合计 ${total} 处。`);

if (dry) {
	console.log("\n[dry-run] 未写盘。去掉 --dry 才会真正改动。");
	process.exit(0);
}

// 改完自检：代码与配置里不应再残留旧地址（README/release-notes/溯源注释除外）
const CHECK = [
	"package.json",
	"lib/redteam/ui.js",
	"client.js",
	".github/workflows/release.yml",
];
const leftovers = CHECK.filter((rel) => {
	try {
		return readFileSync(join(root, rel), "utf8").includes(OLD);
	} catch {
		return false;
	}
});
// update.js 只认兜底常量这一行；文件头注释里的旧仓库名是溯源记录，允许留着
try {
	const updateSrc = readFileSync(join(root, "lib/update.js"), "utf8");
	if (updateSrc.includes(`const FALLBACK_REPO = "${OLD}";`)) leftovers.push("lib/update.js");
} catch {
	// 文件不在就跳过。
}
if (leftovers.length) {
	console.error(`\n仍有残留在: ${leftovers.join(", ")}`);
	process.exit(1);
}
console.log("\n自检通过：代码与配置已无旧地址，README/release-notes 的署名与溯源注释原样保留。");
console.log("下一步：git diff 复核 → git commit -m 'chore: 上游改向' → 重新 apply 插件。");
