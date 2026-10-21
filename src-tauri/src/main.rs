#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::{Manager, WebviewWindow};
use std::time::Duration;

#[tauri::command]
fn zoom_in(window: WebviewWindow) {
    let _ = window.eval("document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') + 0.1).toString()");
}

#[tauri::command]
fn zoom_out(window: WebviewWindow) {
    let _ = window.eval("document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') - 0.1).toString()");
}

#[tauri::command]
fn zoom_reset(window: WebviewWindow) {
    let _ = window.eval("document.body.style.zoom = '1'");
}

#[tauri::command]
fn close_splashscreen(window: WebviewWindow) {
  if let Some(splashscreen) = window.get_webview_window("splash") {
    splashscreen.close().unwrap();
  }
  if let Some(main_window) = window.get_webview_window("main") {
    main_window.show().unwrap();
    main_window.set_fullscreen(true).unwrap();
  }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![zoom_in, zoom_out, zoom_reset, close_splashscreen])
        .setup(|app| {
            let splash_window = app.get_webview_window("splash").unwrap();
            let main_window = app.get_webview_window("main").unwrap();
            
            let main_handle = main_window.clone();
            let splash_handle = splash_window.clone();
            
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(10)).await;
                let _ = splash_handle.close();
                let _ = main_handle.show();
                let _ = main_handle.set_fullscreen(true);
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
