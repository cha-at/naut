//! 原生记忆目录命令。
//!
//! 所有读写都限制在记忆根目录内：只接受单个文件名、拒绝符号链接、canonicalize 父目录；
//! 写入使用同目录临时文件 + rename 原子替换；模型编辑前先保存一份撤销备份。
//! 纯逻辑放在接收 root: &Path 的自由函数里，命令只负责解析根目录、加锁与映射结果，
//! 因此单元测试不需要 Tauri 运行时。

use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime, State};

/// 单文件上限：读取仍可用（只返回窗口），编辑与保存拒绝。
const MEMORY_FILE_MAX_BYTES: u64 = 64 * 1024;
/// 记忆目录直接子文件上限。
const MEMORY_DIR_MAX_FILES: usize = 200;
/// read 单次最多行数，也是 limit 的上限。
const READ_MAX_LINES: u32 = 2000;
/// read 单次最多字节数。
const READ_MAX_BYTES: usize = 32 * 1024;
/// read 单行最多 UTF-16 码元数；与 Web 适配器 text.ts 的口径一致。
const READ_MAX_LINE_CHARS: usize = 2000;
/// 文件名最多字符数。
const FILE_NAME_MAX: usize = 64;
/// 单行截断后缀；与 Web 适配器 src/services/memory/text.ts 保持完全一致。
const LINE_TRUNCATED_SUFFIX: &str = " … (line truncated)";

const USER_FILE: &str = "USER.md";
const MEMORY_FILE: &str = "MEMORY.md";
/// 两份记忆文件的初始模板；与 src/services/memory/templates.ts 文本完全一致。
const USER_TEMPLATE: &str = "# USER.md\n\n> 用户偏好与资料；对话开始时会自动注入。\n\n";
const MEMORY_TEMPLATE: &str = "# MEMORY.md\n\n> 长期记忆；对话开始时会自动注入。\n\n";
/// 备份目录与槽位文件名；一对文件对应一个文件的一份撤销备份。
const BACKUP_DIR: &str = ".backup";
const BACKUP_SUFFIX: &str = ".prev";
const BACKUP_META_SUFFIX: &str = ".json";

/// 前端 MemoryPaths.platform 只接受 windows / android；其它平台按桌面处理。
#[cfg(target_os = "android")]
const PLATFORM: &str = "android";
#[cfg(not(target_os = "android"))]
const PLATFORM: &str = "windows";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/// 稳定错误码：not_found / not_file / invalid_path / exists / too_large /
/// too_many_files / binary / permission / io / no_backup / backup_stale /
/// conflict / root_unavailable / read_only。
///
/// 另有两条补充码，不属于存储错误：
/// - invalid_argument：工具参数校验失败（空 old_string 等），必须先于文件读写返回，
///   否则会把参数问题误报成文件问题；
/// - no_match：字面匹配失败（0 次，或未加 replace_all 时多于 1 次）。它不在存储错误码
///   清单里，但 Web 适配器（src/services/memory/types.ts 的 MemoryErrorCode）已把它作为
///   「字面匹配」的补充码，两端保持一致才能让工具结果与界面文案对齐。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryError {
  code: &'static str,
  message: String,
}

impl MemoryError {
  fn new(code: &'static str, message: impl Into<String>) -> Self {
    Self {
      code,
      message: message.into(),
    }
  }

  fn invalid_path(message: impl Into<String>) -> Self {
    Self::new("invalid_path", message)
  }

  fn not_found(name: &str) -> Self {
    Self::new("not_found", format!("File not found: {name}"))
  }

  fn not_file(name: &str) -> Self {
    Self::new("not_file", format!("Not a regular file: {name}"))
  }

  fn exists(name: &str) -> Self {
    Self::new(
      "exists",
      format!("A file with this name already exists: {name}"),
    )
  }

  fn too_large(name: &str) -> Self {
    Self::new(
      "too_large",
      format!("File exceeds the 64 KiB limit: {name}"),
    )
  }

  fn too_many_files() -> Self {
    Self::new(
      "too_many_files",
      "The memory directory already holds 200 files",
    )
  }

  fn binary(name: &str) -> Self {
    Self::new("binary", format!("File is not UTF-8 text: {name}"))
  }

  fn read_only(message: impl Into<String>) -> Self {
    Self::new("read_only", message)
  }

  fn conflict(name: &str) -> Self {
    Self::new(
      "conflict",
      format!("The file changed since it was loaded: {name}"),
    )
  }

  fn no_backup(name: &str) -> Self {
    Self::new("no_backup", format!("No undo backup for this file: {name}"))
  }

  fn backup_stale(name: &str) -> Self {
    Self::new(
      "backup_stale",
      format!("The file changed after the last model edit; undo is unavailable: {name}"),
    )
  }

  fn root_unavailable(message: impl Into<String>) -> Self {
    Self::new("root_unavailable", message)
  }

  fn invalid_argument(message: impl Into<String>) -> Self {
    Self::new("invalid_argument", message)
  }

  /// 稳定错误码；序列化时作为 code 字段，测试也用它断言。
  fn code(&self) -> &'static str {
    self.code
  }

  fn message(&self) -> &str {
    &self.message
  }
}

/// 只输出 { code, message }；消息里只有文件名与错误码，绝不含文件正文。
impl Serialize for MemoryError {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    use serde::ser::SerializeStruct;
    let mut state = serializer.serialize_struct("MemoryError", 2)?;
    state.serialize_field("code", self.code())?;
    state.serialize_field("message", self.message())?;
    state.end()
  }
}

impl std::fmt::Display for MemoryError {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    formatter.write_str(self.message())
  }
}

impl std::error::Error for MemoryError {}

/// 把 IO 错误映射为稳定 code；消息只含操作与文件名。
fn io_error(error: &std::io::Error, action: &str, name: &str) -> MemoryError {
  match error.kind() {
    ErrorKind::PermissionDenied => MemoryError::new(
      "permission",
      format!("Could not {action} {name}: permission denied"),
    ),
    ErrorKind::NotFound => MemoryError::new(
      "not_found",
      format!("Could not {action} {name}: file not found"),
    ),
    ErrorKind::AlreadyExists => MemoryError::new(
      "exists",
      format!("Could not {action} {name}: file already exists"),
    ),
    _ => MemoryError::new("io", format!("Could not {action} {name}")),
  }
}

/// 根目录 / 备份目录创建失败：无权限用 permission，其余（路径不可用）用 root_unavailable。
fn root_io_error(error: &std::io::Error) -> MemoryError {
  if error.kind() == ErrorKind::PermissionDenied {
    MemoryError::new(
      "permission",
      "Could not create the memory directory: permission denied",
    )
  } else {
    MemoryError::root_unavailable("The memory directory is unavailable")
  }
}

// ---------------------------------------------------------------------------
// 返回结构（字段名按 snake_case 序列化给前端）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct MemoryEntry {
  pub name: String,
  pub size: u64,
  pub modified_at: u64,
  pub is_memory: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryPathEntry {
  pub name: String,
  pub path: String,
  pub is_memory: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryPaths {
  pub root: String,
  pub platform: String,
  pub files: Vec<MemoryPathEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryList {
  pub entries: Vec<MemoryEntry>,
  pub truncated: bool,
}

/// memory_create / memory_rename / memory_write / memory_undo 的返回。
#[derive(Debug, Clone, Serialize)]
pub struct MemoryFileResult {
  pub entry: MemoryEntry,
  pub hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryRead {
  pub name: String,
  pub size: u64,
  pub modified_at: u64,
  /// 前端适配器用 entryOf 读取该字段，故一并返回（合约字段的超集）。
  pub is_memory: bool,
  pub content: String,
  pub start_line: u32,
  pub end_line: u32,
  pub total_lines: u32,
  pub hash: Option<String>,
  pub truncated: bool,
  pub line_truncated: bool,
}

/// memory_read_full 的返回：编辑器用的全文读取，不带行号也不做窗口。
#[derive(Debug, Clone, Serialize)]
pub struct MemoryFullRead {
  pub name: String,
  pub content: String,
  pub size: u64,
  pub modified_at: u64,
  /// 文件超过 64 KiB 时为 None（与 memory_read 的约定一致）。
  pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryEditResult {
  pub entry: MemoryEntry,
  pub replacements: u32,
  /// 没有写盘（old_string == new_string）时为空字符串，前端不会匹配到任何撤销入口。
  pub backup_id: String,
  pub hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryBackupState {
  pub available: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub backup_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub edited_at: Option<u64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub edited_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryDeleted {
  pub deleted: bool,
}

/// 备份元数据；字段名与 plan 4.1 的备份布局一致（camelCase）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupMeta {
  name: String,
  edited_hash: String,
  edited_at: u64,
  backup_id: String,
  tool_use_id: String,
}

/// 进程内串行化：所有记忆命令共享一把互斥锁，保证读改写不交错。
#[derive(Default)]
pub struct MemoryState {
  lock: Mutex<()>,
}

impl MemoryState {
  pub fn new() -> Self {
    Self::default()
  }

  /// 锁中毒时取回内部数据继续用，避免一次 panic 变成永久失败。
  fn guard(&self) -> MutexGuard<'_, ()> {
    match self.lock.lock() {
      Ok(guard) => guard,
      Err(poisoned) => poisoned.into_inner(),
    }
  }
}

// ---------------------------------------------------------------------------
// 根目录解析
// ---------------------------------------------------------------------------

/// 桌面端：home_dir/.naut。Android：videoDir 的父目录（即 getExternalFilesDir(null)）。
#[cfg(not(target_os = "android"))]
fn app_memory_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, MemoryError> {
  let home = app
    .path()
    .home_dir()
    .map_err(|_| MemoryError::root_unavailable("The memory directory is unavailable"))?;
  Ok(home.join(".naut"))
}

/// Android：Tauri 把 videoDir 解析为 getExternalFilesDir(DIRECTORY_MOVIES)，父目录即
/// getExternalFilesDir(null)。解析不到时返回 root_unavailable，绝不静默退回应用内部目录
/// （内部目录对用户不可见，无法用文件管理器管理记忆）。
///
/// 说明：plan 7.2 提到的 JNI 兜底需要 jni / ndk-context crate，本任务限定只新增 sha2，
/// 因此未实现；U-2 真机验证若不通过，需要另行评审是否引入这两个 crate。
#[cfg(target_os = "android")]
fn app_memory_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, MemoryError> {
  let video = app
    .path()
    .video_dir()
    .map_err(|_| MemoryError::root_unavailable("The memory directory is unavailable"))?;
  let root = video
    .parent()
    .filter(|parent| !parent.as_os_str().is_empty())
    .ok_or_else(|| MemoryError::root_unavailable("The memory directory is unavailable"))?;
  Ok(root.to_path_buf())
}

/// 懒创建根目录与备份目录；失败映射为 permission / root_unavailable。
fn ensure_root(root: &Path) -> Result<(), MemoryError> {
  fs::create_dir_all(root).map_err(|error| root_io_error(&error))?;
  fs::create_dir_all(root.join(BACKUP_DIR)).map_err(|error| root_io_error(&error))
}

// ---------------------------------------------------------------------------
// Tauri 命令：解析根目录 → 加锁 → 调用自由函数
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn memory_paths<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
) -> Result<MemoryPaths, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  paths_info(&root)
}

#[tauri::command]
pub fn memory_list<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
) -> Result<MemoryList, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  list_entries(&root)
}

#[tauri::command]
pub fn memory_create<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
) -> Result<MemoryFileResult, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  create_file(&root, &name)
}

#[tauri::command]
pub fn memory_rename<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  old_name: String,
  new_name: String,
) -> Result<MemoryFileResult, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  rename_file(&root, &old_name, &new_name)
}

#[tauri::command]
pub fn memory_delete<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
) -> Result<MemoryDeleted, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  delete_file(&root, &name)?;
  Ok(MemoryDeleted { deleted: true })
}

#[tauri::command]
pub fn memory_read<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
  offset: Option<u32>,
  limit: Option<u32>,
) -> Result<MemoryRead, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  read_memory(&root, &name, offset, limit)
}

#[tauri::command]
pub fn memory_read_full<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
) -> Result<MemoryFullRead, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  read_full(&root, &name)
}

#[tauri::command]
pub fn memory_write<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
  content: String,
  expected_hash: Option<String>,
) -> Result<MemoryFileResult, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  write_file(&root, &name, &content, expected_hash.as_deref())
}

#[tauri::command]
pub fn memory_edit<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
  old_string: String,
  new_string: String,
  replace_all: bool,
  tool_use_id: String,
) -> Result<MemoryEditResult, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  edit_file(
    &root,
    &name,
    &old_string,
    &new_string,
    replace_all,
    &tool_use_id,
  )
}

#[tauri::command]
pub fn memory_undo<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
) -> Result<MemoryFileResult, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  undo_edit(&root, &name)
}

#[tauri::command]
pub fn memory_backup_state<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, MemoryState>,
  name: String,
) -> Result<MemoryBackupState, MemoryError> {
  let _guard = state.guard();
  let root = app_memory_root(&app)?;
  backup_state(&root, &name)
}

// ---------------------------------------------------------------------------
// 自由函数（单元测试入口）
// ---------------------------------------------------------------------------

/// 根目录与两份记忆文件路径，供 UI 展示 / 复制。
pub fn paths_info(root: &Path) -> Result<MemoryPaths, MemoryError> {
  ensure_root(root)?;
  let files = [USER_FILE, MEMORY_FILE]
    .iter()
    .map(|name| MemoryPathEntry {
      name: (*name).to_string(),
      path: root.join(name).to_string_lossy().to_string(),
      is_memory: true,
    })
    .collect();
  Ok(MemoryPaths {
    root: root.to_string_lossy().to_string(),
    platform: PLATFORM.to_string(),
    files,
  })
}

/// 直接子文件列表：跳过目录、隐藏文件与符号链接，记忆文件固定在前，最多 200 项。
pub fn list_entries(root: &Path) -> Result<MemoryList, MemoryError> {
  ensure_root(root)?;
  let read_dir =
    fs::read_dir(root).map_err(|error| io_error(&error, "list", "the memory directory"))?;
  let mut entries: Vec<MemoryEntry> = Vec::new();
  for entry in read_dir {
    let entry = match entry {
      Ok(entry) => entry,
      Err(_) => continue,
    };
    let name = entry.file_name().to_string_lossy().to_string();
    // 隐藏文件（含 .backup 与 .*.tmp-* 临时文件）不参与列表与工具
    if name.starts_with('.') {
      continue;
    }
    let file_type = match entry.file_type() {
      Ok(file_type) => file_type,
      Err(_) => continue,
    };
    if !file_type.is_file() || file_type.is_symlink() {
      continue;
    }
    // 单个条目不可读时跳过，避免整个列表失败
    let metadata = match entry.metadata() {
      Ok(metadata) => metadata,
      Err(_) => continue,
    };
    entries.push(entry_of(&name, &metadata));
  }
  entries.sort_by_cached_key(|entry| {
    (
      memory_rank(&entry.name).unwrap_or(2),
      entry.name.to_lowercase(),
      entry.name.clone(),
    )
  });
  let truncated = entries.len() > MEMORY_DIR_MAX_FILES;
  entries.truncate(MEMORY_DIR_MAX_FILES);
  Ok(MemoryList { entries, truncated })
}

/// 读取文件窗口：剥离 BOM、CRLF → LF、拒绝非 UTF-8；超过 64 KiB 时只返回 32 KiB / 2000 行。
///
/// 两份记忆文件缺失时按模板创建；额外文件缺失返回 not_found。
pub fn read_memory(
  root: &Path,
  name: &str,
  offset: Option<u32>,
  limit: Option<u32>,
) -> Result<MemoryRead, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  let offset = offset.unwrap_or(1).max(1);
  let limit = limit.unwrap_or(READ_MAX_LINES).clamp(1, READ_MAX_LINES);

  let metadata = match fs::symlink_metadata(&target) {
    Ok(metadata) => metadata,
    Err(error) if error.kind() == ErrorKind::NotFound => match template_for(&canonical) {
      // 首次读取两份记忆文件：按模板创建（已存在则不覆盖）
      Some(template) => {
        create_template(&target, template, &canonical)?;
        fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?
      }
      None => return Err(MemoryError::not_found(&canonical)),
    },
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  };
  if !metadata.is_file() {
    return Err(MemoryError::not_file(&canonical));
  }

  let size = metadata.len();
  let modified_at = modified_ms(&metadata);
  // 小文件整体读入（≤64 KiB）并返回全文哈希；大文件流式按行统计，避免整体载入内存
  let (page, hash) = if size <= MEMORY_FILE_MAX_BYTES {
    let normalized = read_normalized_file(&target, &canonical)?;
    let hash = sha256_hex(normalized.as_bytes());
    let page = paginate(
      split_lines(&normalized)
        .into_iter()
        .map(|line| Ok(line.to_string())),
      offset,
      limit,
    )?;
    (page, Some(hash))
  } else {
    let file = fs::File::open(&target).map_err(|error| io_error(&error, "read", &canonical))?;
    let page = paginate(
      LineReader::new(BufReader::new(file), &canonical),
      offset,
      limit,
    )?;
    (page, None)
  };

  Ok(MemoryRead {
    name: canonical.clone(),
    size,
    modified_at,
    is_memory: is_memory_file(&canonical),
    content: page.content,
    start_line: page.start_line,
    end_line: page.end_line,
    total_lines: page.total_lines,
    hash,
    truncated: page.truncated,
    line_truncated: page.line_truncated,
  })
}

/// 编辑器用的全文读取：只做 BOM 与 CRLF 归一化，不做行数 / 字节数窗口。
///
/// 超过 64 KiB 的文件照常返回完整内容（编辑器据此提示无法保存），只是不再返回哈希；
/// 缺失的两份记忆文件与 memory_read 一样先按模板创建，额外文件仍返回 not_found。
pub fn read_full(root: &Path, name: &str) -> Result<MemoryFullRead, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  let metadata = match fs::symlink_metadata(&target) {
    Ok(metadata) => metadata,
    Err(error) if error.kind() == ErrorKind::NotFound => match template_for(&canonical) {
      Some(template) => {
        create_template(&target, template, &canonical)?;
        fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?
      }
      None => return Err(MemoryError::not_found(&canonical)),
    },
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  };
  if !metadata.is_file() {
    return Err(MemoryError::not_file(&canonical));
  }
  let size = metadata.len();
  let modified_at = modified_ms(&metadata);
  let content = read_normalized_file(&target, &canonical)?;
  let hash = if size <= MEMORY_FILE_MAX_BYTES {
    Some(sha256_hex(content.as_bytes()))
  } else {
    None
  };
  Ok(MemoryFullRead {
    name: canonical,
    content,
    size,
    modified_at,
    hash,
  })
}

/// 新建空文件：只允许额外 .md 文件；保留名、重名、超过 200 个文件均拒绝。
pub fn create_file(root: &Path, name: &str) -> Result<MemoryFileResult, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  if is_memory_file(&canonical) {
    return Err(MemoryError::read_only(format!(
      "{canonical} is managed by the app and cannot be created"
    )));
  }
  if !has_markdown_extension(&canonical) {
    return Err(MemoryError::invalid_path(
      "Only .md files can be created in the memory directory",
    ));
  }
  if fs::symlink_metadata(&target).is_ok() {
    return Err(MemoryError::exists(&canonical));
  }
  if count_regular_files(root)? >= MEMORY_DIR_MAX_FILES {
    return Err(MemoryError::too_many_files());
  }
  match fs::OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&target)
  {
    Ok(file) => {
      write_and_sync(file, b"").map_err(|error| io_error(&error, "create", &canonical))?
    }
    Err(error) if error.kind() == ErrorKind::AlreadyExists => {
      return Err(MemoryError::exists(&canonical));
    }
    Err(error) => return Err(io_error(&error, "create", &canonical)),
  }
  let metadata =
    fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?;
  Ok(MemoryFileResult {
    entry: entry_of(&canonical, &metadata),
    hash: sha256_hex(b""),
  })
}

/// 重命名额外文件：保留名 read_only，目标必须不存在，成功后清除旧名与新名的备份槽。
pub fn rename_file(
  root: &Path,
  old_name: &str,
  new_name: &str,
) -> Result<MemoryFileResult, MemoryError> {
  ensure_root(root)?;
  let (old_target, old_canonical) = resolve_target(root, old_name)?;
  let (new_target, new_canonical) = resolve_target(root, new_name)?;
  if is_memory_file(&old_canonical) || is_memory_file(&new_canonical) {
    return Err(MemoryError::read_only(
      "USER.md and MEMORY.md cannot be renamed",
    ));
  }
  match fs::symlink_metadata(&old_target) {
    Ok(metadata) if metadata.is_file() => {}
    Ok(_) => return Err(MemoryError::not_file(&old_canonical)),
    Err(error) if error.kind() == ErrorKind::NotFound => {
      return Err(MemoryError::not_found(&old_canonical));
    }
    Err(error) => return Err(io_error(&error, "read", &old_canonical)),
  }
  if fs::symlink_metadata(&new_target).is_ok() {
    return Err(MemoryError::exists(&new_canonical));
  }
  if count_regular_files(root)? >= MEMORY_DIR_MAX_FILES {
    return Err(MemoryError::too_many_files());
  }
  fs::rename(&old_target, &new_target)
    .map_err(|error| io_error(&error, "rename", &old_canonical))?;
  clear_backup(root, &old_canonical);
  clear_backup(root, &new_canonical);
  let metadata =
    fs::symlink_metadata(&new_target).map_err(|error| io_error(&error, "read", &new_canonical))?;
  let hash = file_hash(&new_target, &new_canonical)?.unwrap_or_default();
  Ok(MemoryFileResult {
    entry: entry_of(&new_canonical, &metadata),
    hash,
  })
}

/// 删除额外文件并清除其备份；保留名 read_only。
pub fn delete_file(root: &Path, name: &str) -> Result<(), MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  if is_memory_file(&canonical) {
    return Err(MemoryError::read_only(format!(
      "{canonical} is managed by the app and cannot be deleted"
    )));
  }
  match fs::symlink_metadata(&target) {
    Ok(metadata) if metadata.is_file() => {}
    Ok(_) => return Err(MemoryError::not_file(&canonical)),
    Err(error) if error.kind() == ErrorKind::NotFound => {
      return Err(MemoryError::not_found(&canonical));
    }
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  }
  fs::remove_file(&target).map_err(|error| io_error(&error, "delete", &canonical))?;
  clear_backup(root, &canonical);
  Ok(())
}

/// 用户保存：拒绝超过 64 KiB，expectedHash 不一致返回 conflict；
/// 两份记忆文件可以重新创建，额外文件必须已存在；成功后清除该文件的撤销备份。
pub fn write_file(
  root: &Path,
  name: &str,
  content: &str,
  expected_hash: Option<&str>,
) -> Result<MemoryFileResult, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  let normalized = normalize_text(content);
  if normalized.len() as u64 > MEMORY_FILE_MAX_BYTES {
    return Err(MemoryError::too_large(&canonical));
  }
  let existing = match fs::symlink_metadata(&target) {
    Ok(metadata) => Some(metadata),
    Err(error) if error.kind() == ErrorKind::NotFound => None,
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  };
  if let Some(metadata) = &existing {
    if !metadata.is_file() {
      return Err(MemoryError::not_file(&canonical));
    }
  }
  if existing.is_none() && !is_memory_file(&canonical) {
    return Err(MemoryError::not_found(&canonical));
  }
  if let Some(expected) = expected_hash {
    // 文件已不存在（被外部删除）也算冲突：编辑器加载时看到的内容已经变了
    let current = if existing.is_some() {
      file_hash(&target, &canonical)?
    } else {
      None
    };
    if current.as_deref() != Some(expected) {
      return Err(MemoryError::conflict(&canonical));
    }
  }
  atomic_write(root, &target, normalized.as_bytes(), &canonical)?;
  clear_backup(root, &canonical);
  let metadata =
    fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?;
  Ok(MemoryFileResult {
    entry: entry_of(&canonical, &metadata),
    hash: sha256_hex(normalized.as_bytes()),
  })
}

/// 模型编辑：字面替换（LF 归一化），唯一匹配或 replace_all；
/// 写盘前保存上一版到备份槽，备份失败则拒绝编辑。
pub fn edit_file(
  root: &Path,
  name: &str,
  old_string: &str,
  new_string: &str,
  replace_all: bool,
  tool_use_id: &str,
) -> Result<MemoryEditResult, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  let old_text = normalize_text(old_string);
  let new_text = normalize_text(new_string);
  // 参数校验先于文件读写：空 old_string 是调用错误，不是文件问题
  if old_text.is_empty() {
    return Err(MemoryError::invalid_argument(
      "old_string must not be empty",
    ));
  }

  let metadata = match fs::symlink_metadata(&target) {
    Ok(metadata) => metadata,
    Err(error) if error.kind() == ErrorKind::NotFound => match template_for(&canonical) {
      // 两份记忆文件由读取隐式创建；编辑沿用同一规则，但绝不创建额外文件
      Some(template) => {
        create_template(&target, template, &canonical)?;
        fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?
      }
      None => return Err(MemoryError::not_found(&canonical)),
    },
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  };
  if !metadata.is_file() {
    return Err(MemoryError::not_file(&canonical));
  }
  // 超限文件直接拒绝，不必整体读入
  if metadata.len() > MEMORY_FILE_MAX_BYTES {
    return Err(MemoryError::too_large(&canonical));
  }
  let current = read_normalized_file(&target, &canonical)?;

  if old_text == new_text {
    // 没有实际变化：不写盘、不创建备份
    return Ok(MemoryEditResult {
      entry: entry_of(&canonical, &metadata),
      replacements: 0,
      backup_id: String::new(),
      hash: sha256_hex(current.as_bytes()),
    });
  }

  let occurrences = current.matches(old_text.as_str()).count();
  if occurrences == 0 || (!replace_all && occurrences > 1) {
    return Err(no_match_error(&canonical, occurrences));
  }
  let next = if replace_all {
    current.replace(old_text.as_str(), new_text.as_str())
  } else {
    current.replacen(old_text.as_str(), new_text.as_str(), 1)
  };
  if next.len() as u64 > MEMORY_FILE_MAX_BYTES {
    return Err(MemoryError::too_large(&canonical));
  }

  let edited_hash = sha256_hex(next.as_bytes());
  let edited_at = now_ms();
  let backup_id = backup_id_for(edited_at, &edited_hash);
  save_backup(
    root,
    &canonical,
    &current,
    &edited_hash,
    edited_at,
    &backup_id,
    tool_use_id,
  )?;
  atomic_write(root, &target, next.as_bytes(), &canonical)?;
  let metadata =
    fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?;
  let replacements = if replace_all {
    occurrences.min(u32::MAX as usize) as u32
  } else {
    1
  };
  Ok(MemoryEditResult {
    entry: entry_of(&canonical, &metadata),
    replacements,
    backup_id,
    hash: edited_hash,
  })
}

/// 撤销最近一次模型编辑：备份必须存在，当前内容哈希必须等于备份记录的新内容哈希。
pub fn undo_edit(root: &Path, name: &str) -> Result<MemoryFileResult, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  let (previous_path, meta_path) = backup_paths(root, &canonical);
  let meta = match read_backup_meta(&meta_path)? {
    Some(meta) => meta,
    None => return Err(MemoryError::no_backup(&canonical)),
  };
  let previous = match fs::read(&previous_path) {
    Ok(bytes) => normalized_from_bytes(&bytes, &canonical)?,
    Err(error) if error.kind() == ErrorKind::NotFound => {
      return Err(MemoryError::no_backup(&canonical));
    }
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  };
  match fs::symlink_metadata(&target) {
    Ok(metadata) if metadata.is_file() => {}
    Ok(_) => return Err(MemoryError::not_file(&canonical)),
    Err(error) if error.kind() == ErrorKind::NotFound => {
      return Err(MemoryError::not_found(&canonical));
    }
    Err(error) => return Err(io_error(&error, "read", &canonical)),
  }
  let current = read_normalized_file(&target, &canonical)?;
  if sha256_hex(current.as_bytes()) != meta.edited_hash {
    return Err(MemoryError::backup_stale(&canonical));
  }
  if previous.len() as u64 > MEMORY_FILE_MAX_BYTES {
    return Err(MemoryError::too_large(&canonical));
  }
  atomic_write(root, &target, previous.as_bytes(), &canonical)?;
  // 恢复成功后才删除备份，避免恢复失败时丢失撤销入口
  let _ = fs::remove_file(&previous_path);
  let _ = fs::remove_file(&meta_path);
  let metadata =
    fs::symlink_metadata(&target).map_err(|error| io_error(&error, "read", &canonical))?;
  Ok(MemoryFileResult {
    entry: entry_of(&canonical, &metadata),
    hash: sha256_hex(previous.as_bytes()),
  })
}

/// 查询撤销可用性：两份备份文件都存在，且备份记录的新内容哈希等于当前内容哈希。
pub fn backup_state(root: &Path, name: &str) -> Result<MemoryBackupState, MemoryError> {
  ensure_root(root)?;
  let (target, canonical) = resolve_target(root, name)?;
  let unavailable = MemoryBackupState {
    available: false,
    backup_id: None,
    edited_at: None,
    edited_hash: None,
  };
  let (previous_path, meta_path) = backup_paths(root, &canonical);
  let meta = match read_backup_meta(&meta_path)? {
    Some(meta) => meta,
    None => return Ok(unavailable),
  };
  if !previous_path.is_file() {
    return Ok(unavailable);
  }
  // 文件被外部删除 / 超过 64 KiB / 无法读取都视为不可撤销
  let current = match file_hash(&target, &canonical) {
    Ok(Some(hash)) => hash,
    Ok(None) => return Ok(unavailable),
    Err(_) => return Ok(unavailable),
  };
  if current != meta.edited_hash {
    return Ok(unavailable);
  }
  Ok(MemoryBackupState {
    available: true,
    backup_id: Some(meta.backup_id),
    edited_at: Some(meta.edited_at),
    edited_hash: Some(meta.edited_hash),
  })
}

// ---------------------------------------------------------------------------
// 路径沙箱
// ---------------------------------------------------------------------------

/// 校验单个路径段：拒绝空名、. / ..、分隔符、控制字符、盘符、隐藏名与超长名。
fn validate_name(name: &str) -> Result<(), MemoryError> {
  let segment_message = "Path must be a file name inside the memory directory";
  if name.is_empty() {
    return Err(MemoryError::invalid_path("File name must not be empty"));
  }
  if name.chars().count() > FILE_NAME_MAX {
    return Err(MemoryError::invalid_path(
      "File name must be at most 64 characters",
    ));
  }
  if name == "." || name == ".." {
    return Err(MemoryError::invalid_path(segment_message));
  }
  if name.starts_with('.') {
    return Err(MemoryError::invalid_path(
      "Hidden file names are not allowed",
    ));
  }
  if name.contains('/') || name.contains('\\') {
    return Err(MemoryError::invalid_path(segment_message));
  }
  if name.contains(':') {
    // 盘符（C:）与 Windows 备用数据流（notes.md:stream）
    return Err(MemoryError::invalid_path(segment_message));
  }
  if name.chars().any(|character| character.is_control()) {
    return Err(MemoryError::invalid_path(
      "File name must not contain control characters",
    ));
  }
  if Path::new(name).is_absolute() || Path::new(name).components().count() != 1 {
    return Err(MemoryError::invalid_path(segment_message));
  }
  Ok(())
}

/// 保留名比较：Windows 不区分大小写（防 user.md 绕过），其它平台按固定名比较。
#[cfg(windows)]
fn same_file_name(left: &str, right: &str) -> bool {
  left.eq_ignore_ascii_case(right)
}

#[cfg(not(windows))]
fn same_file_name(left: &str, right: &str) -> bool {
  left == right
}

/// 命中保留名时返回磁盘上的固定名，否则返回 None。
fn reserved_name(name: &str) -> Option<&'static str> {
  if same_file_name(name, USER_FILE) {
    Some(USER_FILE)
  } else if same_file_name(name, MEMORY_FILE) {
    Some(MEMORY_FILE)
  } else {
    None
  }
}

fn is_memory_file(name: &str) -> bool {
  reserved_name(name).is_some()
}

fn template_for(name: &str) -> Option<&'static str> {
  if name == USER_FILE {
    Some(USER_TEMPLATE)
  } else if name == MEMORY_FILE {
    Some(MEMORY_TEMPLATE)
  } else {
    None
  }
}

/// 排序权重：USER.md 最前、MEMORY.md 次之，其余交给名称比较。
fn memory_rank(name: &str) -> Option<u8> {
  match reserved_name(name) {
    Some(canonical) if canonical == USER_FILE => Some(0),
    Some(_) => Some(1),
    None => None,
  }
}

fn has_markdown_extension(name: &str) -> bool {
  name.len() > 3 && name.to_ascii_lowercase().ends_with(".md")
}

/// 把单个文件名解析为根目录内的路径：
/// 单段名称 → 保留名归一 → canonicalize 父目录并确认等于根目录 → 拒绝符号链接。
fn resolve_target(root: &Path, name: &str) -> Result<(PathBuf, String), MemoryError> {
  validate_name(name)?;
  let canonical_name = reserved_name(name).unwrap_or(name).to_string();
  let target = root.join(&canonical_name);
  let canonical_root = root.canonicalize().map_err(|error| root_io_error(&error))?;
  let parent = target.parent().ok_or_else(|| {
    MemoryError::invalid_path("Path must be a file name inside the memory directory")
  })?;
  let canonical_parent = parent.canonicalize().map_err(|_| {
    MemoryError::invalid_path("Path must be a file name inside the memory directory")
  })?;
  if canonical_parent != canonical_root {
    return Err(MemoryError::invalid_path(
      "Path must be a file name inside the memory directory",
    ));
  }
  match fs::symlink_metadata(&target) {
    Ok(metadata) if metadata.file_type().is_symlink() => Err(MemoryError::invalid_path(
      "Symbolic links are not allowed in the memory directory",
    )),
    _ => Ok((target, canonical_name)),
  }
}

/// 统计根目录内普通文件数（跳过隐藏文件、目录与符号链接），用于 200 个文件的上限。
fn count_regular_files(root: &Path) -> Result<usize, MemoryError> {
  let read_dir =
    fs::read_dir(root).map_err(|error| io_error(&error, "list", "the memory directory"))?;
  let mut count = 0;
  for entry in read_dir.flatten() {
    let name = entry.file_name();
    let name = name.to_string_lossy();
    if name.starts_with('.') {
      continue;
    }
    if let Ok(file_type) = entry.file_type() {
      if file_type.is_file() && !file_type.is_symlink() {
        count += 1;
      }
    }
  }
  Ok(count)
}

// ---------------------------------------------------------------------------
// 内容读取与分页
// ---------------------------------------------------------------------------

struct Page {
  content: String,
  start_line: u32,
  end_line: u32,
  total_lines: u32,
  truncated: bool,
  line_truncated: bool,
}

/// 统一 LF、去掉 UTF-8 BOM；读取、写入与比较都使用归一化后的内容。
fn normalize_text(text: &str) -> String {
  text
    .strip_prefix('\u{feff}')
    .unwrap_or(text)
    .replace("\r\n", "\n")
}

fn normalized_from_bytes(bytes: &[u8], name: &str) -> Result<String, MemoryError> {
  let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
  let text = std::str::from_utf8(bytes).map_err(|_| MemoryError::binary(name))?;
  // 文本文件里出现 NUL 视为二进制，避免把可执行文件当记忆读
  if text.as_bytes().contains(&0) {
    return Err(MemoryError::binary(name));
  }
  Ok(normalize_text(text))
}

fn read_normalized_file(target: &Path, name: &str) -> Result<String, MemoryError> {
  let bytes = fs::read(target).map_err(|error| io_error(&error, "read", name))?;
  normalized_from_bytes(&bytes, name)
}

/// 当前内容的 SHA-256；文件不存在、不是普通文件或超过 64 KiB 时返回 None。
fn file_hash(target: &Path, name: &str) -> Result<Option<String>, MemoryError> {
  match fs::symlink_metadata(target) {
    Ok(metadata) if metadata.is_file() && metadata.len() <= MEMORY_FILE_MAX_BYTES => {
      let content = read_normalized_file(target, name)?;
      Ok(Some(sha256_hex(content.as_bytes())))
    }
    Ok(_) => Ok(None),
    Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
    Err(error) => Err(io_error(&error, "read", name)),
  }
}

/// 行数口径与 str::lines / Web 适配器一致：末尾换行不产生空行，空文件 0 行。
fn split_lines(text: &str) -> Vec<&str> {
  if text.is_empty() {
    return Vec::new();
  }
  let body = text.strip_suffix('\n').unwrap_or(text);
  if body.is_empty() {
    return Vec::new();
  }
  body.split('\n').collect()
}

/// 按 offset / limit / 32 KiB 预算取窗口；至少返回一行，单行超过 2000 码元时截断。
fn paginate<I>(lines: I, offset: u32, limit: u32) -> Result<Page, MemoryError>
where
  I: IntoIterator<Item = Result<String, MemoryError>>,
{
  let mut total: u32 = 0;
  let mut selected: Vec<String> = Vec::new();
  let mut bytes: usize = 0;
  let mut line_truncated = false;
  let mut truncated = false;

  for line in lines {
    let line = line?;
    total = total.saturating_add(1);
    if total < offset {
      continue;
    }
    if selected.len() as u32 >= limit {
      truncated = true;
      continue;
    }
    let (text, was_truncated) = truncate_line(&line);
    let cost = text.len() + usize::from(!selected.is_empty());
    if !selected.is_empty() && bytes.saturating_add(cost) > READ_MAX_BYTES {
      truncated = true;
      continue;
    }
    if was_truncated {
      line_truncated = true;
    }
    bytes = bytes.saturating_add(cost);
    selected.push(text);
  }

  let (start_line, end_line) = if selected.is_empty() {
    (offset, offset.saturating_sub(1))
  } else {
    (
      offset,
      offset
        .saturating_add(selected.len() as u32)
        .saturating_sub(1),
    )
  };
  Ok(Page {
    content: selected.join("\n"),
    start_line,
    end_line,
    total_lines: total,
    truncated,
    line_truncated,
  })
}

/// 单行按 UTF-16 码元截断（与 Web 适配器 text.ts 口径一致），并追加截断标记。
fn truncate_line(line: &str) -> (String, bool) {
  if line.encode_utf16().count() <= READ_MAX_LINE_CHARS {
    return (line.to_string(), false);
  }
  let mut text = String::with_capacity(READ_MAX_LINE_CHARS + LINE_TRUNCATED_SUFFIX.len());
  let mut used = 0;
  for character in line.chars() {
    let units = character.len_utf16();
    if used + units > READ_MAX_LINE_CHARS {
      break;
    }
    text.push(character);
    used += units;
  }
  text.push_str(LINE_TRUNCATED_SUFFIX);
  (text, true)
}

/// 流式按行读取：剥离 BOM、CRLF → LF，用于超过 64 KiB 的文件，避免整体载入内存。
struct LineReader<R: BufRead> {
  reader: R,
  name: String,
  first: bool,
  done: bool,
}

impl<R: BufRead> LineReader<R> {
  fn new(reader: R, name: &str) -> Self {
    Self {
      reader,
      name: name.to_string(),
      first: true,
      done: false,
    }
  }
}

impl<R: BufRead> Iterator for LineReader<R> {
  type Item = Result<String, MemoryError>;

  fn next(&mut self) -> Option<Self::Item> {
    if self.done {
      return None;
    }
    let mut buffer = Vec::new();
    match self.reader.read_until(b'\n', &mut buffer) {
      Ok(0) => {
        self.done = true;
        None
      }
      Ok(_) => {
        let has_newline = buffer.last() == Some(&b'\n');
        if has_newline {
          buffer.pop();
        }
        let mut bytes: &[u8] = &buffer;
        if self.first {
          self.first = false;
          bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
        }
        // 仅把 CRLF 归一化为 LF；单独的 CR 保持原样（与 normalize_text 一致）
        if has_newline && bytes.last() == Some(&b'\r') {
          bytes = &bytes[..bytes.len() - 1];
        }
        match std::str::from_utf8(bytes) {
          Ok(text) if !text.as_bytes().contains(&0) => Some(Ok(text.to_string())),
          _ => {
            self.done = true;
            Some(Err(MemoryError::binary(&self.name)))
          }
        }
      }
      Err(error) => {
        self.done = true;
        Some(Err(io_error(&error, "read", &self.name)))
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 写入、模板与备份
// ---------------------------------------------------------------------------

/// 原子写：同目录临时文件 → write_all + sync_all → rename 覆盖目标。
/// 任一步失败都删除临时文件并保留原文件。
fn atomic_write(dir: &Path, target: &Path, bytes: &[u8], name: &str) -> Result<(), MemoryError> {
  let file_name = target
    .file_name()
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_else(|| "file".to_string());
  let mut last_error: Option<std::io::Error> = None;
  for _ in 0..4 {
    let temp = dir.join(format!(".{file_name}.tmp-{}", unique_suffix()));
    let file = match fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&temp)
    {
      Ok(file) => file,
      Err(error) if error.kind() == ErrorKind::AlreadyExists => {
        last_error = Some(error);
        continue;
      }
      Err(error) => return Err(io_error(&error, "write", name)),
    };
    if let Err(error) = write_and_sync(file, bytes) {
      let _ = fs::remove_file(&temp);
      return Err(io_error(&error, "write", name));
    }
    return match fs::rename(&temp, target) {
      Ok(()) => Ok(()),
      Err(error) => {
        let _ = fs::remove_file(&temp);
        Err(io_error(&error, "write", name))
      }
    };
  }
  let error = last_error.unwrap_or_else(|| std::io::Error::other("temporary file conflict"));
  Err(io_error(&error, "write", name))
}

fn write_and_sync(mut file: fs::File, bytes: &[u8]) -> std::io::Result<()> {
  file.write_all(bytes)?;
  file.sync_all()
}

/// 按模板创建记忆文件；已存在则不做任何改动（并发创建也安全）。
fn create_template(target: &Path, template: &str, name: &str) -> Result<(), MemoryError> {
  match fs::OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(target)
  {
    Ok(file) => {
      write_and_sync(file, template.as_bytes()).map_err(|error| io_error(&error, "create", name))
    }
    Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
    Err(error) => Err(io_error(&error, "create", name)),
  }
}

/// 备份槽路径：<root>/.backup/<sha256(name)>.prev 与同名 .json。
fn backup_paths(root: &Path, name: &str) -> (PathBuf, PathBuf) {
  let key = sha256_hex(name.as_bytes());
  let dir = root.join(BACKUP_DIR);
  (
    dir.join(format!("{key}{BACKUP_SUFFIX}")),
    dir.join(format!("{key}{BACKUP_META_SUFFIX}")),
  )
}

fn backup_id_for(edited_at: u64, edited_hash: &str) -> String {
  let prefix: String = edited_hash.chars().take(8).collect();
  format!("{edited_at}-{prefix}")
}

/// 写入撤销备份（上一版内容 + 元数据）；一次编辑只占一个槽位。
/// 任何一步失败都清理半份备份并返回错误，让调用方拒绝本次编辑。
fn save_backup(
  root: &Path,
  name: &str,
  previous: &str,
  edited_hash: &str,
  edited_at: u64,
  backup_id: &str,
  tool_use_id: &str,
) -> Result<(), MemoryError> {
  let dir = root.join(BACKUP_DIR);
  fs::create_dir_all(&dir).map_err(|error| root_io_error(&error))?;
  let (previous_path, meta_path) = backup_paths(root, name);
  let meta = BackupMeta {
    name: name.to_string(),
    edited_hash: edited_hash.to_string(),
    edited_at,
    backup_id: backup_id.to_string(),
    tool_use_id: tool_use_id.to_string(),
  };
  let meta_json = serde_json::to_vec(&meta)
    .map_err(|_| MemoryError::new("io", "Could not encode the backup metadata"))?;
  if let Err(error) = atomic_write(&dir, &previous_path, previous.as_bytes(), name) {
    let _ = fs::remove_file(&previous_path);
    let _ = fs::remove_file(&meta_path);
    return Err(error);
  }
  if let Err(error) = atomic_write(&dir, &meta_path, &meta_json, name) {
    let _ = fs::remove_file(&previous_path);
    let _ = fs::remove_file(&meta_path);
    return Err(error);
  }
  Ok(())
}

/// 清除某文件的备份槽；失败不影响主操作（哈希校验会阻止过期备份被撤销）。
fn clear_backup(root: &Path, name: &str) {
  let (previous_path, meta_path) = backup_paths(root, name);
  for path in [previous_path, meta_path] {
    match fs::remove_file(&path) {
      Ok(()) => {}
      Err(error) if error.kind() == ErrorKind::NotFound => {}
      Err(_) => {}
    }
  }
}

/// 读取备份元数据；缺失或损坏都视为「没有备份」。
fn read_backup_meta(path: &Path) -> Result<Option<BackupMeta>, MemoryError> {
  match fs::read(path) {
    Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
    Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
    Err(error) => Err(io_error(&error, "read", "the backup metadata")),
  }
}

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

fn entry_of(name: &str, metadata: &fs::Metadata) -> MemoryEntry {
  MemoryEntry {
    name: name.to_string(),
    size: metadata.len(),
    modified_at: modified_ms(metadata),
    is_memory: is_memory_file(name),
  }
}

fn no_match_error(name: &str, occurrences: usize) -> MemoryError {
  let message = if occurrences == 0 {
    format!(
      "old_string was not found in {name} (0 occurrences); read the file first and use the exact text"
    )
  } else {
    format!(
      "old_string appears {occurrences} times in {name}; read the file first and pass replace_all or pick a unique snippet"
    )
  };
  MemoryError::new("no_match", message)
}

fn sha256_hex(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let digest = Sha256::digest(bytes);
  let mut out = String::with_capacity(digest.len() * 2);
  for byte in digest.iter().copied() {
    out.push(HEX[(byte >> 4) as usize] as char);
    out.push(HEX[(byte & 0x0f) as usize] as char);
  }
  out
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
  metadata
    .modified()
    .ok()
    .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

/// 临时文件名后缀：进程号 + 纳秒 + 进程内自增，跨进程/并发都不重名（不引入 uuid crate）。
fn unique_suffix() -> String {
  let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or(0);
  format!("{}-{nanos}-{counter}", std::process::id())
}

// 单元测试
#[cfg(test)]
mod tests {
  use super::*;

  static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

  /// 每个用例一个独立临时目录，退出时删除；测试不接触真实 ~/.naut。
  struct TempDir {
    path: PathBuf,
  }

  impl TempDir {
    fn new(label: &str) -> Self {
      let unique = format!(
        "naut-memory-test-{label}-{}-{}-{}",
        std::process::id(),
        now_ms(),
        TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
      );
      // 默认放在系统临时目录；受限沙箱里那里可能不可写，退回 crate 的 target 目录
      let candidates = [
        std::env::temp_dir().join(&unique),
        Path::new(env!("CARGO_MANIFEST_DIR"))
          .join("target")
          .join("tmp-memory-tests")
          .join(&unique),
      ];
      for path in candidates {
        match fs::create_dir_all(&path) {
          Ok(()) => return Self { path },
          Err(error)
            if matches!(
              error.kind(),
              ErrorKind::PermissionDenied | ErrorKind::NotFound
            ) => {}
          Err(error) => {
            panic!("create temp dir {} failed: {error}", path.display())
          }
        }
      }
      panic!("could not create a temporary directory for tests")
    }

    fn path(&self) -> &Path {
      &self.path
    }
  }

  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.path);
    }
  }

  fn write_raw(root: &Path, name: &str, content: &str) {
    fs::write(root.join(name), content).expect("write raw file");
  }

  fn read_raw(root: &Path, name: &str) -> String {
    fs::read_to_string(root.join(name)).expect("read raw file")
  }

  fn backup_files(root: &Path, name: &str) -> (PathBuf, PathBuf) {
    backup_paths(root, name)
  }

  /// 断言目录里没有残留的原子写临时文件（.*.tmp-*）。
  fn assert_no_temp_files(dir: &Path) {
    for entry in fs::read_dir(dir).expect("read dir") {
      let name = entry
        .expect("dir entry")
        .file_name()
        .to_string_lossy()
        .to_string();
      assert!(
        !name.contains(".tmp-"),
        "temporary file left behind: {name}"
      );
    }
  }

  #[test]
  fn sha256_matches_known_vectors() {
    assert_eq!(
      sha256_hex(b"abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
      sha256_hex(b""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  }

  #[test]
  fn error_serializes_code_and_message() {
    let error = MemoryError::new("not_found", "File not found: notes.md");
    let value = serde_json::to_value(&error).expect("serialize error");
    assert_eq!(
      value,
      serde_json::json!({ "code": "not_found", "message": "File not found: notes.md" })
    );
    assert_eq!(error.to_string(), "File not found: notes.md");
    assert_eq!(error.code(), "not_found");
    let _: &dyn std::error::Error = &error;
  }

  #[test]
  fn rejects_unsafe_path_names() {
    let root = TempDir::new("path");
    let cases = [
      "../secret.md",
      "sub/notes.md",
      "sub\\notes.md",
      "/etc/passwd",
      "C:\\secret.md",
      "..",
      ".",
      ".hidden.md",
      "",
      "na\0me.md",
      "c:notes.md",
    ];
    for name in cases {
      let error = read_memory(root.path(), name, None, None).expect_err("path should be rejected");
      assert_eq!(error.code(), "invalid_path", "{name} -> {error:?}");
    }
    // 除了懒创建的 .backup，根目录里没有多出任何东西
    let names: Vec<String> = fs::read_dir(root.path())
      .expect("read root")
      .map(|entry| {
        entry
          .expect("entry")
          .file_name()
          .to_string_lossy()
          .to_string()
      })
      .collect();
    assert_eq!(names, vec![BACKUP_DIR.to_string()]);
  }

  #[cfg(windows)]
  #[test]
  fn resolves_reserved_file_name_case_insensitively_on_windows() {
    let root = TempDir::new("case-windows");
    let read = read_memory(root.path(), "user.md", None, None).expect("template");
    assert_eq!(read.name, USER_FILE);
    assert!(read.is_memory);
    assert_eq!(
      fs::read_to_string(root.path().join(USER_FILE)).expect("template"),
      USER_TEMPLATE
    );
  }

  #[cfg(not(windows))]
  #[test]
  fn treats_reserved_file_name_case_sensitively_off_windows() {
    let root = TempDir::new("case-unix");
    let error = read_memory(root.path(), "user.md", None, None).expect_err("extra file missing");
    assert_eq!(error.code(), "not_found");
    assert!(!root.path().join(USER_FILE).exists());
  }

  #[cfg(unix)]
  #[test]
  fn rejects_symlinks() {
    use std::os::unix::fs::symlink;

    let root = TempDir::new("symlink");
    let outside = TempDir::new("symlink-outside");
    fs::write(outside.path().join("secret.md"), "top secret").expect("seed secret");
    symlink(
      outside.path().join("secret.md"),
      root.path().join("notes.md"),
    )
    .expect("create symlink");

    assert_eq!(
      read_memory(root.path(), "notes.md", None, None)
        .expect_err("symlink read")
        .code(),
      "invalid_path"
    );
    assert_eq!(
      edit_file(root.path(), "notes.md", "top", "other", false, "t")
        .expect_err("symlink edit")
        .code(),
      "invalid_path"
    );
    // 列表跳过符号链接
    let list = list_entries(root.path()).expect("list");
    assert!(list.entries.is_empty(), "{:?}", list.entries);
  }

  #[test]
  fn creates_templates_on_first_read() {
    let root = TempDir::new("template");
    let user = read_memory(root.path(), USER_FILE, None, None).expect("user template");
    assert_eq!(
      fs::read_to_string(root.path().join(USER_FILE)).expect("file"),
      USER_TEMPLATE
    );
    assert_eq!(user.name, USER_FILE);
    assert!(user.is_memory);
    assert_eq!(user.total_lines, 4);
    assert_eq!(user.start_line, 1);
    assert_eq!(user.end_line, 4);
    assert_eq!(
      user.content,
      "# USER.md\n\n> 用户偏好与资料；对话开始时会自动注入。\n"
    );
    assert!(user.hash.is_some());

    let memory = read_memory(root.path(), MEMORY_FILE, None, None).expect("memory template");
    assert_eq!(
      fs::read_to_string(root.path().join(MEMORY_FILE)).expect("file"),
      MEMORY_TEMPLATE
    );
    assert_eq!(memory.total_lines, 4);

    // 已存在时不会被模板覆盖
    write_raw(root.path(), USER_FILE, "custom\n");
    let again = read_memory(root.path(), USER_FILE, None, None).expect("existing");
    assert_eq!(again.content, "custom");
  }

  #[test]
  fn missing_extra_file_returns_not_found() {
    let root = TempDir::new("missing");
    let error = read_memory(root.path(), "notes.md", None, None).expect_err("missing");
    assert_eq!(error.code(), "not_found");
    assert!(!root.path().join("notes.md").exists());
  }

  #[test]
  fn reads_with_pagination() {
    let root = TempDir::new("read-page");
    let lines: Vec<String> = (1..=100).map(|index| format!("line {index}")).collect();
    write_raw(root.path(), "notes.md", &(lines.join("\n") + "\n"));
    let size = fs::metadata(root.path().join("notes.md"))
      .expect("metadata")
      .len();

    let page = read_memory(root.path(), "notes.md", Some(50), Some(10)).expect("read");
    assert_eq!(page.start_line, 50);
    assert_eq!(page.end_line, 59);
    assert_eq!(page.total_lines, 100);
    assert!(page.truncated);
    assert!(!page.line_truncated);
    assert_eq!(page.content, lines[49..59].join("\n"));
    assert_eq!(page.size, size);
    let raw = fs::read(root.path().join("notes.md")).expect("bytes");
    assert_eq!(page.hash.as_deref(), Some(sha256_hex(&raw).as_str()));
    assert!(page.modified_at > 0);
  }

  #[test]
  fn reads_beyond_total_lines() {
    let root = TempDir::new("read-offset");
    write_raw(root.path(), "notes.md", "alpha\nbeta\n");
    let page = read_memory(root.path(), "notes.md", Some(5), None).expect("read");
    assert_eq!(page.content, "");
    assert_eq!(page.start_line, 5);
    assert_eq!(page.end_line, 4);
    assert_eq!(page.total_lines, 2);
    assert!(!page.truncated);
  }

  #[test]
  fn truncates_long_lines() {
    let root = TempDir::new("read-line");
    let long = "x".repeat(3000);
    write_raw(root.path(), "notes.md", &format!("{long}\nshort\n"));
    let page = read_memory(root.path(), "notes.md", None, None).expect("read");
    assert!(page.line_truncated);
    let first_line = page.content.lines().next().expect("first line");
    assert!(first_line.ends_with(LINE_TRUNCATED_SUFFIX));
    assert_eq!(
      first_line.encode_utf16().count(),
      READ_MAX_LINE_CHARS + LINE_TRUNCATED_SUFFIX.encode_utf16().count()
    );
    assert_eq!(page.total_lines, 2);
    assert!(!page.truncated);
  }

  #[test]
  fn applies_read_byte_budget() {
    let root = TempDir::new("read-budget");
    let mut text = String::new();
    for _ in 0..2000 {
      text.push_str(&"y".repeat(99));
      text.push('\n');
    }
    write_raw(root.path(), "notes.md", &text);
    let page = read_memory(root.path(), "notes.md", None, None).expect("read");
    assert_eq!(page.total_lines, 2000);
    assert!(page.truncated);
    assert_eq!(page.start_line, 1);
    assert!(page.end_line < 2000);
    assert!(page.content.len() <= READ_MAX_BYTES);
    // 超过 64 KiB 的文件不返回哈希
    assert!(page.hash.is_none());
  }

  #[test]
  fn reads_large_file_without_hash() {
    let root = TempDir::new("read-large");
    let mut text = String::new();
    for index in 0..700 {
      text.push_str(&format!("{index:04} {}\n", "z".repeat(90)));
    }
    write_raw(root.path(), "big.md", &text);
    let size = fs::metadata(root.path().join("big.md"))
      .expect("metadata")
      .len();
    assert!(size > MEMORY_FILE_MAX_BYTES);

    let page = read_memory(root.path(), "big.md", None, None).expect("read");
    assert_eq!(page.size, size);
    assert!(page.hash.is_none());
    assert_eq!(page.total_lines, 700);
    assert!(page.truncated);
    assert!(page.end_line < 700);
  }

  #[test]
  fn read_full_keeps_long_lines_untruncated() {
    let root = TempDir::new("read-full");
    let long = "x".repeat(5000);
    write_raw(
      root.path(),
      "notes.md",
      &format!(
        "{long}
"
      ),
    );

    // 窗口读取会截断超长单行
    let windowed = read_memory(root.path(), "notes.md", None, None).expect("windowed read");
    assert!(windowed.line_truncated);
    assert!(windowed.content.encode_utf16().count() < 5000);

    // 全文读取返回完整内容与全文哈希
    let full = read_full(root.path(), "notes.md").expect("full read");
    assert_eq!(full.name, "notes.md");
    assert_eq!(
      full.content,
      format!(
        "{long}
"
      )
    );
    assert_eq!(full.size, 5001);
    assert_eq!(
      full.hash.as_deref(),
      Some(
        sha256_hex(
          format!(
            "{long}
"
          )
          .as_bytes()
        )
        .as_str()
      )
    );
    assert!(full.modified_at > 0);

    // 超过 64 KiB 仍完整返回，只是没有哈希
    let big = "y".repeat(70 * 1024);
    write_raw(root.path(), "big.md", &big);
    let full = read_full(root.path(), "big.md").expect("full large read");
    assert_eq!(full.content.len(), big.len());
    assert_eq!(full.size, 70 * 1024);
    assert!(full.hash.is_none());

    // 模板、缺失与二进制规则与 memory_read 一致
    let template = read_full(root.path(), USER_FILE).expect("template");
    assert_eq!(template.content, USER_TEMPLATE);
    assert_eq!(
      read_full(root.path(), "missing.md")
        .expect_err("missing")
        .code(),
      "not_found"
    );
    fs::write(root.path().join("binary.md"), [0xFF, 0xFE]).expect("binary");
    assert_eq!(
      read_full(root.path(), "binary.md")
        .expect_err("binary")
        .code(),
      "binary"
    );
  }

  #[test]
  fn normalizes_bom_and_crlf() {
    let root = TempDir::new("read-text");
    fs::write(root.path().join("notes.md"), "\u{feff}line1\r\nline2\r\n").expect("write");
    let page = read_memory(root.path(), "notes.md", None, None).expect("read");
    assert_eq!(page.content, "line1\nline2");
    assert_eq!(page.total_lines, 2);
    assert_eq!(
      page.hash.as_deref(),
      Some(sha256_hex(b"line1\nline2\n").as_str())
    );
  }

  #[test]
  fn rejects_binary_content() {
    let root = TempDir::new("read-binary");
    fs::write(root.path().join("notes.md"), [0x66, 0xFF, 0x66]).expect("write");
    assert_eq!(
      read_memory(root.path(), "notes.md", None, None)
        .expect_err("binary read")
        .code(),
      "binary"
    );
    assert_eq!(
      edit_file(root.path(), "notes.md", "f", "x", false, "t")
        .expect_err("binary edit")
        .code(),
      "binary"
    );
  }

  #[test]
  fn edit_replaces_unique_match() {
    let root = TempDir::new("edit-unique");
    write_raw(root.path(), "notes.md", "# Notes\n\nhello world\n");
    let outcome =
      edit_file(root.path(), "notes.md", "world", "there", false, "toolu_1").expect("edit");
    assert_eq!(outcome.replacements, 1);
    assert_eq!(outcome.entry.name, "notes.md");
    assert_eq!(
      read_raw(root.path(), "notes.md"),
      "# Notes\n\nhello there\n"
    );
    assert_eq!(outcome.hash, sha256_hex(b"# Notes\n\nhello there\n"));

    let (previous, meta_path) = backup_files(root.path(), "notes.md");
    assert_eq!(
      fs::read_to_string(&previous).expect("previous"),
      "# Notes\n\nhello world\n"
    );
    let meta: BackupMeta =
      serde_json::from_slice(&fs::read(&meta_path).expect("meta")).expect("metadata json");
    assert_eq!(meta.name, "notes.md");
    assert_eq!(meta.edited_hash, outcome.hash);
    assert_eq!(meta.backup_id, outcome.backup_id);
    assert_eq!(meta.tool_use_id, "toolu_1");
    assert!(meta.edited_at > 0);
    assert!(outcome.backup_id.starts_with(&meta.edited_at.to_string()));
  }

  #[test]
  fn edit_reports_missing_match_with_hint() {
    let root = TempDir::new("edit-zero");
    write_raw(root.path(), "notes.md", "alpha\n");
    let error =
      edit_file(root.path(), "notes.md", "beta", "gamma", false, "toolu_2").expect_err("no match");
    assert_eq!(error.code(), "no_match");
    assert!(
      error.message().contains("0 occurrences"),
      "{}",
      error.message()
    );
    assert!(
      error.message().contains("read the file first"),
      "{}",
      error.message()
    );
    assert_eq!(read_raw(root.path(), "notes.md"), "alpha\n");
    let (previous, meta) = backup_files(root.path(), "notes.md");
    assert!(!previous.exists());
    assert!(!meta.exists());
  }

  #[test]
  fn edit_requires_replace_all_for_multiple_matches() {
    let root = TempDir::new("edit-many");
    write_raw(root.path(), "notes.md", "same same same\n");
    let error = edit_file(
      root.path(),
      "notes.md",
      "same",
      "different",
      false,
      "toolu_3",
    )
    .expect_err("multiple matches");
    assert_eq!(error.code(), "no_match");
    assert!(error.message().contains("3 times"), "{}", error.message());
    assert!(
      error.message().contains("read the file first"),
      "{}",
      error.message()
    );
    assert_eq!(read_raw(root.path(), "notes.md"), "same same same\n");
  }

  #[test]
  fn edit_replaces_all_occurrences() {
    let root = TempDir::new("edit-all");
    write_raw(root.path(), "notes.md", "a a a\n");
    let outcome =
      edit_file(root.path(), "notes.md", "a", "b", true, "toolu_4").expect("replace all");
    assert_eq!(outcome.replacements, 3);
    assert_eq!(read_raw(root.path(), "notes.md"), "b b b\n");
  }

  #[test]
  fn edit_rejects_empty_old_string() {
    let root = TempDir::new("edit-empty");
    let error =
      edit_file(root.path(), "notes.md", "", "x", false, "toolu_5").expect_err("empty old string");
    assert_eq!(error.code(), "invalid_argument");
    assert!(!root.path().join("notes.md").exists());
  }

  #[test]
  fn edit_rejects_oversized_results() {
    let root = TempDir::new("edit-large");
    let base = "a".repeat(60 * 1024);
    let content = format!("{base}END\n");
    write_raw(root.path(), "notes.md", &content);
    let error = edit_file(
      root.path(),
      "notes.md",
      "END",
      &"b".repeat(10 * 1024),
      false,
      "toolu_6",
    )
    .expect_err("too large result");
    assert_eq!(error.code(), "too_large");
    assert_eq!(read_raw(root.path(), "notes.md"), content);
    let (previous, meta) = backup_files(root.path(), "notes.md");
    assert!(!previous.exists());
    assert!(!meta.exists());

    // 已有的超限文件也直接拒绝，不修改内容
    let huge = "x".repeat(70 * 1024);
    write_raw(root.path(), "big.md", &huge);
    let error =
      edit_file(root.path(), "big.md", "x", "y", false, "toolu_7").expect_err("source too large");
    assert_eq!(error.code(), "too_large");
    assert_eq!(read_raw(root.path(), "big.md").len(), huge.len());
  }

  #[test]
  fn edit_missing_file_returns_not_found() {
    let root = TempDir::new("edit-missing");
    let error =
      edit_file(root.path(), "notes.md", "a", "b", false, "toolu_8").expect_err("missing file");
    assert_eq!(error.code(), "not_found");
    assert!(!root.path().join("notes.md").exists());
  }

  #[test]
  fn edit_creates_missing_memory_template_implicitly() {
    let root = TempDir::new("edit-template");
    let outcome = edit_file(
      root.path(),
      USER_FILE,
      "# USER.md",
      "# 我的资料",
      false,
      "t1",
    )
    .expect("edit template");
    assert_eq!(outcome.replacements, 1);
    assert_eq!(
      read_raw(root.path(), USER_FILE),
      USER_TEMPLATE.replacen("# USER.md", "# 我的资料", 1)
    );
  }

  #[test]
  fn edit_normalizes_crlf() {
    let root = TempDir::new("edit-crlf");
    write_raw(root.path(), "notes.md", "line1\r\nline2\r\n");
    let outcome = edit_file(
      root.path(),
      "notes.md",
      "line1\r\nline2",
      "changed",
      false,
      "toolu_9",
    )
    .expect("crlf edit");
    assert_eq!(outcome.replacements, 1);
    assert_eq!(read_raw(root.path(), "notes.md"), "changed\n");
  }

  #[test]
  fn edit_without_changes_skips_backup() {
    let root = TempDir::new("edit-noop");
    write_raw(root.path(), "notes.md", "same\n");
    let outcome =
      edit_file(root.path(), "notes.md", "same", "same", false, "toolu_10").expect("noop");
    assert_eq!(outcome.replacements, 0);
    assert_eq!(outcome.backup_id, "");
    assert_eq!(read_raw(root.path(), "notes.md"), "same\n");
    let (previous, meta) = backup_files(root.path(), "notes.md");
    assert!(!previous.exists());
    assert!(!meta.exists());
    assert!(
      !backup_state(root.path(), "notes.md")
        .expect("state")
        .available
    );
  }

  #[test]
  fn create_rejects_reserved_names_and_non_markdown() {
    let root = TempDir::new("create-invalid");
    assert_eq!(
      create_file(root.path(), USER_FILE)
        .expect_err("reserved")
        .code(),
      "read_only"
    );
    assert_eq!(
      create_file(root.path(), MEMORY_FILE)
        .expect_err("reserved")
        .code(),
      "read_only"
    );
    assert_eq!(
      create_file(root.path(), "notes.txt")
        .expect_err("not markdown")
        .code(),
      "invalid_path"
    );
    assert_eq!(
      create_file(root.path(), "sub/notes.md")
        .expect_err("subdir")
        .code(),
      "invalid_path"
    );
    assert!(!root.path().join(USER_FILE).exists());
  }

  #[test]
  fn create_rename_and_delete_extra_files() {
    let root = TempDir::new("crud");
    let created = create_file(root.path(), "notes.md").expect("create");
    assert_eq!(created.entry.name, "notes.md");
    assert_eq!(created.entry.size, 0);
    assert!(!created.entry.is_memory);
    assert_eq!(created.hash, sha256_hex(b""));
    assert_eq!(read_raw(root.path(), "notes.md"), "");
    assert_eq!(
      create_file(root.path(), "notes.md")
        .expect_err("duplicate")
        .code(),
      "exists"
    );

    write_raw(root.path(), "notes.md", "content\n");
    let renamed = rename_file(root.path(), "notes.md", "renamed.md").expect("rename");
    assert_eq!(renamed.entry.name, "renamed.md");
    assert_eq!(read_raw(root.path(), "renamed.md"), "content\n");
    assert!(!root.path().join("notes.md").exists());

    create_file(root.path(), "other.md").expect("create other");
    assert_eq!(
      rename_file(root.path(), "renamed.md", "other.md")
        .expect_err("target exists")
        .code(),
      "exists"
    );
    assert_eq!(
      rename_file(root.path(), "renamed.md", USER_FILE)
        .expect_err("reserved target")
        .code(),
      "read_only"
    );
    assert_eq!(
      rename_file(root.path(), USER_FILE, "x.md")
        .expect_err("reserved source")
        .code(),
      "read_only"
    );

    delete_file(root.path(), "renamed.md").expect("delete");
    assert!(!root.path().join("renamed.md").exists());
    assert_eq!(
      delete_file(root.path(), "renamed.md")
        .expect_err("missing")
        .code(),
      "not_found"
    );
    assert_eq!(
      delete_file(root.path(), USER_FILE)
        .expect_err("reserved")
        .code(),
      "read_only"
    );
  }

  #[test]
  fn rename_and_delete_clear_backups() {
    let root = TempDir::new("crud-backup");
    create_file(root.path(), "notes.md").expect("create");
    write_file(root.path(), "notes.md", "alpha\n", None).expect("write");
    edit_file(root.path(), "notes.md", "alpha", "beta", false, "t1").expect("edit");
    let (previous, meta) = backup_files(root.path(), "notes.md");
    assert!(previous.exists() && meta.exists());

    rename_file(root.path(), "notes.md", "renamed.md").expect("rename");
    assert!(!previous.exists() && !meta.exists());
    let (renamed_previous, renamed_meta) = backup_files(root.path(), "renamed.md");
    assert!(!renamed_previous.exists() && !renamed_meta.exists());

    edit_file(root.path(), "renamed.md", "beta", "gamma", false, "t2").expect("edit again");
    let (previous, meta) = backup_files(root.path(), "renamed.md");
    assert!(previous.exists() && meta.exists());
    delete_file(root.path(), "renamed.md").expect("delete");
    assert!(!previous.exists() && !meta.exists());
  }

  #[test]
  fn create_rejects_after_two_hundred_files() {
    let root = TempDir::new("limit");
    for index in 0..200 {
      create_file(root.path(), &format!("file-{index:03}.md")).expect("create");
    }
    assert_eq!(count_regular_files(root.path()).expect("count"), 200);
    let error = create_file(root.path(), "one-more.md").expect_err("limit reached");
    assert_eq!(error.code(), "too_many_files");
    assert_eq!(
      rename_file(root.path(), "file-000.md", "renamed.md")
        .expect_err("rename limit")
        .code(),
      "too_many_files"
    );
  }

  #[test]
  fn backup_and_undo_restore_previous_content() {
    let root = TempDir::new("undo");
    write_raw(root.path(), "notes.md", "first\n");
    let edited = edit_file(
      root.path(),
      "notes.md",
      "first",
      "second",
      false,
      "toolu_11",
    )
    .expect("edit");

    let state = backup_state(root.path(), "notes.md").expect("state");
    assert!(state.available);
    assert_eq!(state.backup_id.as_deref(), Some(edited.backup_id.as_str()));
    assert_eq!(state.edited_hash.as_deref(), Some(edited.hash.as_str()));
    assert!(state.edited_at.unwrap_or(0) > 0);
    let (previous, _) = backup_files(root.path(), "notes.md");
    assert_eq!(fs::read_to_string(&previous).expect("previous"), "first\n");

    let restored = undo_edit(root.path(), "notes.md").expect("undo");
    assert_eq!(read_raw(root.path(), "notes.md"), "first\n");
    assert_eq!(restored.hash, sha256_hex(b"first\n"));
    assert!(
      !backup_state(root.path(), "notes.md")
        .expect("state")
        .available
    );
    let (previous, meta) = backup_files(root.path(), "notes.md");
    assert!(
      !previous.exists() && !meta.exists(),
      "undo must delete both backup files"
    );
    assert_eq!(
      undo_edit(root.path(), "notes.md")
        .expect_err("no backup")
        .code(),
      "no_backup"
    );
  }

  #[test]
  fn second_edit_overwrites_backup() {
    let root = TempDir::new("undo-twice");
    write_raw(root.path(), "notes.md", "v1\n");
    edit_file(root.path(), "notes.md", "v1", "v2", false, "t1").expect("first");
    edit_file(root.path(), "notes.md", "v2", "v3", false, "t2").expect("second");
    undo_edit(root.path(), "notes.md").expect("undo");
    assert_eq!(read_raw(root.path(), "notes.md"), "v2\n");
    assert_eq!(
      undo_edit(root.path(), "notes.md")
        .expect_err("only the last edit is undoable")
        .code(),
      "no_backup"
    );
  }

  #[test]
  fn backup_goes_stale_after_external_change() {
    let root = TempDir::new("undo-stale");
    write_raw(root.path(), "notes.md", "v1\n");
    edit_file(root.path(), "notes.md", "v1", "v2", false, "t1").expect("edit");
    write_raw(root.path(), "notes.md", "external\n");
    assert!(
      !backup_state(root.path(), "notes.md")
        .expect("state")
        .available
    );
    assert_eq!(
      undo_edit(root.path(), "notes.md")
        .expect_err("stale")
        .code(),
      "backup_stale"
    );
    assert_eq!(read_raw(root.path(), "notes.md"), "external\n");
  }

  #[test]
  fn user_write_checks_hash_and_clears_backup() {
    let root = TempDir::new("write");
    write_raw(root.path(), "notes.md", "v1\n");
    let edited = edit_file(root.path(), "notes.md", "v1", "v2", false, "t1").expect("edit");

    let conflict =
      write_file(root.path(), "notes.md", "v3\n", Some("deadbeef")).expect_err("hash mismatch");
    assert_eq!(conflict.code(), "conflict");
    assert_eq!(read_raw(root.path(), "notes.md"), "v2\n");

    let written = write_file(root.path(), "notes.md", "v3\r\n", Some(&edited.hash)).expect("write");
    assert_eq!(written.hash, sha256_hex(b"v3\n"));
    assert_eq!(read_raw(root.path(), "notes.md"), "v3\n");
    let (previous, meta) = backup_files(root.path(), "notes.md");
    assert!(!previous.exists() && !meta.exists());
    assert!(
      !backup_state(root.path(), "notes.md")
        .expect("state")
        .available
    );
  }

  #[test]
  fn write_validates_size_and_existence() {
    let root = TempDir::new("write-rules");
    assert_eq!(
      write_file(root.path(), "missing.md", "x", None)
        .expect_err("missing extra file")
        .code(),
      "not_found"
    );

    let too_large = "x".repeat(MEMORY_FILE_MAX_BYTES as usize + 1);
    assert_eq!(
      write_file(root.path(), USER_FILE, &too_large, None)
        .expect_err("too large")
        .code(),
      "too_large"
    );
    assert!(!root.path().join(USER_FILE).exists());

    // 两份记忆文件可以由编辑器重新创建
    let created = write_file(root.path(), USER_FILE, "hello\n", None).expect("recreate");
    assert!(created.entry.is_memory);
    assert_eq!(read_raw(root.path(), USER_FILE), "hello\n");
    let normalized =
      write_file(root.path(), USER_FILE, "hello\r\nworld\r\n", None).expect("normalize on write");
    assert_eq!(normalized.hash, sha256_hex(b"hello\nworld\n"));
    assert_eq!(read_raw(root.path(), USER_FILE), "hello\nworld\n");
  }

  #[test]
  fn backup_state_is_unavailable_without_backup() {
    let root = TempDir::new("backup-none");
    write_raw(root.path(), "notes.md", "content\n");
    let state = backup_state(root.path(), "notes.md").expect("state");
    assert!(!state.available);
    assert!(state.backup_id.is_none());
    assert!(state.edited_at.is_none());
    assert!(state.edited_hash.is_none());
    assert!(
      !backup_state(root.path(), "missing.md")
        .expect("missing")
        .available
    );
  }

  #[test]
  fn atomic_write_leaves_no_temp_files() {
    let root = TempDir::new("atomic");
    let created = create_file(root.path(), "notes.md").expect("create");
    write_file(root.path(), "notes.md", "content\n", Some(&created.hash)).expect("write");
    edit_file(root.path(), "notes.md", "content", "edited", false, "t1").expect("edit");
    undo_edit(root.path(), "notes.md").expect("undo");
    assert_no_temp_files(root.path());
    assert_no_temp_files(&root.path().join(BACKUP_DIR));
  }

  #[cfg(windows)]
  #[test]
  fn failed_write_keeps_original() {
    let root = TempDir::new("failed-write");
    ensure_root(root.path()).expect("root");
    let target = root.path().join("notes.md");
    fs::write(&target, "original\n").expect("seed");
    let mut permissions = fs::metadata(&target).expect("metadata").permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions).expect("mark read-only");

    let result = write_file(root.path(), "notes.md", "replacement\n", None);

    let mut permissions = fs::metadata(&target).expect("metadata").permissions();
    permissions.set_readonly(false);
    let _ = fs::set_permissions(&target, permissions);

    let error = result.expect_err("write should fail on a read-only file");
    assert!(matches!(error.code(), "permission" | "io"), "{error:?}");
    assert_eq!(read_raw(root.path(), "notes.md"), "original\n");
    assert_no_temp_files(root.path());
  }

  #[cfg(unix)]
  #[test]
  fn failed_write_keeps_original() {
    use std::os::unix::fs::PermissionsExt;

    let root = TempDir::new("failed-write");
    ensure_root(root.path()).expect("root");
    let target = root.path().join("notes.md");
    fs::write(&target, "original\n").expect("seed");
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o555)).expect("chmod");

    let result = write_file(root.path(), "notes.md", "replacement\n", None);

    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o755)).expect("chmod back");
    assert!(
      result.is_err(),
      "write should fail in a read-only directory"
    );
    assert_eq!(read_raw(root.path(), "notes.md"), "original\n");
    assert_no_temp_files(root.path());
  }

  #[test]
  fn list_filters_and_orders_entries() {
    let root = TempDir::new("list");
    ensure_root(root.path()).expect("root");
    write_raw(root.path(), USER_FILE, "user\n");
    write_raw(root.path(), MEMORY_FILE, "memory\n");
    write_raw(root.path(), "notes.md", "notes\n");
    write_raw(root.path(), "B.md", "b\n");
    write_raw(root.path(), "a.md", "a\n");
    fs::create_dir(root.path().join("sub")).expect("subdir");
    write_raw(root.path(), ".hidden.md", "hidden\n");

    let list = list_entries(root.path()).expect("list");
    let names: Vec<&str> = list
      .entries
      .iter()
      .map(|entry| entry.name.as_str())
      .collect();
    assert_eq!(names, ["USER.md", "MEMORY.md", "a.md", "B.md", "notes.md"]);
    assert!(list.entries[0].is_memory);
    assert!(list.entries[1].is_memory);
    assert!(!list.entries[2].is_memory);
    assert_eq!(list.entries[0].size, 5);
    assert!(!list.truncated);
  }

  #[test]
  fn list_truncates_after_two_hundred_entries() {
    let root = TempDir::new("list-limit");
    ensure_root(root.path()).expect("root");
    write_raw(root.path(), USER_FILE, "user\n");
    write_raw(root.path(), MEMORY_FILE, "memory\n");
    for index in 0..205 {
      write_raw(root.path(), &format!("file-{index:03}.md"), "x");
    }
    let list = list_entries(root.path()).expect("list");
    assert_eq!(list.entries.len(), MEMORY_DIR_MAX_FILES);
    assert!(list.truncated);
    assert_eq!(list.entries[0].name, USER_FILE);
    assert_eq!(list.entries[1].name, MEMORY_FILE);
    assert_eq!(list.entries[199].name, "file-197.md");
  }

  #[test]
  fn rejects_directories() {
    let root = TempDir::new("not-file");
    fs::create_dir(root.path().join("folder.md")).expect("directory");
    assert_eq!(
      read_memory(root.path(), "folder.md", None, None)
        .expect_err("read dir")
        .code(),
      "not_file"
    );
    assert_eq!(
      edit_file(root.path(), "folder.md", "a", "b", false, "t")
        .expect_err("edit dir")
        .code(),
      "not_file"
    );
    assert_eq!(
      delete_file(root.path(), "folder.md")
        .expect_err("delete dir")
        .code(),
      "not_file"
    );
    assert_eq!(
      write_file(root.path(), "folder.md", "x", None)
        .expect_err("write dir")
        .code(),
      "not_file"
    );
    assert_eq!(
      create_file(root.path(), "folder.md")
        .expect_err("create dir")
        .code(),
      "exists"
    );
  }

  #[test]
  fn paths_report_root_and_memory_files() {
    let root = TempDir::new("paths");
    let paths = paths_info(root.path()).expect("paths");
    assert_eq!(paths.root, root.path().to_string_lossy().to_string());
    assert_eq!(paths.platform, PLATFORM);
    assert_eq!(paths.files.len(), 2);
    assert_eq!(paths.files[0].name, USER_FILE);
    assert!(paths.files[0].is_memory);
    assert!(paths.files[0].path.ends_with(USER_FILE));
    assert_eq!(paths.files[1].name, MEMORY_FILE);
    assert!(root.path().join(BACKUP_DIR).is_dir());
  }
}
