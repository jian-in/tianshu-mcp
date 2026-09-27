; ============================================================================
; Tianshu-mcp 日志台 —— NSIS 安装器钩子（tauri.conf.json → bundle.windows.nsis.installerHooks）
;
; 唯一职责：在安装新版本之前，把「旧 productName」遗留的安装彻底清掉。
;
; ## 背景（issue #25 真机验收发现的缺陷）
; Tauri 的 NSIS 模板直接用 productName 拼出「应用和功能」卸载项的注册表键：
;   !define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
; 本应用 GUI 0.1.0-beta.1 的 bundle.productName 是含空格的 "Tianshu-mcp Logs"；随后
; 为消除「GitHub 会把发行资产名里的空格归一化成点、Gitee 原样保留」导致的两端下载
; 地址不一致（提交 7d56b21），productName 改成了无空格的 "Tianshu-mcp-Logs"。
; productName 一变，卸载项键名随之改变 —— 新版本安装器便不再把旧安装当成「同一个
; 应用」：既不覆盖也不卸载，于是「应用和功能」里留下两条记录（旧 "Tianshu-mcp Logs"
; 0.1.0-beta.1 + 新 "Tianshu-mcp-Logs"），旧目录与旧快捷方式也一并留在磁盘上。
; （Tauri 只处理 mainBinaryName 变更，不处理 productName 变更。）
;
; ## 做法
; 安装新文件之前，若检测到旧名称的卸载项：静默运行它自己的卸载器（/S），再兜底删除
; 残留的注册表键与快捷方式，保证最终只存在「一条记录 + 一份安装」。
; 旧卸载项不存在时不执行任何动作 —— 全新安装与「当前名称」的版本更新完全不受影响。
;
; ## 边界（有意为之，勿随意扩大）
; 1) 静默运行旧卸载器不会删除用户数据：NSIS 卸载器的「Delete app data」复选框只在交互
;    模式下才置位（un.ConfirmLeave），/S 静默模式下 $DeleteAppDataCheckboxState 保持
;    空值，故 $APPDATA / $LOCALAPPDATA 下的数据目录不受影响（两端 BUNDLEID 相同，
;    数据是共用的，必须保留）。
; 2) 旧卸载器可能因「旧进程占用且强制关闭失败」而中途 Abort，此时它不会清理自己的
;    注册表键；本钩子在它之后无条件删除该键，因此「应用和功能」的残留记录一定会消失。
;    极端情况下旧目录里的文件会留存，但我们**不会**对旧 $INSTDIR 做 RmDir /r ——
;    旧安装位置是用户在旧安装器里自选的（本机实例即 D:\Tianshu-mcp Logs），
;    递归删除用户自选路径有误删风险，不值得为一份历史残留去冒险。
; 3) 只清理这一个已知的历史遗留名称（迁移别名常量），不做「扫描全部卸载项」式的通用
;    清理：productName 自 0.1.0-beta.2 起冻结，不会再产生新的遗留名称。
;    若将来确需再次更名，请在此追加一个新的 LEGACY_* 常量。
;
; ## 插入点与寄存器
; 本文件被模板 `!include` 在脚本靠前处（早于 MANUFACTURER / PRODUCTNAME 的 !define），
; 因此顶层 !define 只能写字面量；依赖模板变量的写法必须放进宏体内（宏体在插入处才展开）。
; 宏插入在 Section Install 的最前面，此处 $R8 / $R9 未被模板占用（紧随其后的
; CheckIfAppIsRunning 会自行覆盖多个寄存器），故直接使用。
; ============================================================================

; 历史遗留的 productName（含空格），也是旧卸载项注册表键名与旧快捷方式名
!define LEGACY_PRODUCT_NAME "Tianshu-mcp Logs"

; 系统固定的卸载项注册表根路径（Windows 自身约定，非本项目的可变配置）
!define UNINSTALL_KEY_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"

!macro NSIS_HOOK_PREINSTALL
  ; 旧安装与本安装的 installMode 相同（currentUser），而模板写卸载项也用 SHCTX，
  ; 故这里用 SHCTX 就能命中旧条目（与「本安装器会写到哪张 hive」完全一致）。
  ReadRegStr $R9 SHCTX "${UNINSTALL_KEY_ROOT}\${LEGACY_PRODUCT_NAME}" "UninstallString"
  StrCmp $R9 "" tianshu_legacy_cleanup_done

  DetailPrint "Legacy installation detected (${LEGACY_PRODUCT_NAME}); removing it..."
  ; 旧卸载器写入的 UninstallString 自带引号（Tauri 写的是 $\"$INSTDIR\uninstall.exe$\"），
  ; 因此这里直接把 $R9 放进命令行即可，路径含空格也正确。
  ; 不加 _?= —— 让卸载器自行复制到临时目录执行，避免含空格路径在参数解析上的坑。
  ExecWait '$R9 /S' $R8

  ; 兜底清理：旧卸载器若成功，以下均为空操作；若它中途 Abort，则由这里补齐。
  Delete "$SMPROGRAMS\${LEGACY_PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${LEGACY_PRODUCT_NAME}.lnk"
  DeleteRegKey SHCTX "${UNINSTALL_KEY_ROOT}\${LEGACY_PRODUCT_NAME}"
  DeleteRegKey SHCTX "${MANUKEY}\${LEGACY_PRODUCT_NAME}"
  DetailPrint "Legacy installation cleanup finished."

  tianshu_legacy_cleanup_done:
!macroend