#!/usr/bin/env node
/**
 * 统计 GitHub 发行资产的下载数，按 tag 前缀分列，写入 update/stats.json。
 *
 * 为什么需要它：shields 内置的 github/downloads 徽章只能统计「全仓合计」或
 * 「单个 tag」，无法只算 MCP（`v*`）前缀 —— 前者会把 GUI 的下载混进来（当前
 * 全仓 61 里有 45 属于 GUI），后者只能绑定某个具体版本（最新版当前为 0）。
 * README 需要「MCP 压缩包下载次数」与「GUI 下载次数」两个互不混淆、且随事实
 * 自动更新的数字，故自建该数据源：本脚本产出 update/stats.json，README 的
 * 两个徽章经 shields 的 dynamic/json 读取它。
 *
 * 用法：node scripts/gh-download-stats.mjs
 * 认证：读 GH_TOKEN 或 GITHUB_TOKEN（CI 内即 secrets.GITHUB_TOKEN）；都不设时
 *       走匿名请求，受 60 次/小时的速率限制，够手动跑一次但不适合定时任务。
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY ?? 'lanlan0811/tianshu-mcp';
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
const OUT_FILE = path.join(process.cwd(), 'update', 'stats.json');
/** GUI 独立版本用 `gui-v*` 前缀，其余（`v*`）一律归 MCP 主包 */
const GUI_TAG_PREFIX = 'gui-v';

async function fetchAllReleases() {
  const releases = [];
  // 每页 100，最多翻 20 页（2000 个发行版）；不足 100 条即已到末页。
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
        },
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText}（第 ${page} 页）`);
    }
    const batch = await res.json();
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases;
}

const releases = await fetchAllReleases();
let mcpDownloads = 0;
let guiDownloads = 0;
for (const release of releases) {
  const downloads = (release.assets ?? []).reduce((sum, a) => sum + (a.download_count ?? 0), 0);
  if (String(release.tag_name).startsWith(GUI_TAG_PREFIX)) {
    guiDownloads += downloads;
  } else {
    mcpDownloads += downloads;
  }
}

const stats = {
  mcpDownloads,
  guiDownloads,
  totalDownloads: mcpDownloads + guiDownloads,
  releaseCount: releases.length,
  generatedAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
console.log(`update/stats.json 已刷新：${JSON.stringify(stats)}`);
