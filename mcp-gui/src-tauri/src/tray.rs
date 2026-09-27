//! 系统托盘：图标创建 + 按当前界面语言构建菜单 + 窗口唤出。
//!
//! 语言真源在偏好里（`Preferences::language`），本模块只做「值 → 文案」的映射，
//! 不持有状态；语言变化由 `set_preferences` 调用 `update_menu` 触发重建。
//!
//! **边界**：托盘只做窗口显示与进程退出，不读写任何业务数据。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// 托盘唯一标识（用于语言切换时定位并 `set_menu`）
pub const TRAY_ID: &str = "tianshu-logs-tray";

/// 菜单项 id（与文案解耦，语言切换不影响事件分发）
const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";

/// 语言 → (显示日志台, 退出日志台) 文案；仅中英两档，其余回退中文。
fn labels(language: &str) -> (&'static str, &'static str) {
    match language {
        "en-US" => ("Show Logs", "Exit Logs"),
        _ => ("显示日志台", "退出日志台"),
    }
}

/// 托盘悬浮提示（同样随界面语言）
fn tooltip(language: &str) -> &'static str {
    match language {
        "en-US" => "Tianshu-mcp Logs",
        _ => "Tianshu-mcp 日志台",
    }
}

fn build_menu(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let (show, quit) = labels(language);
    let show_item = MenuItem::with_id(app, MENU_SHOW, show, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&show_item, &separator, &quit_item])
}

/// 唤出主窗口：显示 + 取消最小化 + 聚焦（窗口已可见时只聚焦）
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 启动时创建托盘（仅一次）
pub fn init(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let menu = build_menu(app, language)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // 只在右键弹出菜单；左键单击用于唤出窗口
        .show_menu_on_left_click(false)
        .tooltip(tooltip(language))
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    // 复用应用内置图标（图标产物不入库，由 CI 从 assets/*.svg 派生）
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 语言变化时重建菜单（必须在主线程调用）
pub fn update_menu(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let menu = build_menu(app, language)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}
