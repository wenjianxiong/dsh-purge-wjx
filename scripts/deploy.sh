#!/usr/bin/env bash
# 一条命令完成「同步源码 → 重装 pnpm 依赖 → 重启宿主」。
#
# 为什么需要最后两步：dsh 的 web profile 把插件声明成 pnpm 的 file: 依赖，
# pnpm 安装时会把 ~/.dsh/plugins/dsh-purge 复制进 .pnpm store，node_modules 里
# 只是指向那份副本的符号链接。只同步源目录而不重装，dsh 会继续加载旧副本。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${DSH_PURGE_SRC:-$HOME/.dsh/plugins/dsh-purge}"
PROFILE="${DSH_PURGE_PROFILE:-$HOME/.dsh/profiles/web}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少 $1" >&2; exit 1; }; }
need rsync
need node
need pnpm

# store 路径里的 cordis 版本会随 profile 变化，动态找
store_path() {
  ls -d "$PROFILE"/node_modules/.pnpm/dsh-purge@file*/node_modules/dsh-purge 2>/dev/null | head -1
}

echo "== 1/5 备份源目录 =="
BAK="$HOME/.dsh/backups/dsh-purge-src-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BAK"
rsync -a "$SRC/" "$BAK/"
echo "   $BAK"

echo "== 2/5 同步仓库到源目录 =="
rsync -a --delete \
  --include='lib/***' --include='bin/***' --include='docs/***' \
  --include='client.js' --include='cordis.patch.yml' --include='screenshots.json' \
  --include='package.json' --include='README.md' --include='README.zh-CN.md' --include='LICENSE' \
  --exclude='*' \
  "$REPO/" "$SRC/"

echo "== 3/5 语法自检 =="
node --check "$SRC/lib/index.js"
node --input-type=module -e "import('file://$SRC/lib/index.js').then(m => {
  const missing = ['apply', 'default', 'name'].filter(k => !(k in m));
  if (missing.length) { console.error('导出缺失: ' + missing.join(',')); process.exit(1); }
  console.log('   index.js 语法与导出 OK');
})"

VER_SRC="$(node -p "require('$SRC/package.json').version")"
echo "   源目录版本 $VER_SRC"

echo "== 4/5 重装 pnpm 依赖（关键步骤）=="
BEFORE="$(store_path || true)"
if [ -n "$BEFORE" ]; then
  BAK_STORE="$HOME/.dsh/backups/dsh-purge-store-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BAK_STORE"
  rsync -a "$BEFORE/" "$BAK_STORE/"
  echo "   store 备份 $BAK_STORE"
fi
(cd "$PROFILE" && pnpm install --prefer-offline 2>&1 | tail -3)

echo "== 4.5/5 清理旧备份 =="
# 每次部署留两份备份（源 + store），不回收的话几十次就是几百 MB。
node "$REPO/scripts/prune-backups.mjs" --keep 3 | tail -2 || true

STORE="$(store_path || true)"
[ -n "$STORE" ] || { echo "找不到 .pnpm store，安装可能失败" >&2; exit 1; }
VER_STORE="$(node -p "require('$STORE/package.json').version")"
echo "   store 版本 $VER_STORE"
if [ "$VER_SRC" != "$VER_STORE" ]; then
  echo "版本不一致：源 $VER_SRC / store $VER_STORE" >&2
  exit 1
fi

echo "== 5/5 重启宿主 =="
PID="$(pgrep -f 'dsh web' | head -1 || true)"
if [ -z "$PID" ]; then
  echo "   没有在跑的 dsh web，跳过重启"
else
  touch "$HOME/.dsh/logs/.restart-requested"
  kill -TERM "$PID"
  echo "   已向 PID $PID 发 SIGTERM；watchdog 会拉起，浏览器记得硬刷新"
fi

echo
echo "完成。验证：grep -c '<新符号>' \"$STORE/client.js\""
