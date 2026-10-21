# FORK.md — dsh-purge 自维护手册

上游 `YuJunZhiXue/dsh-purge` 已停止维护并从 GitHub 下线。本文件记录接管后的维护方式、
构建顺序、部署步骤，以及已知的坑。

---

## 0. 现状与证据

| 项 | 值 | 取证方式 |
| --- | --- | --- |
| 上游仓库 | `YuJunZhiXue/dsh-purge` | `package.json` → `repository` |
| 仓库状态 | **已下线（HTTP 404）** | `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/YuJunZhiXue/dsh-purge` |
| npm 包 | **不存在（HTTP 404）** | `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/dsh-purge` |
| 本仓库基线 | `v1.1.71`，上游 sha `15df041ebe0fbfa8ad6681835659bb3b904692de` | `git tag -l` / `git log` |
| 上游自述 | README 第 32 行「暂停更新。作者因工作安排……」 | 归档原文，未改动 |
| 许可 | MIT，`Copyright (c) 2026 小杨` | `LICENSE`（**不得改动**） |

上游不是被恶意删库，是作者资金与精力不足而搁置；仓库随后下线。本地 `~/.dsh/plugins/dsh-purge`
是最后一份可用快照，`applied.json` 显示插件仍在运行。

**合规红线**：MIT 允许 fork、修改、分发，但必须保留原版权声明。README 里的「署名要求」
与「严正申明」继续有效。改动本仓库时不要删除或弱化这两段，不要移除 LICENSE 里的作者署名。

---

## 1. 相对上游的改动

| commit | 内容 |
| --- | --- |
| `a6d1096` | 基线：上游 v1.1.71 完整快照，打 tag `v1.1.71` |
| `a6c643c` | 更新链路解耦：`lib/update.js` 的 `REPO` 常量改为运行时解析；新增 `scripts/set-repo.mjs` |
| `2a76998` | 把产物里手工热修的三处回写源码，`build-client.mjs` 重建恢复幂等 |

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

它替换 11 处：`package.json`（repository/homepage/bugs/install 三条下载地址）、
`lib/update.js` 的 `FALLBACK_REPO`、`lib/redteam/ui.js` 的兜底仓库、
`client.js` 的 `welcome.repo`（中英各一）、`.github/workflows/release.yml` 的守卫与发布提示。

README 与 `release-notes.md` 里的旧地址**故意不动**——那是署名与历史记录。

改完还要：`git diff` 复核 → commit → 重新部署。

`welcome.repo` 位于 `client.js` 的**基座**（标记区间之外，实测在第 143 / 483 行），
而 `build-client.mjs` 只替换 `/* __DSH_PURGE_DRILL_BEGIN__ */` 与 `/* __DSH_PURGE_DRILL_END__ */ 之间**的内容。
所以 `set-repo.mjs` 直接改产物是正确且必要的，重建不会把它冲掉。
（想确认：`node -e 'const s=require("fs").readFileSync("client.js","utf8");const b=s.indexOf("/* __DSH_PURGE_DRILL_BEGIN__ */");console.log(s.indexOf("welcome.repo")>b?"在标记内":"在基座")'`）

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
sed -n '1p' release-notes.md        # 必须等于 "# <当前 package.json 的 version>"
```

`scripts/embed-default-prompt.mjs` 与 `scripts/build-client.mjs` 用 `npm run embed-prompt` /
`npm run build:client` 触发，两者都只依赖 Node 内置模块，不需要 `npm install`。
