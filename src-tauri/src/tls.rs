use std::{
    env, fs,
    io::BufReader,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

use rcgen::{Certificate, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, SanType};
use rustls::{Certificate as RustlsCertificate, PrivateKey, ServerConfig};
use tauri::{AppHandle, Manager};

const CERT_LABEL: &str = "User Wallet Localhost";
// Legacy labels we previously used; keep them so we don't keep re-adding the cert on macOS
const CERT_LABEL_ALIASES: &[&str] = &["Metanet Desktop Localhost", "Metanet Localhost"];
const CERT_FILE: &str = "metanet-localhost.pem";
const KEY_FILE: &str = "metanet-localhost-key.pem";
const CERT_DER_FILE: &str = "metanet-localhost.der";

pub struct LocalhostTls {
    pub server_config: Arc<ServerConfig>,
}

#[derive(Clone)]
struct CertPaths {
    cert_path: PathBuf,
    key_path: PathBuf,
    cert_der_path: PathBuf,
}

pub fn ensure_localhost_tls(app: &AppHandle) -> Result<LocalhostTls, String> {
    let mut cert_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    cert_dir.push("certificates");
    fs::create_dir_all(&cert_dir).map_err(|e| e.to_string())?;

    let cert_path = cert_dir.join(CERT_FILE);
    let key_path = cert_dir.join(KEY_FILE);
    let cert_der_path = cert_dir.join(CERT_DER_FILE);

    let paths = CertPaths {
        cert_path: cert_path.clone(),
        key_path: key_path.clone(),
        cert_der_path: cert_der_path.clone(),
    };

    let mut newly_created = false;
    if !cert_path.exists() || !key_path.exists() {
        generate_certificate(&paths)?;
        newly_created = true;
    }

    trust_certificate(&paths, newly_created)?;

    let server_config = load_rustls_config(&paths)?;

    Ok(LocalhostTls { server_config })
}

fn generate_certificate(paths: &CertPaths) -> Result<(), String> {
    let mut params = CertificateParams::new(vec!["localhost".to_string()]);
    params.subject_alt_names = vec![
        SanType::DnsName("localhost".into()),
        SanType::IpAddress(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
        SanType::IpAddress(IpAddr::V6(Ipv6Addr::LOCALHOST)),
    ];
    params.alg = &rcgen::PKCS_ECDSA_P256_SHA256;
    params.is_ca = IsCa::ExplicitNoCa;

    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, CERT_LABEL);
    params.distinguished_name = distinguished_name;

    let key_pair = KeyPair::generate(&rcgen::PKCS_ECDSA_P256_SHA256)
        .map_err(|e| format!("failed to generate keypair: {e}"))?;
    params.key_pair = Some(key_pair);

    let cert = Certificate::from_params(params)
        .map_err(|e| format!("failed to build certificate params: {e}"))?;

    let cert_pem = cert
        .serialize_pem()
        .map_err(|e| format!("failed to serialize certificate pem: {e}"))?;
    let key_pem = cert.serialize_private_key_pem();
    let cert_der = cert
        .serialize_der()
        .map_err(|e| format!("failed to serialize certificate der: {e}"))?;

    fs::write(&paths.cert_path, cert_pem)
        .map_err(|e| format!("failed to write certificate: {e}"))?;
    fs::write(&paths.key_path, key_pem).map_err(|e| format!("failed to write private key: {e}"))?;
    fs::write(&paths.cert_der_path, cert_der)
        .map_err(|e| format!("failed to write certificate der: {e}"))?;

    Ok(())
}

fn load_rustls_config(paths: &CertPaths) -> Result<Arc<ServerConfig>, String> {
    let cert_file =
        fs::File::open(&paths.cert_path).map_err(|e| format!("failed to open certificate: {e}"))?;
    let mut cert_reader = BufReader::new(cert_file);
    let cert_chain = rustls_pemfile::certs(&mut cert_reader)
        .map_err(|e| format!("failed to parse certificate: {e}"))?
        .into_iter()
        .map(RustlsCertificate)
        .collect::<Vec<_>>();

    if cert_chain.is_empty() {
        return Err("parsed certificate chain is empty".into());
    }

    let key_file =
        fs::File::open(&paths.key_path).map_err(|e| format!("failed to open private key: {e}"))?;
    let mut key_reader = BufReader::new(key_file);
    let mut keys = rustls_pemfile::pkcs8_private_keys(&mut key_reader)
        .map_err(|e| format!("failed to parse private key: {e}"))?;

    if keys.is_empty() {
        let key_file = fs::File::open(&paths.key_path)
            .map_err(|e| format!("failed to reopen key for RSA parsing: {e}"))?;
        keys = rustls_pemfile::rsa_private_keys(&mut BufReader::new(key_file))
            .map_err(|e| format!("failed to parse rsa private key: {e}"))?;
    }

    let key_bytes = keys
        .into_iter()
        .next()
        .ok_or_else(|| "no private key found".to_string())?;
    let key = PrivateKey(key_bytes);

    let config = ServerConfig::builder()
        .with_safe_defaults()
        .with_no_client_auth()
        .with_single_cert(cert_chain, key)
        .map_err(|e| format!("failed to build rustls config: {e}"))?;

    Ok(Arc::new(config))
}

fn trust_certificate(paths: &CertPaths, newly_created: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        trust_on_macos(&paths.cert_path, newly_created)?;
    }

    #[cfg(target_os = "windows")]
    {
        trust_on_windows(&paths.cert_der_path, newly_created)?;
    }

    #[cfg(target_os = "linux")]
    {
        trust_on_linux(&paths.cert_path, newly_created)?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn trust_on_macos(cert_path: &Path, newly_created: bool) -> Result<(), String> {
    if !newly_created {
        // If any known label is already trusted, skip re-adding (avoids repeated prompts)
        for label in std::iter::once(CERT_LABEL).chain(CERT_LABEL_ALIASES.iter().copied()) {
            if let Ok(status) = Command::new("security")
                .arg("find-certificate")
                .arg("-c")
                .arg(label)
                .status()
            {
                if status.success() {
                    return Ok(());
                }
            }
        }
    }

    let keychain = env::var("HOME")
        .map(PathBuf::from)
        .map(|mut path| {
            path.push("Library/Keychains/login.keychain-db");
            path
        })
        .map_err(|e| format!("failed to resolve keychain path: {e}"))?;

    let status = Command::new("security")
        .arg("add-trusted-cert")
        .arg("-d")
        .arg("-r")
        .arg("trustRoot")
        .arg("-k")
        .arg(&keychain)
        .arg(cert_path)
        .status();

    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => {
            eprintln!(
                "failed to add certificate to macOS keychain (code {}), continuing",
                status
            );
            Ok(())
        }
        Err(e) => {
            eprintln!("failed to execute security tool: {e}");
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
fn trust_on_windows(cert_der: &Path, _newly_created: bool) -> Result<(), String> {
    // Use the current-user root store so trust installation does not require
    // elevation. Retry on every start to repair installs where the old
    // machine-store command failed and then never retried.
    let status = Command::new("certutil")
        .arg("-user")
        .arg("-addstore")
        .arg("-f")
        .arg("Root")
        .arg(cert_der)
        .status();

    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => {
            eprintln!(
                "failed to add certificate to Windows store (code {}), continuing",
                status
            );
            Ok(())
        }
        Err(e) => {
            eprintln!("failed to execute certutil: {e}");
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
fn trust_on_linux(cert_path: &Path, newly_created: bool) -> Result<(), String> {
    let home = env::var("HOME").map_err(|e| format!("failed to resolve HOME: {e}"))?;
    let mut local_store = PathBuf::from(&home);
    local_store.push(".local/share/ca-certificates");

    if let Err(e) = fs::create_dir_all(&local_store) {
        eprintln!("failed to prepare local CA directory: {e}");
    } else {
        let target = local_store.join("metanet-localhost.crt");
        if newly_created || !target.exists() {
            if let Err(e) = fs::copy(cert_path, &target) {
                eprintln!("failed to copy certificate into local CA store: {e}");
            }
        }
    }

    // Attempt to update the user's trust store with p11-kit trust tool if available.
    if command_exists("trust") {
        let store_arg = format!("--store={}/.local/share/ca-certificates", home);
        let status = Command::new("trust")
            .arg("anchor")
            .arg(store_arg)
            .arg(cert_path)
            .status();
        if let Err(e) = status {
            eprintln!("failed to execute trust tool: {e}");
        }
    }

    trust_chrome_on_linux(cert_path)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn trust_chrome_on_linux(cert_path: &Path) -> Result<(), String> {
    let home = env::var("HOME").map_err(|e| format!("failed to resolve HOME: {e}"))?;
    let mut nss_dir = PathBuf::from(&home);
    nss_dir.push(".pki/nssdb");

    if !nss_dir.exists() {
        // Nothing to do if NSS database is missing.
        return Ok(());
    }

    if !command_exists("certutil") {
        eprintln!("certutil not found; cannot add certificate to Chrome NSS store");
        return Ok(());
    }

    let db_path = format!("sql:{}", nss_dir.to_string_lossy());
    let label = CERT_LABEL;

    // Remove any existing certificate with the same label.
    let _ = Command::new("certutil")
        .arg("-d")
        .arg(&db_path)
        .arg("-D")
        .arg("-n")
        .arg(label)
        .status();

    let status = Command::new("certutil")
        .arg("-d")
        .arg(&db_path)
        .arg("-A")
        .arg("-t")
        .arg("TCP,TCP,TC")
        .arg("-n")
        .arg(label)
        .arg("-i")
        .arg(cert_path)
        .status();

    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => {
            eprintln!(
                "failed to install certificate into Chrome NSS store (code {})",
                status
            );
            Ok(())
        }
        Err(e) => {
            eprintln!("failed to execute certutil: {e}");
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {} >/dev/null 2>&1", command))
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
