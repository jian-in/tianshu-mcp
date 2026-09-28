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
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public const uint WM_SETTEXT = 0x000C;
  public const uint WM_GETTEXT = 0x000D;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint WM_LBUTTONDOWN = 0x0201;
  public const uint WM_LBUTTONUP = 0x0202;
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
  # 刻意**不**发回车（真机 2026-09-28 枚举子控件后确认）：回车被解释为「导航」，
  # 导航成功的同时会把「文件夹:」编辑框(edt1) **清空**，而确定按钮返回的正是 edt1 的内容 ——
  # 这就是「对话框正常关闭、工作目录却没变」以及此前时好时坏的直接原因。
  # 路径的保证由「WM_SETTEXT + 点确定前的校准」承担（见 native:refill-before-submit）。
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

  # 点「确定」前**最后一次校准 edt1**。
  # 真机取证（2026-09-28，枚举对话框子控件）：地址栏已正确显示「地址: D:\…\test」、而
  # 「文件夹:」编辑框(id=1152) 是**空的** —— 因为回车被解释为「导航」，导航成功的同时把 edt1 清空了；
  # 而旧式「浏览文件夹」的确定按钮返回的正是 edt1 的内容，于是「对话框正常关闭、目录却没变」。
  # 这正是此前时好时坏（一次成功、多次失败）的来源。
  $finalCheck = Read-Back $editHandle
  if(-not (Paths-Match $finalCheck $nativePath)){
    Write-Output 'native:refill-before-submit'
    [void][TianshuOdDlg]::SendMessage($editHandle,[TianshuOdDlg]::WM_SETTEXT,[IntPtr]::Zero,$nativePath)
    Start-Sleep -Milliseconds 400
    $finalCheck = Read-Back $editHandle
    Write-Output "native:refilled edit='$finalCheck'"
  }

Write-Output 'native:submit'
$confirm=[TianshuOdDlg]::GetDlgItem($dialogHandle,$CONFIRM_ID)
if($confirm -ne [IntPtr]::Zero -and [TianshuOdDlg]::IsWindowVisible($confirm)){
  # 用**真实鼠标按键消息**点「选择文件夹」，而不是 BM_CLICK。
  # 真机取证（2026-09-28）：BM_CLICK 能让对话框正常关闭、应用却始终不接受该目录
  # （工作目录回读仍是「工作目录」）；产品文档/操作截图里强调的也是「点击」这个按钮。
  # WM_LBUTTONDOWN/UP 直发按钮（定向、不依赖窗口在前台），按钮随后自行向父窗口发 BN_CLICKED。
  # 坐标为按钮客户区中心（lParam = y<<16 | x）。
  $rc=New-Object TianshuOdDlg+RECT
  [void][TianshuOdDlg]::GetClientRect($confirm,[ref]$rc)
  $lx=[int](($rc.Right - $rc.Left)/2); $ly=[int](($rc.Bottom - $rc.Top)/2)
  $lp=[IntPtr](($ly -shl 16) -bor ($lx -band 0xFFFF))
  [void][TianshuOdDlg]::SendMessage($confirm,[TianshuOdDlg]::WM_LBUTTONDOWN,[IntPtr]1,$lp)
  Start-Sleep -Milliseconds 90
  [void][TianshuOdDlg]::SendMessage($confirm,[TianshuOdDlg]::WM_LBUTTONUP,[IntPtr]0,$lp)
  Write-Output 'native:submit-real-click'
} elseif([TianshuOdDlg]::IsWindow($dialogHandle)){
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

/* ------------------------------------------------------------------ *
 * 「另存为」对话框（导出产物用）
 *
 * 与上面的「选择文件夹」**不同一族**：那个是 SHBrowseForFolder（`文件夹:` edt1=1152），
 * 这个是 GetSaveFileName（`文件名(N):` edt1=1148 + `保存类型(T):`），真机取证（2026-09-28）：
 * - 标题是 `blob:od://app/<uuid>`（产品用 Blob 下载，不是固定标题）；
 * - **默认目录是「下载」** —— 直接把产物留在下载目录是最常见的「导出成功却没文件」；
 * - 标准技巧：**在「文件名」框里填完整路径**（`D:\dir\file.html`）→ Windows 会自动导航并把
 *   文件名填好，比在地址栏敲目录更稳（地址栏是 ToolbarWindow32，不是 Edit，无法 WM_SETTEXT）。
 *   地址栏路线作为回退保留。
 * ------------------------------------------------------------------ */

export const WINDOWS_SAVE_DIALOG_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$deadline=[DateTimeOffset]::FromUnixTimeMilliseconds([Int64]$env:TIANSHU_OD_DIALOG_DEADLINE).LocalDateTime
function Assert-Deadline { if((Get-Date) -ge $deadline){throw 'OD_SAVE_TIMEOUT'} }
Write-Output 'save:initialize'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TianshuOdSave {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public const uint WM_SETTEXT = 0x000C;
  public const uint WM_GETTEXT = 0x000D;
  public const uint WM_LBUTTONDOWN = 0x0201;
  public const uint WM_LBUTTONUP = 0x0202;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
}
'@
# GetSaveFileName 的标准控件 id：1148 = 「文件名(N):」编辑框，1 = 「保存」按钮
$NAME_ID = 1148
$SAVE_ID = 1
$owners=($env:TIANSHU_OD_PIDS -split ',')
$baseline=@($env:TIANSHU_OD_BASELINE -split ',' | Where-Object { $_ -ne '' })
$fullPath=$env:TIANSHU_OD_SAVE_PATH
$targetDir=$env:TIANSHU_OD_SAVE_DIR

function Get-Title([IntPtr]$h) {
  $sb=New-Object Text.StringBuilder 512
  [void][TianshuOdSave]::GetWindowText($h,$sb,$sb.Capacity); return $sb.ToString()
}
# 只认「新出现」且属于本产品进程组的 #32770
function Get-NewDialogs {
  $script:found=@()
  [TianshuOdSave]::EnumWindows({param($h,$l)
    if([TianshuOdSave]::IsWindowVisible($h)){
      [uint32]$owner=0
      [void][TianshuOdSave]::GetWindowThreadProcessId($h,[ref]$owner)
      if($owners -contains [string]$owner){
        $cls=New-Object Text.StringBuilder 256
        [void][TianshuOdSave]::GetClassName($h,$cls,$cls.Capacity)
        if($cls.ToString() -eq '#32770'){
          $t=Get-Title $h
          if($baseline -notcontains "dialog:$($h.ToInt64()):$t"){$script:found += $h}
        }
      }
    }
    return $true
  },[IntPtr]::Zero)|Out-Null
  return $script:found
}

Write-Output 'save:find-dialog'
$dlg=[IntPtr]::Zero
do {
  $handles=@(Get-NewDialogs)
  if($handles.Count -ge 1){
    # 保存对话框必有「文件名」框（id=1148）；标题是 blob: 不能当判据，故用控件消歧。
    # 注意：PowerShell 里用 + 拼接（双引号内嵌套 $(...) 会把变量当字面量，真机 2026-09-28 踩过）。
    $withName=@($handles | Where-Object { $p=[TianshuOdSave]::GetDlgItem($_,$NAME_ID); $p -ne [IntPtr]::Zero })
    if($withName.Count -eq 1){$dlg=$withName[0]}
    elseif($handles.Count -eq 1){$dlg=$handles[0]}
    else{
      # 用 stdout 传结构化标记 + exit 0（不用 throw：异常文本经管道传递会被破坏）。
      # 拼接一律走 -f 格式化，不用加号：真机 2026-09-28 实测括号内字符串加变量在该脚本上下文里
      # 会被解析成字面量，调用方读到的候选列表变成垃圾文本。
      # 另外：本段位于 TS 模板字符串内，注释里不能出现反引号（会终止字符串并炸掉编译）。
      $desc=''
      foreach($h in $handles){
        $hasName=[TianshuOdSave]::GetDlgItem($h,$NAME_ID) -ne [IntPtr]::Zero
        $desc = '{0}hwnd={1} hasNameBox={2} title={3} ;; ' -f $desc, $h.ToInt64(), $hasName, (Get-Title $h)
      }
      Write-Output ('OD_SAVE_AMBIGUOUS:{0}' -f $desc)
      exit 0
    }
  }
  if($dlg -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 200}
} while($dlg -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
if($dlg -eq [IntPtr]::Zero){throw 'OD_SAVE_NOT_FOUND'}
Write-Output ("save:dialog-title:" + (Get-Title $dlg))

function Read-Name([IntPtr]$e) {
  $b=New-Object Text.StringBuilder 2048
  [void][TianshuOdSave]::SendMessage($e,[TianshuOdSave]::WM_GETTEXT,[IntPtr]2048,$b)
  return $b.ToString()
}

$nameBox=[TianshuOdSave]::GetDlgItem($dlg,$NAME_ID)
if($nameBox -eq [IntPtr]::Zero){throw 'OD_SAVE_NO_NAMEBOX'}

# 路线 1：文件名框填**完整路径**
# GetSaveFileName 支持在「文件名」框里给完整路径（Windows 会据此定位目录并保存），
# 这是**不依赖前台**的路线 —— 后台 MCP 子进程无法用 SetForegroundWindow/SendKeys（会被系统拒绝）。
Write-Output 'save:fill-fullpath'
[void][TianshuOdSave]::SendMessage($nameBox,[TianshuOdSave]::WM_SETTEXT,[IntPtr]::Zero,$fullPath)
Start-Sleep -Milliseconds 700
Write-Output ('save:name-after-fill:' + (Read-Name $nameBox))

# 路线 2：用 **UI Automation** 把地址栏设到目标目录（同样不依赖前台）。
# 真机取证（2026-09-28）：只填文件名框时保存位置可能仍是「此电脑 > 下载」；
# 地址栏是 ToolbarWindow32 内的控件，WM_SETTEXT 无效，必须走 UIA 的 ValuePattern。
Write-Output 'save:uia-address'
try {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($dlg)
  $cond=New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)
  $edits=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
  $nameNative=$nameBox.ToInt64()
  foreach($e in $edits){
    $h=$e.Current.NativeWindowHandle
    if($h -eq $nameNative){continue}
    try {
      $vp=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $vp.SetValue($targetDir)
      Write-Output 'save:uia-address-set'
      break
    } catch { }
  }
} catch { Write-Output 'save:uia-address-skip' }

function Read-Address([IntPtr]$d) {
  # 地址栏：优先 UIA（能读到面包屑文本），回退到 ToolbarWindow32(1001) 的窗口文本
  try {
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes -ErrorAction SilentlyContinue
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($d)
    $cond=New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)
    $edits=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
    $name=$nameBox.ToInt64()
    foreach($e in $edits){
      if($e.Current.NativeWindowHandle -eq $name){continue}
      $v=$e.Current.Name
      if($v){ return $v }
    }
  } catch { }
  $addr=[TianshuOdSave]::GetDlgItem($d,1001)
  if($addr -ne [IntPtr]::Zero){
    $sb=New-Object Text.StringBuilder 1024
    [void][TianshuOdSave]::SendMessage($addr,[TianshuOdSave]::WM_GETTEXT,[IntPtr]1024,$sb)
    return $sb.ToString()
  }
  return ''
}
$addrShown=Read-Address $dlg
Write-Output ('save:address-readback:' + $addrShown)
# 导航后重新把完整路径写回文件名框（地址栏导航可能清掉它）
[void][TianshuOdSave]::SendMessage($nameBox,[TianshuOdSave]::WM_SETTEXT,[IntPtr]::Zero,$fullPath)
Start-Sleep -Milliseconds 400

Write-Output 'save:submit'
$save=[TianshuOdSave]::GetDlgItem($dlg,$SAVE_ID)
if($save -ne [IntPtr]::Zero -and [TianshuOdSave]::IsWindowVisible($save)){
  # 真实鼠标按键消息（真机教训：BM_CLICK 有时让对话框正常关闭、应用却没接受）
  $rc=New-Object TianshuOdSave+RECT
  [void][TianshuOdSave]::GetClientRect($save,[ref]$rc)
  $lx=[int](($rc.Right-$rc.Left)/2); $ly=[int](($rc.Bottom-$rc.Top)/2)
  $lp=[IntPtr](($ly -shl 16) -bor ($lx -band 0xFFFF))
  [void][TianshuOdSave]::SendMessage($save,[TianshuOdSave]::WM_LBUTTONDOWN,[IntPtr]1,$lp)
  Start-Sleep -Milliseconds 90
  [void][TianshuOdSave]::SendMessage($save,[TianshuOdSave]::WM_LBUTTONUP,[IntPtr]0,$lp)
  Write-Output 'save:submit-real-click'
} else {
  throw 'OD_SAVE_NO_BUTTON'
}

# 成功判据：对话框**真的关闭**（只发消息不等于生效）
$closed=$false
do {
  Start-Sleep -Milliseconds 200
  $closed = -not [TianshuOdSave]::IsWindow($dlg)
} while(-not $closed -and (Get-Date) -lt $deadline)
if(-not $closed){throw 'OD_SAVE_STILL_OPEN'}
Write-Output 'save:done'
`;

export interface SaveFileDialogInput {
  /** 目标目录（项目根） */
  targetDir: string;
  /** 文件名（含扩展名） */
  fileName: string;
  ownerPids: number[];
  budgetMs: number;
  /**
   * **点击导出之前**采样的对话框基线（`dialog:<hwnd>:<title>` 身份串）。
   * 必须由调用方在点导出前采集：若在这里现采，刚弹出的保存对话框会被当成"本来就存在"，
   * 「只看新出现的窗口」这条判据就永远命中不了它（真机 2026-09-28 就是这个表现）。
   */
  baseline: string[];
  signal?: AbortSignal;
}

/**
 * 处理导出后弹出的「另存为」对话框，把产物存到 `targetDir`。
 *
 * 仅 Windows 实现（与「选择文件夹」同样的取舍：非 Windows 不做未验证的自动化）。
 */
export async function saveFileViaNativeDialog(
  input: SaveFileDialogInput,
): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== "win32")
    return { ok: false, message: "导出后的「另存为」对话框目前只在 Windows 上实现" };
  if (!input.ownerPids.length)
    return { ok: false, message: "未取得 Open Design 进程 pid，无法安全定位保存对话框" };

  const fullPath = toNativeDialogPath(path.join(input.targetDir, input.fileName));
  const deadline = Date.now() + input.budgetMs;

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", WINDOWS_SAVE_DIALOG_SCRIPT], {
      env: {
        ...process.env,
        TIANSHU_OD_PIDS: input.ownerPids.join(","),
        TIANSHU_OD_BASELINE: input.baseline.join(","),
        TIANSHU_OD_SAVE_PATH: fullPath,
        TIANSHU_OD_SAVE_DIR: toNativeDialogPath(input.targetDir),
        TIANSHU_OD_DIALOG_DEADLINE: String(deadline),
      },
      windowsHide: true,
      timeout: Math.max(5_000, input.budgetMs + 5_000),
      signal: input.signal,
    });
    const out = String(stdout);
    if (out.includes("save:done")) return { ok: true };
    // 歧义走 stdout 标记（脚本里是 exit 0），在这里先接住——它比异常文本可靠
    if (out.includes("OD_SAVE_AMBIGUOUS")) {
      const detail = /OD_SAVE_AMBIGUOUS:([^\n]*)/.exec(out)?.[1]?.trim();
      return {
        ok: false,
        message: `同时出现多个 #32770 对话框，无法确定哪一个是「另存为」；已放弃操作（绝不猜一个去点）。${
          detail ? `\n候选窗口：${detail}` : ""
        }`,
      };
    }
    return { ok: false, message: `保存对话框流程未完成：${out.trim().split("\n").slice(-3).join(" | ")}` };
  } catch (error) {
    const raw = String((error as { stdout?: string; stderr?: string; message?: string }).stdout ?? "") +
      String((error as { stderr?: string }).stderr ?? "") +
      String((error as { message?: string }).message ?? "");
    if (raw.includes("OD_SAVE_AMBIGUOUS")) {
      const detail = /OD_SAVE_AMBIGUOUS:(.+)/.exec(raw)?.[1]?.trim();
      return {
        ok: false,
        message: `同时出现多个 #32770 对话框，无法确定哪一个是「另存为」；已放弃操作（绝不猜一个去点）。${
          detail ? `\n候选窗口：${detail}` : ""
        }`,
      };
    }
    if (raw.includes("OD_SAVE_NOT_FOUND"))
      return { ok: false, message: "等待「另存为」对话框超时：导出菜单可能未点中，或产品改用其它保存方式" };
    if (raw.includes("OD_SAVE_STILL_OPEN"))
      return { ok: false, message: "「另存为」对话框未关闭（保存未生效）" };
    return { ok: false, message: `保存对话框处理失败：${raw.trim().split("\n").slice(-3).join(" | ")}` };
  }
}
