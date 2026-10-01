#!/usr/bin/env node
/**
 * `npm run dev` 的前置守卫（predev）：端口被占用时给出**可操作**的提示，
 * 而不是 Vite 的一段 EADDRINUSE 裸堆栈。
 *
 * 为什么需要：`vite.config.ts` 用了 `strictPort: true` 且固定端口，因为 Tauri 的
 * `devUrl` 写死了 `http://localhost:1420` —— 端口被占时**刻意不静默换端口**（换了宿主连不上）。
 * 但默认报错不告诉你「谁占着、怎么解」，排查成本高。本脚本补上这一层。
 *
 * 退出码：端口空闲 → 0（`dev` 继续）；被占用 → 1（打印占用者与解法）。
 * 跨平台：Windows 用 netstat/taskkill，macOS/Linux 用 lsof/kill。
 */
import net from "node:net";
import { spawnSync } from "node:child_process";

const PORT = Number(process.env.PORT ?? 1420);
/** vite 监听 `localhost`，在 Windows 上可能落在 ::1；两个回环都探一次，避免漏判。 */
const HOSTS = ["127.0.0.1", "::1"];

function probe(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const finish = (value) => {
      sock.destroy();
      resolve(value);
    };
    sock.setTimeout(500);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

const busy = (await Promise.all(HOSTS.map((h) => probe(h, PORT)))).some(Boolean);
if (!busy) process.exit(0);

console.error("");
console.error(`✗ 端口 ${PORT} 已被占用：dev server 起不来。`);
console.error("");
console.error(`  vite.config.ts 用 strictPort 固定 ${PORT}，因为 Tauri 的 devUrl 就是`);
console.error(`  http://localhost:${PORT} —— 换端口宿主会连不上，所以这里刻意不自动避让。`);
console.error("  最常见原因：上一个 `npm run dev` / `tauri dev` 没退出干净。");
console.error("");
console.error("  找出并结束占用者：");
if (process.platform === "win32") {
  console.error(`    netstat -ano | findstr :${PORT}     # 末列是 PID`);
  console.error(`    taskkill /PID <PID> /T /F           # /T 连同子进程一起结束`);
} else {
  console.error(`    lsof -ti :${PORT} | xargs kill      # 或 kill -9`);
}
console.error("");
console.error("  只想跑前端预览（不接 Tauri）时，可临时换端口：");
console.error(`    npm run dev -- --port ${PORT + 1}`);
console.error("");

// 尽力把占用者一并打出来（失败不影响退出码与上面的通用命令）
try {
  const isWin = process.platform === "win32";
  const res = spawnSync(isWin ? "netstat" : "lsof", isWin ? ["-ano"] : ["-i", `:${PORT}`, "-P", "-n"], {
    encoding: "utf8",
  });
  const rows = (res.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes(`:${PORT}`) && /LISTEN/i.test(line));
  if (rows.length > 0) {
    console.error("  当前占用者：");
    for (const row of rows) console.error(`    ${row.trim()}`);
    console.error("");
  }
} catch {
  /* 可选信息 */
}

process.exit(1);
