use std::io::Write;
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle,
};
use tauri_plugin_dialog::DialogExt;

const MAX_ARCHIVE_BYTES: usize = 2 * 1024 * 1024 * 1024 - 1;

// Selection and writing live in one command: frontend code cannot substitute an
// arbitrary path. No wallet contents or selected paths are logged.
#[tauri::command]
pub async fn save_wallet_archive(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let encrypted = match request
        .headers()
        .get("x-wallet-archive-format")
        .and_then(|v| v.to_str().ok())
    {
        Some("brc39") => true,
        Some("brc38") => false,
        _ => return Err("Unsupported wallet archive format".into()),
    };
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) if !bytes.is_empty() && bytes.len() <= MAX_ARCHIVE_BYTES => {
            bytes.clone()
        }
        _ => return Err("Invalid wallet archive size".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (name, extension) = if encrypted { ("wallet.brc39", "brc39") } else { ("wallet.brc38.json", "json") };
        let Some(destination) = app.dialog().file()
            .set_title("Save wallet data")
            .set_file_name(name)
            .add_filter("Wallet data", &[extension])
            .blocking_save_file() else { return Ok(false) };
        let path = destination.into_path().map_err(|_| "Choose a local file destination".to_string())?;
        atomic_write(&path, &bytes).map_err(|_| "Could not save the wallet file. Check available space and folder access. The existing file was not replaced.".to_string())?;
        Ok(true)
    }).await.map_err(|_| "Wallet file save was interrupted".to_string())?
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing parent"))?;
    let mut file = tempfile::Builder::new()
        .prefix(".peacock-wallet-")
        .tempfile_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    // NamedTempFile uses private permissions and atomically replaces the chosen
    // destination only after the complete file is durable.
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_complete_binary_and_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wallet.brc39");
        atomic_write(&path, b"previous").unwrap();
        atomic_write(&path, &[0, 255, 87, 68, 65, 84]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), vec![0, 255, 87, 68, 65, 84]);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn invalid_destination_does_not_modify_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wallet.brc39");
        atomic_write(&path, b"keep").unwrap();
        assert!(atomic_write(&path.join("invalid"), b"replacement").is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"keep");
    }
}
