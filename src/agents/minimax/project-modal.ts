/**
 * MiniMax Code 项目创建：**应用内 HTML 模态框** → 原生 `Select Directory` 对话框两步。
 *
 * 真机实测（2026-10-05，MiniMax Code 3.1.0）——这是本适配器的一处关键修正：
 *
 * 点 `[data-testid="sidebar-create-project-trigger"]`（「新建项目」）**不直接**弹原生对话框，
 * 而是先弹一个**应用内 HTML 模态框**（`.responsive-modal-mask`），内容为：
 *
 * ```text
 * 创建项目
 * 选择文件夹以创建项目
 * 文件夹 [选择文件夹 Ctrl+O]      ← 这个按钮才触发原生 Select Directory
 * 项目名称 [____]
 * [取消] [创建项目]
 * ```
 *
 * 因此绑定链是**两步**：
 *   1. 点「新建项目」→ 等应用内模态框出现；
 *   2. 模态框里点「选择文件夹」→ 原生 `Select Directory` 对话框出现 → 填路径（dialog.ts）；
 *   3. 原生对话框确认关闭后 → 应用内模态框的「文件夹」行应已回填路径 → 点「创建项目」提交。
 *
 * **只走一步会把「点新建项目毫无反应」误判成选择器失效**（真机踩到：点击后原生对话框始终不出现，
 * 因为应用内模态框正盖在界面上吞掉了后续所有点击）。
 */
import type { MinimaxCdpClient } from "./cdp.js";
import { modalProjectExpression, modalChooseFolderPointExpression, modalSubmitPointExpression, modalOpenExpression } from "./dom.js";

export interface OpenProjectModalResult {
  /** 应用内模态框是否已打开 */
  opened: boolean;
}

/** 打开「创建项目」应用内模态框（点侧栏「新建项目」），并等它真正渲染出来 */
export async function openProjectModal(
  cdp: MinimaxCdpClient,
  deadlineMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<OpenProjectModalResult> {
  if (await cdp.modalOpen()) return { opened: true };
  const deadline = Date.now() + deadlineMs;
  let lastClick = 0;
  while (Date.now() < deadline) {
    if (Date.now() - lastClick >= 1_500) {
      await cdp.createProject();
      lastClick = Date.now();
    }
    if (await cdp.modalOpen()) return { opened: true };
    await sleep(150);
  }
  return { opened: false };
}

/** 模态框里点「选择文件夹」→ 触发原生 Select Directory 对话框 */
export async function clickModalChooseFolder(cdp: MinimaxCdpClient): Promise<boolean> {
  return cdp.clickModalChooseFolder();
}

/** 原生对话框回填后点「创建项目」提交（失败返回 false，调用方按 readback 处理） */
export async function submitProjectModal(cdp: MinimaxCdpClient): Promise<boolean> {
  return cdp.submitProjectModal();
}

/** 读模态框当前内容（诊断：包含文件夹行是否已回填路径） */
export async function readProjectModal(cdp: MinimaxCdpClient): Promise<string> {
  return cdp.modalText();
}

/** 关闭模态框（失败收尾：残留模态框会吞掉后续所有点击） */
export async function dismissProjectModal(cdp: MinimaxCdpClient): Promise<void> {
  await cdp.dismissModal();
}

export { modalProjectExpression, modalChooseFolderPointExpression, modalSubmitPointExpression, modalOpenExpression };
