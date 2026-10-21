/**
 * 目标路径分区与可写判定。
 *
 * 桌面安装树（resources / app.asar）和 Web profile 是两个互不重叠的写入域：
 * 一次 apply 只能动自己那一侧，否则 Web 侧清洗会把桌面端文件写坏，反之亦然。
 * 这里只回答"这个路径属于哪一区、当前宿主能不能写它"，不做任何写入。
 */

import path from "node:path";
import * as desktop from "./desktop.js";
import { adapterFor, detectSurface } from "./surface.js";
import { hostFs } from "./extract-asar.js";

function realNorm(fp) {
  if (!fp) return "";
  try {
    return hostFs.realpathSync(fp).replace(/\\/g, "/").toLowerCase();
  } catch {
    return path.resolve(fp).replace(/\\/g, "/").toLowerCase();
  }
}

export function pathZone(fp) {
  if (!fp) return "missing";
  const n = realNorm(fp);
  if (desktop.isInsideDesktopInstall(fp) || desktop.isInsideDesktopInstall(n)) return "desktop-install";
  if (/\/profiles\/desktop(\/|$)/.test(n)) return "desktop-profile";
  if (/\/profiles\/web(\/|$)/.test(n)) return "web-profile";
  if (n.includes("/npm-global")) return "web-install";
  return "shared";
}

export function allowTargetPath(fp, surface = detectSurface()) {
  const zone = pathZone(fp);
  if (adapterFor(surface) === "desktop") {
    // 桌面只动本机桌面树 + 共享的 $DSH_HOME/.agent-presets，不碰 Web / npm-global。
    return zone === "desktop-install" || zone === "desktop-profile" || zone === "shared";
  }
  return zone !== "desktop-install" && zone !== "desktop-profile";
}

/** 按正在清洗的 aiBase 判定路径，多宿主 Apply 时 CLI/Web 也能写桌面 resources/app。 */
export function allowTargetPathForAiBase(fp, aiBase) {
  const zone = pathZone(fp);
  if (aiBase && desktop.isInsideDesktopInstall(aiBase)) {
    return zone === "desktop-install" || zone === "desktop-profile" || zone === "shared";
  }
  return zone !== "desktop-install" && zone !== "desktop-profile";
}
