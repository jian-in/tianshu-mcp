# Open Design 真机证据目录

本目录存放 `scripts/probe-opendesign.mjs` 在**真机**上产出的探针证据，用于回填
[docs/opendesign-cdp.md](../opendesign-cdp.md) §4.4 的「待回填」表与 §4.1 的选择器取证表。

为什么需要它：选择器虽然已按**产品自身的产物**（Web 前端 bundle 的 `data-testid`）落地，
但「这些钩子在真机当前版本上确实命中、且命中数为 1」必须在真机上取证一次，否则
`docs/opendesign-cdp.md` 的证据链缺少最后一环。

英文版：[README.en.md](README.en.md)

## 采集命令（在**可联网**的普通终端执行，约 2 分钟）

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue
cd <仓库根>
npm run build
node scripts/probe-opendesign.mjs all --launch --save
```

- `--save` 默认写入**本目录**，文件名含时间戳；输出同时打印到 stdout，便于现场阅读。
- 探针**默认只读**：不点击、不输入、不发送；`--launch` 只允许在无可用实例时启动一个窗口。
- 已开着的 Open Design 若**未**开启调试端口：单实例锁会让启动器转交参数后自行退出——
  先手动关掉它再跑（适配器此时会如实转 `needs_user(close_existing_instance)`，不 kill 用户进程）。
- 失败也照样落盘：**失败现场本身就是证据**（例如本沙箱内 `/json` 连接成功却不响应）。

## 采完要做什么

1. 把证据文件里 `anchors` 段（每个语义键的**命中数 + 首个文本**）回填
   `docs/opendesign-cdp.md` §4.4 的表（中英两份都要填）；
2. 若某个键的命中数与期望不符，按 §4.1 核对：优先用 `profile.gui.selectors` 按语义键热覆盖
   （**覆盖即权威**，不混入内置 fallbacks），必要时再改 `src/agents/opendesign/selectors.ts` 的 `primary`；
3. 再做一次真实 `run_task`（`designDirection="原型"`、`designSystem="Claude"`、指定模型），
   把关键截图与任务数据目录里的 `agent-0.log` 一并放到本目录，并在
   `docs/opendesign-cdp.md` 记录结论（含「验收失败 → 自动返修 → 通过」一轮的结果）。

## 目录约定

- 本目录的文件由**探针/任务**产出，不是手写文档；`package.json` 的 `files` 已包含本目录，
  因此随 npm 包一起分发是预期行为。
- 命名：探针证据为 `opendesign-probe-<ISO 时间戳>.md`；真机任务证据建议用
  `opendesign-run-<taskId>-<轮次>.png|log`，便于与任务数据目录对照。