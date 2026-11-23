# Vendored Tauri mobile plugins

These directories are unmodified copies of the official Tauri v2 plugin crates:

- **tauri-plugin-fs 2.7.1**
- **tauri-plugin-dialog 2.8.4**
- **tauri-plugin-opener 2.7.3**
- **tauri-plugin-clipboard-manager 2.5.0**

They are referenced by **src-tauri/Cargo.toml** through **patch.crates-io**.

## Why they are vendored

Tauri plugin build scripts copy the **tauri-api** Android project into the plugin's own native project (for example **android/.tauri**). When the crate comes from a read-only or externally sandboxed Cargo registry, that copy fails with **access denied**, even though the app project itself is writable. Local path copies make the Android project writable and keep **pnpm tauri android build** reproducible in such environments.

The JavaScript packages still come from npm at the matching 2.x versions. Do not edit these Rust files directly.

## Updating

1. Update the npm packages with **pnpm add**.
2. Copy the new crate sources from the Cargo registry into these directories, keeping the directory names.
3. Update the versions above and the **patch.crates-io** paths in **src-tauri/Cargo.toml** if the crate version changed.
4. Run **pnpm tauri build --no-bundle** and **pnpm tauri android build --debug --apk** to verify.

All four crates are licensed **Apache-2.0 OR MIT**; their license files and headers are preserved.
