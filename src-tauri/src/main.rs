#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Deserialize, Debug)]
struct SyncStatusResponse {
    status: String,
    message: String,
}

fn get_app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve AppData dir: {}", e))?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create AppData dir: {}", e))?;
    }
    Ok(dir)
}

fn atomic_write(target_path: &Path, content: &str) -> Result<(), String> {
    let temp_path = target_path.with_extension("tmp");
    {
        let mut temp_file = File::create(&temp_path)
            .map_err(|e| format!("Failed to create temporary file: {}", e))?;
        temp_file
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed writing content: {}", e))?;
        temp_file
            .sync_all()
            .map_err(|e| format!("Failed syncing buffer: {}", e))?;
    }
    fs::rename(&temp_path, target_path).map_err(|e| format!("Failed atomic file swap: {}", e))
}

#[tauri::command]
async fn get_device_id(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = get_app_dir(&app)?;
    let device_file = app_dir.join("device_id.txt");

    if device_file.exists() {
        fs::read_to_string(&device_file)
            .map_err(|e| format!("Failed to read device ID: {}", e))
            .map(|s| s.trim().to_string())
    } else {
        let new_id = format!("device_{}", uuid::Uuid::new_v4().simple());
        atomic_write(&device_file, &new_id)?;
        Ok(new_id)
    }
}

#[tauri::command]
async fn save_data(app: tauri::AppHandle, data: serde_json::Value) -> Result<SyncStatusResponse, String> {
    let app_dir = get_app_dir(&app)?;
    let main_file = app_dir.join("appData.json");
    let backup_file = app_dir.join("appData.json.bak");

    let serialized = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("JSON Serialization Error: {}", e))?;

    if main_file.exists() {
        let _ = fs::copy(&main_file, &backup_file);
    }

    atomic_write(&main_file, &serialized)?;

    Ok(SyncStatusResponse {
        status: "success".into(),
        message: "Data saved safely via atomic write.".into(),
    })
}

#[tauri::command]
async fn load_data(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let app_dir = get_app_dir(&app)?;
    let main_file = app_dir.join("appData.json");
    let backup_file = app_dir.join("appData.json.bak");

    if main_file.exists() {
        if let Ok(content) = fs::read_to_string(&main_file) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                return Ok(parsed);
            }
        }
    }

    if backup_file.exists() {
        if let Ok(content) = fs::read_to_string(&backup_file) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                let _ = fs::copy(&backup_file, &main_file);
                return Ok(parsed);
            }
        }
    }

    Ok(serde_json::json!({
        "todos": [], "passwords": [], "apis": [], "cards": [],
        "videos": [], "books": [], "notes": [], "events": [],
        "layout": {}, "theme": "dark"
    }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![get_device_id, save_data, load_data])
        .run(tauri::generate_context!())
        .expect("Error bootstrapping Tauri application");
}
