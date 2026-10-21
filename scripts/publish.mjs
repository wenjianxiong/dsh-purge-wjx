#!/usr/bin/env node
/**
 * 一键发布：创建 GitHub 仓库 → 推送 master 与 tag → 验证下载链路。
 *
 * 用法：
 *   node scripts/publish.mjs                                # 交互输入 token，不回显
 *   GITHUB_TOKEN=xxx node scripts/publish.mjs               # token 走环境变量
 *   read -rs GITHUB_TOKEN && export GITHUB_TOKEN && node scripts/publish.mjs
 *                                                           # 推荐：token 不进 shell history
 *
 * token 需要什么权限：
 *   Fine-grained token（作用域选该账号，创建后再补仓库）：
 *     - Administration: Read and write   创建仓库
 *     - Contents: Read and write         推送代码
 *   经典 token：勾 repo 一个 scope 就够。
 *   地址：GitHub → Settings → Developer settings → Personal access tokens
 *
 * 安全约定：token 只存在于本进程内存和一次 push 的临时 URL 里，
 * 不写入 .git/config、不落盘、不打印、不进 shell history。
 * 代价是推送期间本机 `ps` 能在命令行里看到它（本机自用可接受）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const parsed = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(
	pkg.repository?.url ?? "",
);
if (!parsed) {
	console.error("package.json 的 repository 不是 GitHub 地址。先跑：node scripts/set-repo.mjs <owner>/<repo>");
	process.exit(1);
}
const [, OWNER, REPO] = parsed;
const DESCRIPTION = (pkg.description ?? "").slice(0, 350);

const c = {
	ok: (s) => `\x1b[32m${s}\x1b[0m`,
	bad: (s) => `\x1b[31m${s}\x1b[0m`,
	dim: (s) => `\x1b[2m${s}\x1b[0m`,
	bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const say = (s = "") => console.log(s);
const step = (n, s) => say(`\n${c.bold(`[${n}]`)} ${s}`);

/** 读一行输入，关闭回显（用于 token）。非 TTY 时报错退出。 */
function readSecret(prompt) {
	if (!process.stdin.isTTY) {
		console.error("交互输入需要 TTY。改用：GITHUB_TOKEN=xxx node scripts/publish.mjs");
		process.exit(1);
	}
	return new Promise((resolve) => {
		process.stdout.write(prompt);
		const stdin = process.stdin;
		stdin.setRawMode(true);
		stdin.resume();
		let buf = "";
		const onData = (chunk) => {
			for (const ch of chunk.toString("utf8")) {
				if (ch === "\r" || ch === "\n") {
					stdin.removeListener("data", onData);
					stdin.setRawMode(false);
					stdin.pause();
					process.stdout.write("\n");
					resolve(buf);
					return;
				}
				if (ch === "\u0003") {
					stdin.setRawMode(false);
					process.stdout.write("\n已取消。\n");
					process.exit(130);
				}
				if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
				else buf += ch;
			}
		};
		stdin.on("data", onData);
	});
}

async function api(token, method, path, body) {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "dsh-purge-publish",
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// 非 JSON 响应，保留原文用于报错
	}
	return { status: res.status, json, text };
}

function git(args, opts = {}) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts });
}

// git 的全局代理经常还指着已经停掉的旧端口（典型：ClashX 时代的 7890，
// 而现在 Clash Verge 用的是 7897）。不显式覆盖的话推送会直接死在
// "Failed to connect to 127.0.0.1 port 7890"，而且报错看起来像网络不可达。
// 解析顺序：环境变量 → 本机常见端口实测 → 都没有就清空代理走直连。
const PROXY_CANDIDATES = [
	"http://127.0.0.1:7897",
	"http://127.0.0.1:7890",
	"http://127.0.0.1:1087",
	"http://127.0.0.1:6152",
];

function tcpAlive(url) {
	let u;
	try {
		u = new URL(url);
	} catch {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		const sock = net.connect({ host: u.hostname, port: Number(u.port) || 80 });
		const finish = (ok) => {
			sock.destroy();
			resolve(ok);
		};
		sock.setTimeout(700);
		sock.once("connect", () => finish(true));
		sock.once("error", () => finish(false));
		sock.once("timeout", () => finish(false));
	});
}

function asProxyArgs(url) {
	return ["-c", `http.proxy=${url}`, "-c", `https.proxy=${url}`];
}

async function gitProxyArgs() {
	const fromEnv =
		process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
	if (fromEnv && (await tcpAlive(fromEnv))) {
		say(c.dim(`  git 走代理 ${fromEnv}（环境变量）`));
		return asProxyArgs(fromEnv);
	}
	for (const p of PROXY_CANDIDATES) {
		if (await tcpAlive(p)) {
			say(c.dim(`  git 走代理 ${p}（自动探测）`));
			return asProxyArgs(p);
		}
	}
	say(c.dim("  没有可用代理，git 直连"));
	return ["-c", "http.proxy=", "-c", "https.proxy="];
}

// ── 1. 拿 token ────────────────────────────────────────────────────────────
let token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
	say("需要一个 GitHub token（权限见本脚本顶部注释）。");
	say(c.dim("粘贴后不会回显、不会存盘、不会进 shell history。"));
	token = (await readSecret("token: ")).trim();
}
if (!token) {
	console.error(c.bad("空 token，退出。"));
	process.exit(1);
}

// ── 2. 校验 token 与目标账号 ──────────────────────────────────────────────
step(1, `校验 token 并对齐 ${c.bold(`${OWNER}/${REPO}`)}`);
const who = await api(token, "GET", "/user");
if (who.status !== 200) {
	const hint =
		who.status === 401
			? "token 无效或已过期（401）"
			: who.status === 403
				? "token 权限不足或被限流（403）"
				: `HTTP ${who.status}`;
	console.error(c.bad(`  ✗ ${hint}`));
	if (who.text) console.error(c.dim(`    ${who.text.slice(0, 300)}`));
	process.exit(1);
}
const login = who.json?.login;
say(`  ✓ token 属于 ${c.bold(login)}`);
if (login.toLowerCase() !== OWNER.toLowerCase()) {
	console.error(c.bad(`  ✗ 账号不匹配：token 是 ${login} 的，package.json 写的是 ${OWNER}`));
	console.error(c.dim(`    改法：node scripts/set-repo.mjs ${login}/${REPO}`));
	process.exit(1);
}

// ── 3. 建仓库（已存在则跳过）──────────────────────────────────────────────
step(2, "创建仓库");
const exists = await api(token, "GET", `/repos/${OWNER}/${REPO}`);
if (exists.status === 200) {
	const vis = exists.json?.visibility ?? (exists.json?.private ? "private" : "public");
	say(`  · 仓库已存在（${vis}），跳过创建`);
	if (vis !== "public") {
		console.error(c.bad("  ✗ 仓库是 private：插件更新走匿名 tarball 下载，私有会 404。"));
		console.error(c.dim("    去 Settings → General → 最下方 Change visibility 改成 Public 再重跑。"));
		process.exit(1);
	}
} else if (exists.status === 404) {
	const created = await api(token, "POST", "/user/repos", {
		name: REPO,
		description: DESCRIPTION,
		private: false,
		has_issues: true,
		has_wiki: false,
		has_projects: false,
		has_discussions: false,
		auto_init: false,
	});
	if (created.status !== 201) {
		console.error(c.bad(`  ✗ 创建失败：HTTP ${created.status}`));
		if (created.text) console.error(c.dim(`    ${created.text.slice(0, 400)}`));
		process.exit(1);
	}
	say(`  ✓ 已创建 https://github.com/${OWNER}/${REPO}`);
} else {
	console.error(c.bad(`  ✗ 查询仓库状态失败：HTTP ${exists.status}`));
	if (exists.text) console.error(c.dim(`    ${exists.text.slice(0, 300)}`));
	process.exit(1);
}

// ── 4. 配 remote（干净地址，不带 token）───────────────────────────────────
step(3, "配置 origin");
const cleanUrl = `https://github.com/${OWNER}/${REPO}.git`;
const remotes = git(["remote"]).split("\n").filter(Boolean);
if (remotes.includes("origin")) {
	const cur = git(["remote", "get-url", "origin"]).trim();
	if (cur === cleanUrl) say(`  · origin 已指向 ${cleanUrl}`);
	else {
		git(["remote", "set-url", "origin", cleanUrl]);
		say(`  · origin 从 ${c.dim(cur)} 改为 ${cleanUrl}`);
	}
} else {
	git(["remote", "add", "origin", cleanUrl]);
	say(`  ✓ 已添加 origin → ${cleanUrl}`);
}

// ── 5. 推送（token 只出现在这一条命令的临时 URL 里）──────────────────────
step(4, "推送 master 与 tag");
const pushUrl = `https://x-access-token:${token}@github.com/${OWNER}/${REPO}.git`;
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
const tags = git(["tag", "-l"]).split("\n").filter(Boolean);
say(c.dim(`  分支 ${branch}，tag ${tags.join(" ") || "(无)"}`));
const proxyArgs = await gitProxyArgs();
try {
	execFileSync("git", [...proxyArgs, "push", pushUrl, `${branch}:refs/heads/master`, "--tags"], {
		cwd: root,
		stdio: ["ignore", "inherit", "inherit"],
	});
	say(`  ✓ 推送完成`);
} catch {
	console.error(c.bad("  ✗ 推送失败。"));
	console.error(c.dim("    若是 rejected（远程已有内容）：多半建仓库时勾了 README / .gitignore / LICENSE。"));
	console.error(c.dim("    删掉那个仓库重建成空的，再重跑本脚本。"));
	process.exit(1);
}

// ── 6. 验证下载链路（插件更新真正依赖的就是这个 URL）────────────────────
step(5, "验证插件更新用的下载地址");
const tarball = pkg.dsh?.install?.tarball ?? "";
if (!tarball) {
	console.error(c.bad("  ✗ package.json 里没有 dsh.install.tarball"));
	process.exit(1);
}
say(c.dim(`  ${tarball}`));
let code = 0;
let head = null;
try {
	head = await fetch(tarball, { method: "HEAD", redirect: "follow" });
	code = head.status;
} catch (err) {
	console.error(c.bad(`  ✗ 请求失败：${err.message}`));
	process.exit(1);
}
if (code !== 200) {
	console.error(c.bad(`  ✗ HTTP ${code} —— 匿名下载拿不到 tarball，插件「检查更新」会失败`));
	process.exit(1);
}
const size = head?.headers.get("content-length");
say(`  ✓ HTTP 200${size ? `，${(Number(size) / 1024).toFixed(0)} KB` : ""}`);

say(`\n${c.ok("发布完成。")}`);
say(`  仓库   https://github.com/${OWNER}/${REPO}`);
say(`  下载   ${tarball}`);
say(c.dim("\n最后一步（面板侧）：重新 apply 插件，让它重新读 package.json。"));

// fetch 走 undici 的 keep-alive 连接池，请求结束后 socket 仍然挂着，
// 不显式退出的话 Node 会在所有输出打印完之后一直挂着不返回。
process.exit(0);
