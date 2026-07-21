mod auth;
mod bridge;
mod error;
mod model;
mod provider;

use crate::error::AppError;
use crate::model::AgentsQuotaResponse;
use crate::provider::fetch_all_agents;
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_positioner::{Position, WindowExt};
use tokio::sync::RwLock;

const POLL_INTERVAL: Duration = Duration::from_secs(300);
const TRAY_ID: &str = "main_tray";

#[derive(Clone)]
struct AppState {
    cache: Arc<RwLock<Option<AgentsQuotaResponse>>>,
}

#[tauri::command]
async fn get_agents_quota(
    state: tauri::State<'_, AppState>,
) -> Result<AgentsQuotaResponse, AppError> {
    if let Some(cached) = state.cache.read().await.clone() {
        return Ok(cached);
    }
    refresh_and_store(state.inner()).await
}

#[tauri::command]
async fn refresh_quota(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<AgentsQuotaResponse, AppError> {
    let response = refresh_and_store(state.inner()).await?;
    update_tray(&app, &response);
    Ok(response)
}

async fn refresh_and_store(state: &AppState) -> Result<AgentsQuotaResponse, AppError> {
    let agents = fetch_all_agents().await;
    let response = AgentsQuotaResponse {
        agents,
        refreshed_at: chrono::Utc::now(),
    };
    *state.cache.write().await = Some(response.clone());
    Ok(response)
}

fn update_tray(app: &AppHandle, response: &AgentsQuotaResponse) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        // Icon-only menu bar; quota details stay in the tooltip.
        let _ = tray.set_title(None::<&str>);
        let _ = tray.set_tooltip(Some(&format_tooltip(response)));
    }
}

fn format_tooltip(response: &AgentsQuotaResponse) -> String {
    response
        .agents
        .iter()
        .map(|a| match a.status {
            crate::model::AgentStatus::Ok => {
                format!("{} · {}", a.provider_name, remaining_text(a))
            }
            crate::model::AgentStatus::ComingSoon => {
                format!("{} · coming soon", a.provider_name)
            }
            _ => format!(
                "{} · {}",
                a.provider_name,
                a.error.as_deref().unwrap_or("error")
            ),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn remaining_text(snapshot: &crate::model::QuotaSnapshot) -> String {
    match (snapshot.remaining, &snapshot.unit) {
        (Some(value), crate::model::QuotaUnit::Cents) => {
            format!("${:.2} left", value / 100.0)
        }
        (Some(value), crate::model::QuotaUnit::Requests) => {
            format!("{:.0} left", value)
        }
        (None, _) => "unknown".to_string(),
    }
}

fn toggle_popover(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            Ok(false) | Err(_) => {
                show_popover(app, &window);
            }
        }
    }
}

fn show_popover(app: &AppHandle, window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    let _ = window.unminimize();
    let _ = window.as_ref().window().move_window(Position::TrayCenter);
    let _ = window.show();
    let _ = window.set_focus();
}

fn build_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&refresh, &settings, &quit])?;

    let icon = match app.default_window_icon().cloned() {
        Some(icon) => icon,
        None => Image::from_bytes(include_bytes!("../icons/32x32.png"))
            .map_err(|e| format!("failed to load tray icon: {e}"))?
            .to_owned(),
    };

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("agent-bar")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            "refresh" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    if let Ok(response) = refresh_and_store(state.inner()).await {
                        update_tray(&app_handle, &response);
                        let _ = app_handle.emit("quota-updated", &response);
                    }
                });
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    show_popover(app, &window);
                    let _ = app.emit("open-settings", ());
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(tray)
}

fn spawn_poll_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial fetch shortly after launch.
        tokio::time::sleep(Duration::from_secs(1)).await;
        loop {
            {
                let state = app.state::<AppState>();
                if let Ok(response) = refresh_and_store(state.inner()).await {
                    update_tray(&app, &response);
                    let _ = app.emit("quota-updated", &response);
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        cache: Arc::new(RwLock::new(None)),
    };

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_agents_quota,
            refresh_quota,
            bridge::bridge_status,
            bridge::bridge_details,
            bridge::bridge_diff,
            bridge::bridge_sync,
        ])
        .setup(|app| {
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                ))?;
            }

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            let _tray = build_tray(app.handle())?;

            if let Some(window) = app.get_webview_window("main") {
                let window_for_event = window.clone();
                window.on_window_event(move |event| {
                    match event {
                        WindowEvent::Focused(false) => {
                            let _ = window_for_event.hide();
                        }
                        WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = window_for_event.hide();
                        }
                        _ => {}
                    }
                });
            }

            spawn_poll_loop(app.handle().clone());
            Ok(())
        });

    match builder.run(tauri::generate_context!()) {
        Ok(()) => {}
        Err(err) => {
            eprintln!("failed to start agent-bar: {err}");
            std::process::exit(1);
        }
    }
}
