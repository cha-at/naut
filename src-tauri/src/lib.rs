mod memory;

use tauri::{plugin::TauriPlugin, Manager, Runtime, Url};

/// 顶层导航白名单：只允许应用自身协议和当前开发服务器，其余交给系统浏览器。
fn is_allowed_navigation(url: &Url, dev_url: Option<&Url>) -> bool {
  if url.scheme() == "tauri" {
    return true;
  }
  if url.scheme() == "about" {
    return url.as_str() == "about:blank";
  }
  if !matches!(url.scheme(), "http" | "https") {
    return false;
  }
  if url.host_str() == Some("tauri.localhost") {
    return true;
  }
  let Some(dev_url) = dev_url else {
    return false;
  };
  url.scheme() == dev_url.scheme()
    && url.host_str() == dev_url.host_str()
    && url.port_or_known_default() == dev_url.port_or_known_default()
}

/// 阻止 WebView 被外部链接带离应用；opener 插件负责在系统浏览器中打开链接。
fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::new("navigation-guard")
    .on_navigation(|webview, url| {
      let dev_url = if cfg!(dev) {
        webview.app_handle().config().build.dev_url.clone()
      } else {
        None
      };
      is_allowed_navigation(url, dev_url.as_ref())
    })
    .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(navigation_guard())
    .manage(memory::MemoryState::new())
    .invoke_handler(tauri::generate_handler![
      memory::memory_paths,
      memory::memory_list,
      memory::memory_create,
      memory::memory_rename,
      memory::memory_delete,
      memory::memory_read,
      memory::memory_read_full,
      memory::memory_write,
      memory::memory_edit,
      memory::memory_undo,
      memory::memory_backup_state
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::is_allowed_navigation;
  use tauri::Url;

  fn url(value: &str) -> Url {
    Url::parse(value).expect("valid test URL")
  }

  #[test]
  fn allows_app_urls() {
    assert!(is_allowed_navigation(&url("tauri://localhost/index.html"), None));
    assert!(is_allowed_navigation(&url("https://tauri.localhost/index.html"), None));
    assert!(is_allowed_navigation(&url("http://tauri.localhost/index.html"), None));
    assert!(is_allowed_navigation(&url("about:blank"), None));
  }

  #[test]
  fn denies_external_urls() {
    assert!(!is_allowed_navigation(&url("https://api.deepseek.com/models"), None));
    assert!(!is_allowed_navigation(&url("mailto:hello@example.com"), None));
    assert!(!is_allowed_navigation(&url("file:///C:/secret.txt"), None));
  }

  #[test]
  fn allows_only_the_development_origin() {
    let dev = url("http://192.168.1.8:8090");
    assert!(is_allowed_navigation(&url("http://192.168.1.8:8090/index.html"), Some(&dev)));
    assert!(!is_allowed_navigation(&url("http://192.168.1.8:9000/index.html"), Some(&dev)));
    assert!(!is_allowed_navigation(&url("https://example.com/"), Some(&dev)));
  }
}
