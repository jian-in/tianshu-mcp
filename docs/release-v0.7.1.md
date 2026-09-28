# v0.7.1 — Open Design 适配器真机跑通 + 产物取回

> 详见 [Open Design CDP 适配说明](opendesign-cdp.md) 与 [CHANGELOG](../CHANGELOG.md#071---2026-09-28)。

## 背景

内置 agent `opendesign`（Open Design 桌面端，`driver=gui` / `adapter=opendesign-gui`）此前
是「代码就绪但真机未跑通」：CDP 接不上、任务送得进去却拿不到产物，视觉验收整段空转。
本版把整条链路在真机上打通。

## 新增

- **产物取回 `src/agents/opendesign/artifact.ts`**：Open Design 的设计稿**不会自动落到任务目录**，
  而在它自己的产物存储里 —— `<dataRoot>/projects/<projectId>/<entry>`
  （`dataRoot` = `%APPDATA%\Open Design\namespaces\<namespace>\data`，`projectId` 取自产物 URL
  `od://app/projects/<id>/...`，`entry`/`status` 由同目录的 `<entry>.artifact.json` 给出）。
  任务终态后复制到任务目录，视觉验收随即可推导静态入口。
  **这是增值步骤**：失败只写进 `progressSummary`，**不改变任务终态**。
- **`src/agents/opendesign/export.ts`**：导出方式归一、产物定位、保存对话框地址栏匹配判据、
  `zip` 解压命令（为后续打通 zip 路径留基础）。
- **真机适配修正**：设计系统面板的真实 testid 为 `project-ds-picker-*`；模型菜单项是
  `role=radio`（不是 `option`）；选择器候选改为**命中即停**（primary 命中后不再并入 fallback）；
  新增 daemon 就绪等待（产品打开文件夹选择器前要与 daemon 完成鉴权握手，实测启动后约 30s 才驻留）；
  任务书输入前先清空输入框；工作目录 `already-bound` 判据补上 `recentLinkedDirs` 旁证。
- **`visual.ts` 根层唯一 html 兜底**：白名单认不出产品给产物起的名字，现当白名单一个都没命中、
  且项目根下 html **恰好唯一**时认它；多个 html 仍不猜。

## 修复

- **CDP 永远接不上**：固定 `--remote-debugging-port` 被**不承载窗口的 launcher 进程**先绑定并驻留，
  真窗口进程绑定失败 → `/json/version` 正常而 `/json/list` 恒为 `[]`（端口连得上却无 page target）。
  改用 `=0`（各拿随机端口）+ 按 `DevToolsActivePort` 定位真窗口后，**真机 4 秒接管**。
- **就绪判据在 `instance.ts` 有一份不同步的副本**（缺 `^od://`），而真机页面是
  `title=OpenDesign`（无空格）+ `url=od://app/` → 收敛为 `cdp.ts` 单一真源并容忍有无空格。
- **主窗口排序会被同标题辅助页抢走**（`od://app/desktop-pet` 标题同样是 `OpenDesign`）。
- **测试依赖本机进程**：`waitForDaemonReady` 曾走真实进程枚举，导致用例随「本机是否开着
  Open Design」飘（单跑通过、全跑失败）。改为可注入依赖后，**关闭本机 Open Design 仍全绿**。

## 真机验证

- 产物 `onboarding-guide.html`（37,838 字节、自包含）落到任务目录，视觉验收识别出
  `/onboarding-guide.html` 入口。
- 门禁：`test` 115 passed / 0 failed，`typecheck` / `lint` / `build` / `check:stdio`(8/8) 全绿。

## 已知限制

- **`zip` 导出方式未打通**：CDP 观测到下载确实发生（`suggestedFilename` 为中文 zip 名），
  但终态 `canceled` —— 产品主进程接管了下载，`Browser.setDownloadBehavior` 被覆盖。
  `html` 路径已完全可用，zip 待后续优化。
