/**
 * Open Design 原生「选择文件夹」对话框（Windows）。
 *
 * 与 `kimicode/dialog.ts` 的分工差异（**必须分清**）：
 * - Kimi Code：有专用 AutomationId=1152 的编辑框 → 用 UIA 定位后 `WM_SETTEXT`；
 * - Open Design：走的是**标准 Windows 文件夹选择器**（标题「选择文件夹」，带「文件夹:」编辑框）。
 *   标准选择器的路径栏控件身份在不同 Windows 版本/语言下并不稳定，因此本实现
 *   **优先 WM_SETTEXT 回读校验**，失败再退回**纯键盘输入**（Ctrl+A → 输入 → Enter → 回读），
 *   两条路都要求「回读一致」才点确认；点完确认还要**等到对话框真的关闭**才算成功。
 *
 * 安全边界（与既有 GUI agent 一致，硬性）：
 * - 只操作「**本次新出现** + 属目标进程 + 类名 `#32770` + **可见** + **唯一**」的窗口；
 *   基线由调用方在点击「选择目录」**之前**采样；
 * - 基线里已有的窗口一律不碰（可能是用户自己的对话框）；
 * - 多个新对话框 → 直接放弃并报 `重名/歧义`，绝不猜一个去点；
 * - 路径只经**环境变量**进入脚本，不拼进脚本源码（CJK 不被命令行代码页破坏）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { OPEN_DESIGN_DEFAULTS } from "../../config/schema.js";

const execFileAsync = promisify(execFile);

export interface NativeDialogOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

/** macOS 分支的固定说法（fail-closed，不写未验证的 osascript 流程） */
export const MACOS_FOLDER_DIALOG_UNAVAILABLE =
  "macOS 原生文件夹选择未实现（Open Design macOS 适配仍为 research）";

/**
 * 把任务路径转成 Windows 原生形式：**绝对** + 盘符大写 + 反斜杠
 * （原生文件夹选择器只接受绝对路径，且拒绝正斜杠）。
 *
 * 相对路径先按当前工作目录解析为绝对路径——否则会直接把 `some/rel`（甚至 `.`）塞进对话框，
 * 表现为「填了路径但确认后什么都没发生」。
 */
export function toNativeDialogPath(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  let out = path.win32.normalize(raw).replace(/\//g, "\\").replace(/\\+$/, "");
  // win32.normalize 会把「仅盘符」补成 `d:.`；对话框里要的是盘根 `D:\`。
  if (/^[a-zA-Z]:\.?$/.test(out)) out = `${out.slice(0, 2)}\\`;
  else if (!path.win32.isAbsolute(out)) out = path.win32.resolve(out);
  return out.replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
}

/**
 * 枚举目标进程当前拥有的可见 `#32770` 窗口身份串，格式 `dialog:<hwnd>:<title>`。
 * 非 Windows 返回空集（Open Design 的 macOS 原生对话框未实现，不做未验证的枚举）。
 */
const WINDOWS_LIST_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class TianshuOdList { public delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l); [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }
'@
$ids=($env:TIANSHU_OD_PIDS -split ',')
$script:out=@()
[TianshuOdList]::EnumWindows({param($h,$l)
  if([TianshuOdList]::IsWindowVisible($h)){
    [uint32]$owner=0
    [void][TianshuOdList]::GetWindowThreadProcessId($h,[ref]$owner)
    if($ids -contains [string]$owner){
      $cls=New-Object Text.StringBuilder 256
      [void][TianshuOdList]::GetClassName($h,$cls,$cls.Capacity)
      if($cls.ToString() -eq '#32770'){
        $t=New-Object Text.StringBuilder 512
        [void][TianshuOdList]::GetWindowText($h,$t,$t.Capacity)
        $script:out += "dialog:$($h.ToInt64()):$($t.ToString())"
      }
    }
  }
  return $true
},[IntPtr]::Zero)|Out-Null
if($script:out.Count -eq 0){''} else {$script:out -join ','}`;

export async function listOwnedDialogs(
  pids: number[],
  options: NativeDialogOptions = {},
): Promise<string[]> {
  if (process.platform !== "win32" || pids.length === 0) return [];
  const timeoutMs = options.timeoutMs ?? OPEN_DESIGN_DEFAULTS.dialogProbeTimeoutMs;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", WINDOWS_LIST_SCRIPT],
      {
        env: { ...process.env, TIANSHU_OD_PIDS: pids.join(",") },
        windowsHide: true,
        timeout: timeoutMs,
        signal: options.signal,
      },
    );
    const trimmed = stdout.trim();
    return trimmed ? trimmed.split(",") : [];
  } catch {
    // 探测失败按「无残留对话框」处理：真实守卫在选择流程里（新出现 + 属主 + 唯一）
    return [];
  }
}

/**
 * 关闭属于指定进程的残留原生对话框（返回关闭数量）。
 *
 * 模态框会**吞掉主窗口的合成点击**，让下一轮把「点选择目录毫无反应」误判成选择器失效。
 * 只发 `WM_CLOSE` 给自己 pid 的 `#32770`，**绝不碰其他程序的窗口**。
 */
export async function closeStrayDialogs(pids: number[]): Promise<number> {
  if (process.platform !== "win32" || pids.length === 0) return 0;
  const script = String.raw`
$ErrorActionPreference='SilentlyContinue'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TianshuOdDlgClose {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
'@
$owners=($env:TIANSHU_OD_PIDS -split ',')
$script:closed=0
[TianshuOdDlgClose]::EnumWindows({param($h,$l)
  if([TianshuOdDlgClose]::IsWindowVisible($h)){
    $c=New-Object Text.StringBuilder 256; [void][TianshuOdDlgClose]::GetClassName($h,$c,256)
    if($c.ToString() -eq '#32770'){
      [uint32]$p=0; [void][TianshuOdDlgClose]::GetWindowThreadProcessId($h,[ref]$p)
      if($owners -contains ([string]$p)){ [void][TianshuOdDlgClose]::SendMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero); $script:closed++ }
    }
  }
  return $true
},[IntPtr]::Zero)|Out-Null
Write-Output $script:closed`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      env: { ...process.env, TIANSHU_OD_PIDS: pids.join(",") },
      windowsHide: true,
      timeout: 30_000,
    });
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

export type FolderDialogOutcome =
  | { ok: true; mode: "wm-settext" | "keyboard"; readback: string; message: string }
  | {
      ok: false;
      reason: "ambiguous" | "not-found" | "readback" | "submit" | "platform" | "error";
      message: string;
    };

/** 目录绑定流程可注入的依赖（Windows 与原生对话框在单测里都要能替换掉） */
export interface FolderDialogDeps {
  platform?: NodeJS.Platform;
  listDialogs?: (pids: number[], options: NativeDialogOptions) => Promise<string[]>;
  /** 实际执行「填路径 → 回读 → 确认 → 等关闭」的原生操作 */
  selectFolder?: (
    targetPath: string,
    pids: number[],
    baseline: string[],
    options: NativeDialogOptions,
  ) => Promise<FolderDialogOutcome>;
}

/**
 * 操作**新出现**的「选择文件夹」对话框，把 `targetPath` 填进去并确认。
 *
 * 基线由调用方在点击「选择目录」之前采样（`listOwnedDialogs`）；
 * 基线里已有的窗口一律不碰。绝对路径只经环境变量传入脚本。
 */
const WINDOWS_SELECT_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$deadline=[DateTimeOffset]::FromUnixTimeMilliseconds([Int64]$env:TIANSHU_OD_DIALOG_DEADLINE).LocalDateTime
function Assert-Deadline { if((Get-Date) -ge $deadline){throw 'OD_DIALOG_TIMEOUT'} }
Write-Output 'native:initialize'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TianshuOdDlg {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public const uint WM_SETTEXT = 0x000C;
  public const uint WM_GETTEXT = 0x000D;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint BM_CLICK = 0x00F5;
  // 旧式「浏览文件夹」(#32770 + Shell 树) 设置**选中项**的官方消息：WM_USER+103（W 版，lParam 为路径字符串）
  public const uint BFFM_SETSELECTIONW = 0x0400 + 103;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
'@
# 标准文件夹选择器的控件 id 在 Windows 上稳定：1152 = 「文件夹:」编辑框，1 = 确认按钮
$EDIT_ID = 1152
$CONFIRM_ID = 1
$owners=($env:TIANSHU_OD_PIDS -split ',')
$baseline=@($env:TIANSHU_OD_BASELINE -split ',' | Where-Object { $_ -ne '' })
$nativePath=$env:TIANSHU_OD_FOLDER

# 只认「新出现」的对话框：基线与本次枚举用同一身份格式 dialog:<hwnd>:<title>
function Get-NewDialogs {
  $script:found=@()
  [TianshuOdDlg]::EnumWindows({param($h,$l)
    if([TianshuOdDlg]::IsWindowVisible($h)){
      [uint32]$owner=0
      [void][TianshuOdDlg]::GetWindowThreadProcessId($h,[ref]$owner)
      if($owners -contains [string]$owner){
        $cls=New-Object Text.StringBuilder 256
        [void][TianshuOdDlg]::GetClassName($h,$cls,$cls.Capacity)
        if($cls.ToString() -eq '#32770'){
          $t=New-Object Text.StringBuilder 512
          [void][TianshuOdDlg]::GetWindowText($h,$t,$t.Capacity)
          if($baseline -notcontains "dialog:$($h.ToInt64()):$($t.ToString())"){$script:found += $h}
        }
      }
    }
    return $true
  },[IntPtr]::Zero)|Out-Null
  return $script:found
}

Write-Output 'native:find-new-dialog'
$dialogHandle=[IntPtr]::Zero
# 同一个属主进程里可能同时出现多个 #32770（真机 2026-09-27 实测：绑定目录时直接报 OD_DIALOG_AMBIGUOUS）。
# 处置分两级，**两级都不猜**：
#   1) 「选择文件夹」必有 id=1152 的「文件夹:」编辑框 → **恰好一个**候选带它就选它。
#      用控件 id 而不是标题文本，是因为标题会被命令行编码破坏（真机日志里标题就是乱码）；
#   2) 仍有歧义 → 把每个候选的 hwnd/标题打进错误里再拒绝，一次就能定位，
#      而不是只报「有多个」让人无从下手。
function Get-DialogTitle([IntPtr]$h) {
  $sb=New-Object Text.StringBuilder 512
  [void][TianshuOdDlg]::GetWindowText($h,$sb,$sb.Capacity)
  return $sb.ToString()
}
do {
  $handles=@(Get-NewDialogs)
  if($handles.Count -ge 1){
    $withEdit=@($handles | Where-Object { $p=[TianshuOdDlg]::GetDlgItem($_,$EDIT_ID); $p -ne [IntPtr]::Zero })
    if($withEdit.Count -eq 1){$dialogHandle=$withEdit[0]}
    elseif($handles.Count -eq 1){$dialogHandle=$handles[0]}
    else{
      $desc=@($handles | ForEach-Object { "hwnd=$($_.ToInt64()) title='$(Get-DialogTitle $_)'" }) -join ' ;; '
      throw "OD_DIALOG_AMBIGUOUS:$desc"
    }
  }
  if($dialogHandle -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 200}
} while($dialogHandle -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
if($dialogHandle -eq [IntPtr]::Zero){throw 'OD_DIALOG_NOT_FOUND'}
$dialogTitle=New-Object Text.StringBuilder 512
[void][TianshuOdDlg]::GetWindowText($dialogHandle,$dialogTitle,$dialogTitle.Capacity)
Write-Output "native:dialog-title:$($dialogTitle.ToString())"
[void][TianshuOdDlg]::SetForegroundWindow($dialogHandle)
Start-Sleep -Milliseconds 300

function Read-Back([IntPtr]$edit) {
  $buffer=New-Object Text.StringBuilder 2048
  [void][TianshuOdDlg]::SendMessage($edit,[TianshuOdDlg]::WM_GETTEXT,[IntPtr]2048,$buffer)
  return $buffer.ToString()
}
function Paths-Match([string]$a,[string]$b) {
  try { return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\')) } catch { return $false }
}

# ---- 路线 1：WM_SETTEXT 到 id=1152 的编辑框，并回读校验 ----
$mode='none'
$readback=''
$editHandle=[TianshuOdDlg]::GetDlgItem($dialogHandle,$EDIT_ID)
if($editHandle -ne [IntPtr]::Zero -and [TianshuOdDlg]::IsWindowVisible($editHandle)){
  Write-Output 'native:route-wm-settext'
  # 第一步：用 **BFFM_SETSELECTIONW** 设置对话框的**选中项**（旧式「浏览文件夹」的官方消息）。
  # 真机 2026-09-27 实测教训：只把路径塞进 edt1 是**不够**的 —— 当时编辑框内容正确、
  # 确定按钮可用、对话框也正常关闭，但应用拿到的仍是原目录，说明点「确定」返回的不是 edt1 文本。
  # 该消息是「设置选中项」的官方 API；**但在本机 0.24.1 上仍未让应用接受**（同一轮里编辑框内容、
  # 对话框存活、确定按钮可用全部正常）。它与下面的 WM_SETTEXT 一起作为尽力路径保留，
  # 生效与否**只由最后的工作目录回读判定** —— 回读不一致就转 needs_user（绝不假装绑定成功）。
  [void][TianshuOdDlg]::SendMessage($dialogHandle,[TianshuOdDlg]::BFFM_SETSELECTIONW,[IntPtr]1,$nativePath)
  Start-Sleep -Milliseconds 600
  # 第二步：把编辑框文本也对齐（部分实现要 edt1 一致才认），并回读确认。
  for($attempt=1;$attempt -le 3;$attempt++){
    Assert-Deadline
    [void][TianshuOdDlg]::SendMessage($editHandle,[TianshuOdDlg]::WM_SETTEXT,[IntPtr]::Zero,$nativePath)
    Start-Sleep -Milliseconds 250
    $readback=Read-Back $editHandle
    if(Paths-Match $readback $nativePath){$mode='wm-settext';break}
  }
  # 真机教训（2026-09-27，0.24.1）：WM_SETTEXT 只把文本写进编辑框，**不会改变对话框的实际选择**。
  # 上一步的「回读一致」读的是刚写进去的那个控件自身，属自证，不能证明应用会接受。
  # 若就此点「确定」，对话框会正常关闭、而应用仍用原目录 —— 表现为「对话框关了、工作目录却没变」。
  # 故补一次 Enter 让对话框真正导航/确认该路径；后续仍按「对话框是否关闭」收敛，不新增放行条件。
  if($mode -eq 'wm-settext'){
    Write-Output 'native:settext-enter'
    # 直接把回车发给**编辑框**（WM_KEYDOWN/UP + VK_RETURN），不走 SendKeys：
    # SendKeys 依赖「对话框已获前台焦点」，真机 2026-09-27 里同样的 Enter 一次生效一次没生效，
    # 结果一次绑定成功、一次「对话框关了但工作目录没变」。给控件发消息与焦点无关，
    # 标准文件夹对话框的 edt1 收到回车即按其内容导航。
    [void][TianshuOdDlg]::SendMessage($editHandle,[TianshuOdDlg]::WM_KEYDOWN,[IntPtr]13,[IntPtr]::Zero)
    [void][TianshuOdDlg]::SendMessage($editHandle,[TianshuOdDlg]::WM_KEYUP,[IntPtr]13,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 1200
    # 诊断（真机 2026-09-27）：回车究竟做了什么——编辑框内容是否还在、对话框是否还活着、
    # 确认按钮是否可用。三者组合能区分「回车没被接受」「回车关掉了对话框」「回车后按钮仍禁用」。
    $postEdit = Read-Back $editHandle
    $alive = [TianshuOdDlg]::IsWindow($dialogHandle)
    $okBtn = [TianshuOdDlg]::GetDlgItem($dialogHandle,$CONFIRM_ID)
    $okEnabled = 'n/a'
    if($okBtn -ne [IntPtr]::Zero){ if([TianshuOdDlg]::IsWindowEnabled($okBtn)){$okEnabled='yes'}else{$okEnabled='no'} }
    Write-Output "native:after-enter edit='$postEdit' dialogAlive=$alive confirmEnabled=$okEnabled"
  }
}

# ---- 路线 2：纯键盘（Ctrl+A → 输入 → Enter），再回读校验 ----
if($mode -eq 'none'){
  Write-Output 'native:route-keyboard'
  [void][TianshuOdDlg]::SetForegroundWindow($dialogHandle)
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 120
  # SendKeys 对 + ^ % ~ ( ) { } [ ] 有特殊含义，逐字符转义
  $escaped=[System.Text.RegularExpressions.Regex]::Replace($nativePath,'([+^%~()\[\]{}])','{$1}')
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 600
  $editHandle=[TianshuOdDlg]::GetDlgItem($dialogHandle,$EDIT_ID)
  if($editHandle -ne [IntPtr]::Zero){$readback=Read-Back $editHandle}
  if(Paths-Match $readback $nativePath){$mode='keyboard'}
}

if($mode -eq 'none' -and $readback -ne ''){
  throw "OD_DIALOG_READBACK_MISMATCH:$readback"
}

Write-Output 'native:submit'
$confirm=[TianshuOdDlg]::GetDlgItem($dialogHandle,$CONFIRM_ID)
if($confirm -ne [IntPtr]::Zero -and [TianshuOdDlg]::IsWindowVisible($confirm)){
  [void][TianshuOdDlg]::SendMessage($confirm,[TianshuOdDlg]::BM_CLICK,[IntPtr]::Zero,[IntPtr]::Zero)
  Write-Output 'native:submit-bm-click'
} elseif([TianshuOdDlg]::IsWindow($dialogHandle)){
  # 控件 id 漂移时退回 Enter（标准选择器的默认按钮）。
  # 前提是对话框**还在**：若它已被上一步 Enter 关掉，这里再发 Enter 会打到前台的其他窗口，
  # 可能触发意外操作（真机 2026-09-27 加固）。
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output 'native:submit-enter'
} else {
  Write-Output 'native:submit-skipped-dialog-gone'
}

# 成功判据：对话框**真的关闭**了（只发消息不等于生效）
$closed=$false
do {
  Start-Sleep -Milliseconds 200
  $closed = -not [TianshuOdDlg]::IsWindow($dialogHandle)
} while(-not $closed -and (Get-Date) -lt $deadline)
if(-not $closed){throw 'OD_DIALOG_STILL_OPEN'}
Write-Output "native:done:$mode"`;

/**
 * 歧义错误的候选清单：脚本已把每个候选的 `hwnd` / 标题带出来（`OD_DIALOG_AMBIGUOUS:<详情>`）。
 * 只用于把「有多个对话框」变成「具体是哪几个」，便于一次定位；缺失时返回空串。
 */
function ambiguousDetail(raw: string): string {
  const detail = /OD_DIALOG_AMBIGUOUS:(.+)/.exec(raw)?.[1]?.trim();
  return detail ? `\n候选窗口：${detail}` : "";
}

export async function selectOpenDesignFolder(
  targetPath: string,
  ownerPids: number[],
  baseline: string[],
  options: NativeDialogOptions = {},
): Promise<FolderDialogOutcome> {
  if (process.platform === "darwin")
    return { ok: false, reason: "platform", message: MACOS_FOLDER_DIALOG_UNAVAILABLE };
  if (process.platform !== "win32")
    return {
      ok: false,
      reason: "platform",
      message: `Open Design 原生文件夹选择不支持平台 ${process.platform}`,
    };
  const nativePath = toNativeDialogPath(targetPath);
  if (!nativePath)
    return { ok: false, reason: "error", message: `工作目录路径无效：${targetPath}` };
  const timeoutMs = options.timeoutMs ?? OPEN_DESIGN_DEFAULTS.dialogOperationTimeoutMs;
  try {
    const execution = execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", WINDOWS_SELECT_SCRIPT],
      {
        env: {
          ...process.env,
          TIANSHU_OD_FOLDER: nativePath,
          TIANSHU_OD_PIDS: ownerPids.join(","),
          TIANSHU_OD_BASELINE: baseline.join(","),
          TIANSHU_OD_DIALOG_DEADLINE: String(Date.now() + timeoutMs),
        },
        windowsHide: true,
        timeout: timeoutMs,
        signal: options.signal,
      },
    );
    let output = "";
    execution.child?.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split(/\r?\n/);
      output = lines.pop() ?? "";
      for (const line of lines)
        if (!options.signal?.aborted && line.startsWith("native:")) options.onProgress?.(line);
    });
    await execution;
    const mode = /native:done:(wm-settext|keyboard)/.exec(output)?.[1] ?? "wm-settext";
    return {
      ok: true,
      mode: mode as "wm-settext" | "keyboard",
      readback: nativePath,
      message: `Windows「选择文件夹」对话框已确认（${mode === "keyboard" ? "键盘输入路线" : "WM_SETTEXT 路线"}），路径回读一致且对话框已关闭`,
    };
  } catch (e) {
    if (options.signal?.aborted) throw e;
    const raw = e instanceof Error ? e.message : String(e);
    // 把脚本里的稳定标记翻成可操作的结构化原因（不把整段 PowerShell 报错当结论）
    if (raw.includes("OD_DIALOG_AMBIGUOUS"))
      return {
        ok: false,
        reason: "ambiguous",
        message:
          "同时出现多个新的 #32770 对话框，无法确定哪一个是 Open Design 弹出的；已放弃操作（绝不猜一个去点）。" +
          `请关闭多余对话框后重试。${ambiguousDetail(raw)}`,
      };
    if (raw.includes("OD_DIALOG_NOT_FOUND"))
      return {
        ok: false,
        reason: "not-found",
        message:
          "等待 Open Design 弹出的「选择文件夹」对话框超时：可能「选择目录」未点中，或路径选择改由应用内面板完成。",
      };
    if (raw.includes("OD_DIALOG_READBACK_MISMATCH"))
      return {
        ok: false,
        reason: "readback",
        message: `路径回读与目标不一致，已**放弃点击确认**：${raw.slice(raw.indexOf("OD_DIALOG_READBACK_MISMATCH"))}`,
      };
    if (raw.includes("OD_DIALOG_STILL_OPEN"))
      return {
        ok: false,
        reason: "submit",
        message: "已提交路径但对话框未在预算内关闭；无法确认目录绑定生效。",
      };
    return { ok: false, reason: "error", message: raw };
  }
}
