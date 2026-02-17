//! Platform-specific data directory paths.
//!
//! Mirrors python/shared/paths.py:
//!   Windows: %APPDATA%/voice-mirror-electron/data
//!   macOS:   ~/Library/Application Support/voice-mirror-electron/data
//!   Linux:   $XDG_CONFIG_HOME/voice-mirror-electron/data (default ~/.config)

use std::path::PathBuf;

/// Get the Voice Mirror data directory (cross-platform).
pub fn get_data_dir() -> PathBuf {
    get_config_base()
        .join("voice-mirror-electron")
        .join("data")
}

/// Get the platform-appropriate base config directory.
fn get_config_base() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        // %APPDATA% (typically C:\Users\<user>\AppData\Roaming)
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata);
        }
        dirs::config_dir().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("AppData")
                .join("Roaming")
        })
    }

    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Linux and other Unix: respect XDG_CONFIG_HOME, default ~/.config
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            return PathBuf::from(xdg);
        }
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".config")
    }
}
