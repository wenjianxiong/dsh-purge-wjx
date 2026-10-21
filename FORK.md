# FORK.md — dsh-purge 自维护手册

上游 `YuJunZhiXue/dsh-purge` 已停止维护并从 GitHub 下线。本文件记录接管后的维护方式、
构建顺序、部署步骤，以及已知的坑。

- **原作者**：小杨 — MIT 版权声明、「署名要求」与「严正申明」原样保留，不得删除或弱化
- **本 fork 维护**：稳健熊 — 自 `v1.1.71` 基线起

---

## 0. 现状与证据

| 项 | 值 | 取证方式 |
| --- | --- | --- |
| 上游仓库 | `YuJunZhiXue/dsh-purge` | `package.json` → `repository` |
| 仓库状态 | **已下线（HTTP 404）** | `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/YuJunZhiXue/dsh-purge` |
| npm 包 | **不存在（HTTP 404）** | `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/dsh-purge` |
| 本仓库基线 | `v1.1.71`，上游 sha `15df041ebe0fbfa8ad6681835659bb3b904692de` | `git tag -l` / `git log` |
| 上游自述 | README 第 32 行「暂停更新。作者因工作安排……」 | 归档原文，未改动 |
| 许可 | MIT，原版权行 `Copyright (c) 2026 小杨`，其下追加 fork 维护行 | `LICENSE`（**原版权行不得删改，只能在其下追加**） |

上游不是被恶意删库，是作者资金与精力不足而搁置；仓库随后下线。本地 `~/.dsh/plugins/dsh-purge`
是最后一份可用快照，`applied.json` 显示插件仍在运行。

**合规红线**：MIT 允许 fork、修改、分发，但必须保留原版权声明。README 里的「署名要求」
与「严正申明」继续有效。改动本仓库时不要删除或弱化这两段，不要移除 LICENSE 里的作者署名。

---

## 1. 相对上游的改动

| # | 内容 |
| --- | --- |
| 1 | 基线：上游 `v1.1.71` 完整快照，打 tag `v1.1.71` |
| 2 | 更新链路解耦：`lib/update.js` 的 `REPO` 常量改为运行时解析；新增 `scripts/set-repo.mjs` |
| 3 | 把产物里手工热修的三处回写源码，`build-client.mjs` 重建恢复幂等 |
| 4 | 自维护声明（README 中英）+ 本手册 |
| 5 | 署名落地：`LICENSE` 追加 fork 维护行、`package.json` 补 `author`/`contributors`、welcome 弹窗中英各两处、两份 README 与本手册标注「稳健熊」 |
| 6 | 修正「LICENSE 未做任何改动」的错误表述（追加后该说法失效） |
| 7 | 本手册补首次发布清单，修正 `set-repo` 处数统计（11 → 12） |
| 8 | 更新源改向 `wenjianxiong/dsh-purge-wjx`（12 处；README 与本手册的上游历史引用保留未动） |
| 9 | owner 占位填实 + README 补本仓库地址；提交历史匿名化为 `稳健熊 <wenjianxiong@users.noreply.github.com>` |
| 10 | 注入文本分层：新增 `lib/inject-layers.js`（标记解析、层选择）、`lib/inject-analyzer.js`（只读分析）；`resolveInjectText` 选定来源后按层过滤，默认全量且零行为改变 |
| 11 | 新增 `/layers` 命令与 `purge_status` 层摘要；30 项回归测试入库，`.gitignore` 不再排除 `scripts/test-*` |

> 本表不记 commit hash —— rebase / filter-branch 之后 hash 必变，以 `git log` 为准。

### 更新链路现在的解析顺序

`lib/update.js` 的 `resolveRepo()`：

1. `DSH_PURGE_REPO=owner/repo` 环境变量（临时改向，不落盘）
2. `package.json` 的 `repository.url` → `repository` → `homepage`，取其中的 `owner/repo`
3. 回退到 `FALLBACK_REPO`（原上游地址，保持旧行为）

**含义**：以后换仓库只要改 `package.json` 一处，或跑一次 `set-repo.mjs`。不用再翻代码。

---

## 2. 目录与关键文件

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | 插件入口（`package.json` 的 `main`） |
| `lib/core.js` | 核心：注入、回滚、配置读写、`findDshHome()` |
| `lib/update.js` | 自更新：拉远端 package.json / commit / tag，下载 zip 并应用 |
| `lib/reapply.js` | dsh 升级后重新打补丁（**升级 dsh 后最关键的一条路径**） |
| `lib/rules.js` | 规则/提示词管理 |
| `lib/redteam/` | 演练台：UI、store、tools、skill 装配 |
| `client.js` | **构建产物**，Web 端 UI bundle，不要直接手改（会被重建覆盖） |
| `lib/redteam/client.js` | 上面那个产物的**源码** |
| `cordis.patch.yml` | bundle patch：注册插件、关闭旧红队包行、注入 systemPrompt/tools |
| `scripts/patch-client-dock.mjs` | 构建步骤 1：改造 client.js 结构、插入 drill 标记 |
| `scripts/build-client.mjs` | 构建步骤 2：把 `lib/redteam/client.js` 填进标记之间 |
| `scripts/set-repo.mjs` | 全库改向新仓库（11 处字面量 + 自检） |

`lib/default-prompt-inject.md` 被 `.gitignore` 排除——它是嵌入前的提示词原文，
默认提示词已编译进 `lib/`。要改默认提示词，先看 `scripts/embed-default-prompt.mjs`。

---

## 3. 构建链（顺序不能反）

```bash
node scripts/patch-client-dock.mjs   # 1. 结构改造 + 插入 /* __DSH_PURGE_DRILL_BEGIN__ */ 标记
node scripts/build-client.mjs        # 2. 把 lib/redteam/client.js 填进标记之间
```

`build-client.mjs` 找不到标记会直接报错 `client.js missing drill markers`——那就是第 1 步没跑。

**只改了 `lib/redteam/client.js`** 时，跑第 2 步就够。
**改了 `client.js` 的 dock 结构**（页签、locale key 等）时，两步都要跑。

### 幂等性验证（每次改完源码都跑）

```bash
node scripts/build-client.mjs
git diff --quiet client.js && echo "幂等 ✓" || echo "有漂移，检查源码是否漏同步"
```

上游最后一次发版时 `client.js` 是手改的，三处修复没回写源码（fetch 错误处理、
下载 revoke 延迟、更新弹窗定时器清理）。`2a76998` 已回写，重建现在幂等。
**再引入新漂移时不要让产物孤立存在**——一律回写源码。

---

## 4. 部署到本机

插件运行在 `~/.dsh/plugins/dsh-purge`。它是 dsh 正在加载的活体，**不要在它上面直接改**。

部署清单（与 `lib/update.js` 的 `COPY_NAMES` 保持一致）：

```
lib  bin  docs  client.js  cordis.patch.yml  screenshots.json
package.json  README.md  README.zh-CN.md  LICENSE
```

流程：

```bash
# 1) 备份当前活体
cp -a ~/.dsh/plugins/dsh-purge ~/.dsh/plugins/dsh-purge.bak-$(date +%Y%m%d-%H%M%S)

# 2) 从本仓库同步
rsync -a --delete \
  --include='lib/***' --include='bin/***' --include='docs/***' \
  --include='client.js' --include='cordis.patch.yml' --include='screenshots.json' \
  --include='package.json' --include='README.md' --include='README.zh-CN.md' --include='LICENSE' \
  --exclude='*' \
  ./ ~/.dsh/plugins/dsh-purge/

# 3) 语法自检
node --check ~/.dsh/plugins/dsh-purge/lib/index.js
node --input-type=module -e "import('file://$HOME/.dsh/plugins/dsh-purge/lib/index.js')"

# 4) 重启宿主 / 在面板里重新「应用」，然后看 ~/.dsh/dsh-purge/applied.json 的 sha
```

回滚：把第 1 步的 `.bak-*` 目录换回去，再重启。

---

## 5. 改上游地址

首次接管、或换仓库时跑一次：

```bash
node scripts/set-repo.mjs <owner>/<repo>          # 实际改
node scripts/set-repo.mjs <owner>/<repo> --dry    # 只看会改什么
```

它替换 12 处：`package.json` 6 处（`repository.url` / `homepage` / `bugs.url` /
`dsh.install` 的 `tarball`、`zip`、`git`）、`lib/update.js` 的 `FALLBACK_REPO`、
`lib/redteam/ui.js` 的兜底仓库、`client.js` 的 `welcome.repo`（中英各一）、
`.github/workflows/release.yml` 的守卫与发布提示 2 处。

README 与 `release-notes.md` 里的旧地址**故意不动**——那是署名与历史记录。

改完还要：`git diff` 复核 → commit → 重新部署。

`welcome.repo` 位于 `client.js` 的**基座**（标记区间之外，实测在第 143 / 483 行），
而 `build-client.mjs` 只替换 `/* __DSH_PURGE_DRILL_BEGIN__ */` 与 `/* __DSH_PURGE_DRILL_END__ */ 之间**的内容。
所以 `set-repo.mjs` 直接改产物是正确且必要的，重建不会把它冲掉。
（想确认：`node -e 'const s=require("fs").readFileSync("client.js","utf8");const b=s.indexOf("/* __DSH_PURGE_DRILL_BEGIN__ */");console.log(s.indexOf("welcome.repo")>b?"在标记内":"在基座")'`）

### 首次发布到新仓库（一次性）

仓库名定为 **`dsh-purge-wjx`**。**`package.json` 的 `name` 仍是 `dsh-purge`，不要改** ——
dsh 的插件标识、`cordis.patch.yml` 的 `id: dsh-purge`、`~/.dsh/plugins/<name>` 安装目录、
以及 `lib/update.js` 的 `COPY_NAMES` 都依赖它。仓库名只是托管位置，与包名解耦。

1. 在 GitHub 建**空**仓库 `dsh-purge-wjx`，**不要**勾初始化 README / .gitignore / LICENSE ——
   否则首次 push 会冲突。
2. 先空跑看清单，再实改（`wenjianxiong` 换成 GitHub 用户名，必须 ASCII）：
   ```bash
   node scripts/set-repo.mjs wenjianxiong/dsh-purge-wjx --dry
   node scripts/set-repo.mjs wenjianxiong/dsh-purge-wjx
   ```
3. 复核：`git diff` 应只落在 `package.json` / `lib/update.js` / `lib/redteam/ui.js` /
   `client.js` / `.github/workflows/release.yml` 五个文件；README 与 `release-notes.md` 一条不动。
4. 提交并推送（tag 一起推，`v1.1.71` 是基线标记）：
   ```bash
   git commit -am 'chore: 更新源改向 wenjianxiong/dsh-purge-wjx'
   git remote add origin git@github.com:wenjianxiong/dsh-purge-wjx.git
   git push -u origin master --tags
   ```
5. 验证下载链路真的通（不用打开面板）：
   ```bash
   grep -o 'https://github.com/[^"]*master.tar.gz' package.json
   curl -sI "$(grep -o 'https://github.com/[^"]*master.tar.gz' package.json)" | head -1
   ```
   第一行给出的地址应是 `wenjianxiong/dsh-purge-wjx`，第二行应是 `HTTP/2 200`。
6. 面板侧生效要**重新 apply 插件**（插件在启动时读 `package.json`）；只改文件不重新 apply，
   「检查更新」还会打旧地址。

> 注：若在精简 PATH 环境（例如 agent 的 bash 工具，PATH 只有 `/usr/bin:/bin:...`）里跑，
> `node` 会找不到，用绝对路径 `/opt/homebrew/bin/node`。

---

## 6. dsh 升级后怎么办

`package.json` 里 `dshTarget` 固定为 `0.2.0-rc.2`。dsh 大版本升级后常见断点：

1. **bundle patch 失效**：`cordis.patch.yml` 里的 `insert` 条目、`inject: [systemPrompt, tools]`
   依赖宿主插件 id 与插槽名。宿主改名就注不进去，表现为面板空白或提示词没生效。
2. **systemPrompt 配置面变化**：`includeHarnessIdentity` / `personaPrefix` / `personaSuffix`
   被宿主改结构时，注入会静默失败。
3. **client 插件依赖漂移**：`package.json` 的 `dsh.client.inject` 列的五个
   `@deepseek-ai/dsh-client-*` 包，宿主升级后若改了导出面，UI 会加载不出来。
4. **重新打补丁**：升级完跑一次 `lib/reapply.js` 对应的 CLI / 面板「应用」，
   然后核对 `~/.dsh/dsh-purge/applied.json` 的 `sha` 与 `version` 是否更新。

排查顺序：`~/.dsh/logs/` 里最新一份宿主日志 → 面板是否渲染 → `applied.json` → 再动代码。

---

## 7. 已知问题

| 问题 | 影响 | 处置 |
| --- | --- | --- |
| **`client.js` 基座没有源码** | 第 1–3475 行与第 7689–8736 行（约 4500 行：locale 文案、dock 双页签骨架、welcome 弹窗）只存在于产物里。上游从未提交这部分源码，`patch-client-dock.mjs` 是在产物上打补丁、不是从源码生成 | 改基座就直接改 `client.js` 并提交；`build-client.mjs` 只动标记区间，不会覆盖。**不要**用任何"从头生成 client.js"的思路，那会丢掉这 4500 行 |
| 自动更新已不可用 | 面板「检查更新」会打到已下线的地址，返回失败 | 跑一次 `set-repo.mjs` 指向新仓库；或设 `DSH_PURGE_REPO` |
| `client.js` 曾是手改产物 | 重建会回退三处线上修复 | 已在 `2a76998` 回写源码；改源码后务必跑幂等验证 |
| `lib/default-prompt-inject.md` 不入库 | 新克隆的仓库缺提示词原文 | 从 `lib/` 里已编译的默认值反推，或从运行中的插件目录取 |
| `docs/preview/` 图片较多 | 仓库体积偏大 | 不影响运行，发版时可排除 |
| 上游 issue 历史全丢 | 老问题的结论不可查 | 只能靠 `release-notes.md` 与本文件积累 |
| 层标记必须独占一行 | `<!-- purge:layer NAME -->` 若缩进或在行内，不会被识别（正则要求行首尾）；反过来，代码块里恰好独占一行的同形文本会被当成真标记 | 前一种只是不生效，改格式即可；后一种不丢内容 —— `clean` 保留全部正文，只有层归属判断会错。展示标记语法时请缩进 |
| 分层只管 systemPrompt 注入 | `/rules` 写入 `AGENTS.md` / `CLAUDE.md` 的内容不经分层 | 这是有意的：规则集是另一个注入通道（#74），混进来会让两边语义都不清楚 |

---

## 8. 发版

`.github/workflows/release.yml` 在 push 到 `master` 时打 tag 并发 Release。它的守卫是
`if: github.repository == 'YuJunZhiXue/dsh-purge'`——**fork 后必须改成自己的仓库**，
否则永远不会触发（`set-repo.mjs` 会一起改掉）。

发版前手动过一遍：

```bash
node --check lib/index.js
node --check lib/core.js
node --check lib/reapply.js
node --input-type=module -e "import('./lib/index.js')"
node scripts/test-inject-layers.mjs     # 分层解析回归（15 项）
node scripts/test-layer-config.mjs      # 层配置读写回归（15 项）
sed -n '1p' release-notes.md        # 必须等于 "# <当前 package.json 的 version>"
```

`scripts/embed-default-prompt.mjs` 与 `scripts/build-client.mjs` 用 `npm run embed-prompt` /
`npm run build:client` 触发，两者都只依赖 Node 内置模块，不需要 `npm install`。
