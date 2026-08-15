#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Standard library imports.
#[cfg(target_os = "macos")]
use std::ffi::{c_void, CStr};
use std::{
    convert::Infallible,
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

#[cfg(target_os = "macos")]
use objc::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc::runtime::Object;
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use std::os::raw::c_char;
#[cfg(target_os = "macos")]
const NS_UTF8_STRING_ENCODING: usize = 4;
#[cfg(target_os = "macos")]
const NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS: usize = 1 << 0;
#[cfg(target_os = "macos")]
const NS_APPLICATION_ACTIVATION_POLICY_REGULAR: isize = 0;

#[cfg(target_os = "macos")]
#[link(name = "AppKit", kind = "framework")]
extern "C" {}
#[cfg(target_os = "macos")]
#[link(name = "Foundation", kind = "framework")]
extern "C" {}

// Third-party imports.
use dashmap::DashMap;
use hyper::header::HeaderValue;
use hyper::{
    server::conn::Http,
    service::{make_service_fn, service_fn},
    Body, Request, Response, Server, StatusCode,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::{net::TcpListener, sync::oneshot};
use tokio_rustls::TlsAcceptor;
use url::Url;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::image::Image;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::tray::TrayIconBuilder;
use tauri::WindowEvent;
use tauri::{command, AppHandle, Manager};

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
struct TrayHolder {
    _icon: tauri::tray::TrayIcon,
}

mod binary_bridge;
mod origin;
mod priority;
mod tls;
mod wallet_bridge_ports;
use binary_bridge::BinaryBridgeState;
use priority::{elevate_current_thread_priority, elevate_process_priority};
use tls::ensure_localhost_tls;
use wallet_bridge_ports::{
    reserve_wallet_bridge_ports, WalletBridgeListeners, BRC100_WALLET_CONFLICT_MESSAGE,
};

// (no direct plugin imports; we call plugin initializers via fully-qualified paths)

const NATIVE_CRASH_REPORT_FILE: &str = "pending-native-crash.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingNativeCrashReport {
    kind: String,
    thread: String,
    file: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
}

fn native_crash_report_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let directory = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    Ok(directory.join(NATIVE_CRASH_REPORT_FILE))
}

fn install_native_crash_hook(app_handle: &AppHandle) {
    let Ok(report_path) = native_crash_report_path(app_handle) else {
        return;
    };
    let previous_hook = std::panic::take_hook();

    std::panic::set_hook(Box::new(move |panic_info| {
        let location = panic_info.location();
        let report = PendingNativeCrashReport {
            kind: "panic".into(),
            thread: std::thread::current()
                .name()
                .unwrap_or("unnamed")
                .to_string(),
            file: location.and_then(|item| {
                Path::new(item.file())
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_string)
            }),
            line: location.map(|item| item.line()),
            column: location.map(|item| item.column()),
        };

        if let Ok(json) = serde_json::to_vec(&report) {
            let _ = fs::write(&report_path, json);
        }
        previous_hook(panic_info);
    }));
}

#[tauri::command]
fn take_pending_crash_report(
    app_handle: AppHandle,
) -> Result<Option<PendingNativeCrashReport>, String> {
    let path = native_crash_report_path(&app_handle)?;
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    fs::remove_file(&path).map_err(|err| err.to_string())?;
    let report = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
    Ok(Some(report))
}

#[tauri::command]
async fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;

    println!("Saving file to: {}", path);

    // Create the file
    let mut file = File::create(&path).map_err(|e| e.to_string())?;

    // Write the contents
    file.write_all(&contents).map_err(|e| e.to_string())?;

    println!("File saved successfully");
    Ok(())
}

#[derive(Serialize)]
struct ProxyFetchResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

#[tauri::command]
async fn proxy_fetch_manifest(url: String) -> Result<ProxyFetchResponse, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("only https scheme is allowed".into());
    }
    let path = parsed.path().to_ascii_lowercase();
    if !(path.ends_with("/manifest.json") || path == "/manifest.json") {
        return Err("only manifest.json paths are allowed".into());
    }

    // Perform request
    let client = Client::builder()
        .user_agent("metanet-desktop/1.0 (+https://github.com/bsv-blockchain/metanet-desktop)")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "application/json, */*;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let mut headers_vec: Vec<(String, String)> = Vec::new();
    for (k, v) in resp.headers().iter() {
        headers_vec.push((k.as_str().to_string(), v.to_str().unwrap_or("").to_string()));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(ProxyFetchResponse {
        status,
        headers: headers_vec,
        body,
    })
}

static MAIN_WINDOW_NAME: &str = "main";

fn fit_main_window_to_work_area(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(current_size) = window.outer_size() else {
        return;
    };
    let work_area = monitor.work_area();

    if current_size.width <= work_area.size.width && current_size.height <= work_area.size.height {
        return;
    }

    let target_width = current_size
        .width
        .min(work_area.size.width.saturating_mul(9) / 10);
    let target_height = current_size
        .height
        .min(work_area.size.height.saturating_mul(9) / 10);
    let target_position = tauri::PhysicalPosition::new(
        work_area.position.x + ((work_area.size.width - target_width) / 2) as i32,
        work_area.position.y + ((work_area.size.height - target_height) / 2) as i32,
    );

    if let Err(err) = window.set_size(tauri::PhysicalSize::new(target_width, target_height)) {
        eprintln!("Unable to fit main window to monitor work area: {}", err);
        return;
    }
    if let Err(err) = window.set_position(target_position) {
        eprintln!("Unable to center fitted main window: {}", err);
    }
}

/// Payload sent from Rust to the frontend for each HTTP request.
#[derive(Serialize)]
struct HttpRequestEvent {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
    request_id: u64,
}

/// Expected payload sent back from the frontend.
#[derive(Deserialize, Debug)]
struct TsResponse {
    request_id: u64,
    status: u16,
    body: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct WalletQaPermissionDecision {
    kind: String,
    decision: String,
}

/// A type alias for our concurrent map of pending responses.
type PendingMap = DashMap<u64, oneshot::Sender<TsResponse>>;

#[derive(Default)]
struct WalletBridgeReadiness {
    accepts_requests: AtomicBool,
}

#[cfg(target_os = "macos")]
use std::sync::LazyLock;
/// -----
/// Tauri COMMANDS for focus management
/// -----

#[cfg(target_os = "macos")]
use std::sync::Mutex;

#[cfg(target_os = "macos")]
static PREV_BUNDLE_ID: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
#[cfg(target_os = "macos")]
static FOCUS_REQUEST_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn capture_frontmost_bundle_identifier() -> Option<String> {
    autoreleasepool(|| unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }

        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }

        let bundle_identifier: *mut Object = msg_send![app, bundleIdentifier];
        if bundle_identifier.is_null() {
            return None;
        }

        let cstr: *const c_char = msg_send![bundle_identifier, UTF8String];
        if cstr.is_null() {
            return None;
        }

        Some(CStr::from_ptr(cstr).to_string_lossy().into_owned())
    })
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn activate_application_by_bundle_id(bundle_id: &str) -> Result<(), String> {
    autoreleasepool(|| unsafe {
        let bytes = bundle_id.as_bytes();
        let ns_string: *mut Object = msg_send![class!(NSString), alloc];
        if ns_string.is_null() {
            return Err("Failed to allocate NSString".into());
        }

        let ns_string: *mut Object = msg_send![ns_string,
            initWithBytes: bytes.as_ptr() as *const c_void
            length: bytes.len()
            encoding: NS_UTF8_STRING_ENCODING
        ];
        if ns_string.is_null() {
            return Err("Failed to initialize NSString".into());
        }

        // Autorelease so the pool can clean it up safely.
        let _: *mut Object = msg_send![ns_string, autorelease];

        let running_apps: *mut Object = msg_send![class!(NSRunningApplication),

        runningApplicationsWithBundleIdentifier: ns_string
        ];
        if running_apps.is_null() {
            return Err("Failed to look up running applications for bundle identifier".into());
        }

        let count: usize = msg_send![running_apps, count];
        if count == 0 {
            return Err("No running application matches bundle identifier".into());
        }

        let running_app: *mut Object = msg_send![running_apps, objectAtIndex: 0];
        if running_app.is_null() {
            return Err("Failed to get running application from lookup results".into());
        }

        let success: bool = msg_send![running_app,
            activateWithOptions: NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS
        ];

        if success {
            Ok(())
        } else {
            Err("activateWithOptions returned false".into())
        }
    })
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn activate_current_application() -> Result<(), String> {
    autoreleasepool(|| unsafe {
        let ns_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        if ns_app.is_null() {
            return Err("Failed to get NSApplication sharedApplication".into());
        }

        let _: bool =
            msg_send![ns_app, setActivationPolicy: NS_APPLICATION_ACTIVATION_POLICY_REGULAR];
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];

        let running_app: *mut Object = msg_send![class!(NSRunningApplication), currentApplication];
        if !running_app.is_null() {
            let _: bool = msg_send![running_app,
                activateWithOptions: NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS
            ];
        }

        Ok(())
    })
}

fn apply_cors_headers(res: &mut Response<Body>) {
    let headers = res.headers_mut();
    headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    headers.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("*"),
    );
    headers.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("*"),
    );
    headers.insert(
        "Access-Control-Expose-Headers",
        HeaderValue::from_static("*"),
    );
    headers.insert(
        "Access-Control-Allow-Private-Network",
        HeaderValue::from_static("true"),
    );
}

fn json_bridge_response(status: StatusCode, body: serde_json::Value) -> Response<Body> {
    let mut res = Response::new(Body::from(body.to_string()));
    *res.status_mut() = status;
    apply_cors_headers(&mut res);
    res
}

fn pre_listener_bridge_response(path: &str) -> Response<Body> {
    match path {
        "/getVersion" => json_bridge_response(
            StatusCode::OK,
            serde_json::json!({ "version": "wallet-brc100-1.0.0" }),
        ),
        "/isAuthenticated" => json_bridge_response(
            StatusCode::OK,
            serde_json::json!({ "authenticated": false }),
        ),
        _ => json_bridge_response(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({
                "code": "WALLET_BRIDGE_NOT_READY",
                "message": "Peacock is starting or no wallet bridge listener is ready yet.",
                "retryable": true,
                "walletReady": false
            }),
        ),
    }
}

fn wallet_qa_enabled() -> bool {
    cfg!(debug_assertions)
        && ["USER_WALLET_QA", "METANET_WALLET_QA"].iter().any(|name| {
            env::var(name)
                .ok()
                .map(|value| {
                    let normalized = value.to_ascii_lowercase();
                    matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
                })
                .unwrap_or(false)
        })
}

fn validate_wallet_qa_decision(payload: &WalletQaPermissionDecision) -> Result<(), String> {
    if !matches!(
        payload.kind.as_str(),
        "basket" | "certificate" | "protocol" | "spending"
    ) {
        return Err(format!("Unsupported permission kind: {}", payload.kind));
    }

    if !matches!(payload.decision.as_str(), "grant" | "deny") {
        return Err(format!(
            "Unsupported permission decision: {}",
            payload.decision
        ));
    }

    Ok(())
}

async fn handle_wallet_qa_request(
    req: Request<Body>,
    path: &str,
    main_window: &WebviewWindow,
) -> Result<Response<Body>, Infallible> {
    if !wallet_qa_enabled() {
        return Ok(json_bridge_response(
            StatusCode::NOT_FOUND,
            serde_json::json!({
                "code": "WALLET_QA_DISABLED",
                "message": "Wallet QA routes are only available in debug builds when USER_WALLET_QA=1.",
                "retryable": false
            }),
        ));
    }

    if path != "/__wallet-qa/permission-decision" {
        return Ok(json_bridge_response(
            StatusCode::NOT_FOUND,
            serde_json::json!({
                "code": "WALLET_QA_UNKNOWN_PATH",
                "message": format!("Unknown wallet QA path: {}", path),
                "retryable": false
            }),
        ));
    }

    if req.method() != hyper::Method::POST {
        return Ok(json_bridge_response(
            StatusCode::METHOD_NOT_ALLOWED,
            serde_json::json!({
                "code": "WALLET_QA_METHOD_NOT_ALLOWED",
                "message": "Wallet QA permission decisions must use POST.",
                "retryable": false
            }),
        ));
    }

    let whole_body = match hyper::body::to_bytes(req.into_body()).await {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("Failed to read wallet QA request body: {:?}", err);
            return Ok(json_bridge_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "code": "WALLET_QA_INVALID_REQUEST",
                    "message": "Failed to read wallet QA request body.",
                    "retryable": false
                }),
            ));
        }
    };

    let payload = match serde_json::from_slice::<WalletQaPermissionDecision>(&whole_body) {
        Ok(payload) => payload,
        Err(err) => {
            return Ok(json_bridge_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "code": "WALLET_QA_INVALID_REQUEST",
                    "message": format!("Invalid wallet QA request body: {}", err),
                    "retryable": false
                }),
            ));
        }
    };

    if let Err(err) = validate_wallet_qa_decision(&payload) {
        return Ok(json_bridge_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({
                "code": "WALLET_QA_INVALID_DECISION",
                "message": err,
                "retryable": false
            }),
        ));
    }

    if let Err(err) = main_window.emit("wallet-qa-permission-decision", payload) {
        eprintln!("Failed to emit wallet QA permission decision: {:?}", err);
        return Ok(json_bridge_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({
                "code": "WALLET_QA_EMIT_FAILED",
                "message": "Peacock could not deliver the wallet QA decision to the frontend.",
                "retryable": true
            }),
        ));
    }

    Ok(json_bridge_response(
        StatusCode::ACCEPTED,
        serde_json::json!({
            "accepted": true
        }),
    ))
}

async fn handle_bridge_request(
    req: Request<Body>,
    pending_requests: Arc<PendingMap>,
    main_window: WebviewWindow,
    request_counter: Arc<AtomicU64>,
    bridge_readiness: Arc<WalletBridgeReadiness>,
) -> Result<Response<Body>, Infallible> {
    if req.method() == hyper::Method::OPTIONS {
        let mut res = Response::new(Body::empty());
        apply_cors_headers(&mut res);
        return Ok(res);
    }

    let path = req.uri().path().to_string();
    if path.starts_with("/__wallet-qa/") {
        return handle_wallet_qa_request(req, &path, &main_window).await;
    }

    if !bridge_readiness.accepts_requests.load(Ordering::Acquire) {
        return Ok(pre_listener_bridge_response(&path));
    }

    let request_id = request_counter.fetch_add(1, Ordering::Relaxed);
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect::<Vec<(String, String)>>();

    let whole_body = match hyper::body::to_bytes(req.into_body()).await {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!(
                "Failed to read HTTP request body for request {}: {:?}",
                request_id, err
            );
            let mut res = Response::new(Body::from("Failed to read request body"));
            *res.status_mut() = StatusCode::BAD_REQUEST;
            apply_cors_headers(&mut res);
            return Ok(res);
        }
    };

    let body_str = String::from_utf8_lossy(&whole_body).to_string();

    let (tx, rx) = oneshot::channel::<TsResponse>();
    pending_requests.insert(request_id, tx);

    let event_payload = HttpRequestEvent {
        method: method.to_string(),
        path: uri.to_string(),
        headers,
        body: body_str,
        request_id,
    };

    let event_json = match serde_json::to_string(&event_payload) {
        Ok(json) => json,
        Err(err) => {
            eprintln!(
                "Failed to serialize HTTP event for request {}: {:?}",
                request_id, err
            );
            pending_requests.remove(&request_id);
            let mut res = Response::new(Body::from("Internal Server Error"));
            *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            apply_cors_headers(&mut res);
            return Ok(res);
        }
    };

    if let Err(err) = main_window.emit("http-request", event_json) {
        eprintln!(
            "Failed to emit http-request event for request {}: {:?}",
            request_id, err
        );
        pending_requests.remove(&request_id);
        let mut res = Response::new(Body::from("Internal Server Error"));
        *res.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
        apply_cors_headers(&mut res);
        return Ok(res);
    }

    match rx.await {
        Ok(ts_response) => {
            let mut res = Response::new(Body::from(ts_response.body));
            *res.status_mut() = StatusCode::from_u16(ts_response.status).unwrap_or(StatusCode::OK);
            apply_cors_headers(&mut res);
            Ok(res)
        }
        Err(err) => {
            eprintln!(
                "Error awaiting frontend response for request {}: {:?}",
                request_id, err
            );
            Ok(json_bridge_response(
                StatusCode::GATEWAY_TIMEOUT,
                serde_json::json!({
                    "code": "WALLET_BRIDGE_RESPONSE_DROPPED",
                    "message": "Peacock stopped handling the wallet request before responding.",
                    "retryable": true
                }),
            ))
        }
    }
}

fn request_delayed_window_focus(app_handle: AppHandle, context: &'static str) {
    #[cfg(target_os = "macos")]
    let focus_generation = FOCUS_REQUEST_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || {
        for delay_ms in [80_u64, 220, 500] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            #[cfg(target_os = "macos")]
            if FOCUS_REQUEST_GENERATION.load(Ordering::SeqCst) != focus_generation {
                return;
            }

            if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_NAME) {
                #[cfg(target_os = "macos")]
                if let Err(err) = activate_current_application() {
                    eprintln!("{} delayed activate app error: {}", context, err);
                }
                if let Err(err) = window.unminimize() {
                    eprintln!("{} delayed unminimize error: {}", context, err);
                }
                if let Err(err) = window.show() {
                    eprintln!("{} delayed show error: {}", context, err);
                }
                if let Err(err) = window.set_focus() {
                    eprintln!("{} delayed set_focus error: {}", context, err);
                }
            }
        }
    });
}

fn raise_window_for_user(window: &WebviewWindow, context: &'static str) {
    if let Err(err) = window.unminimize() {
        eprintln!("{} unminimize error: {}", context, err);
    }
    if let Err(err) = window.show() {
        eprintln!("{} show error: {}", context, err);
    }

    #[cfg(target_os = "macos")]
    {
        if let Err(err) = window
            .app_handle()
            .set_activation_policy(tauri::ActivationPolicy::Regular)
        {
            eprintln!("{} set activation policy error: {}", context, err);
        }
        if let Err(err) = activate_current_application() {
            eprintln!("{} activate app error: {}", context, err);
        }
    }

    if let Err(err) = window.request_user_attention(Some(tauri::UserAttentionType::Informational)) {
        eprintln!("{} request_user_attention error: {}", context, err);
    }
    if let Err(err) = window.set_focus() {
        eprintln!("{} set_focus error: {}", context, err);
    }

    #[cfg(target_os = "macos")]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
    }

    request_delayed_window_focus(window.app_handle().clone(), context);
}

#[tauri::command]
fn is_focused(window: Window) -> bool {
    #[cfg(target_os = "macos")]
    {
        let app_identifier = window.app_handle().config().identifier.clone();
        if let Some(bundle_id) = capture_frontmost_bundle_identifier() {
            return bundle_id == app_identifier;
        }
    }

    match window.is_focused() {
        Ok(focused) => focused,
        Err(_) => false,
    }
}

#[tauri::command]
fn set_wallet_bridge_accepts_requests(
    state: tauri::State<'_, Arc<WalletBridgeReadiness>>,
    accepts: bool,
) {
    state.accepts_requests.store(accepts, Ordering::Release);
}

#[tauri::command]
fn request_focus(window: Window) {
    #[cfg(target_os = "macos")]
    {
        let app_identifier = window.app_handle().config().identifier.clone();
        // Make window visible first - critical for macOS
        if let Some(bundle_id) = capture_frontmost_bundle_identifier() {
            if !bundle_id.is_empty() && bundle_id != app_identifier {
                let mut prev = PREV_BUNDLE_ID.lock().unwrap();
                *prev = Some(bundle_id);
            }
        }
        // 1. "Unminimize" if necessary.
        if let Err(e) = window.unminimize() {
            eprintln!("(macOS) unminimize error: {}", e);
        }

        // Ensure the window is shown
        if let Err(e) = window.show() {
            eprintln!("(macOS) show error: {}", e);
        }

        if let Err(e) = window
            .app_handle()
            .set_activation_policy(tauri::ActivationPolicy::Regular)
        {
            eprintln!("(macOS) set activation policy error: {}", e);
        }
        if let Err(e) = activate_current_application() {
            eprintln!("(macOS) activate app error: {}", e);
        }

        // Request user attention (bounces Dock icon)
        if let Err(e) = window.request_user_attention(Some(tauri::UserAttentionType::Informational))
        {
            eprintln!("(macOS) request_user_attention error: {}", e);
        }

        // Focus the window - try multiple times with delays if needed
        for i in 0..3 {
            if let Ok(focused) = window.is_focused() {
                if focused {
                    break;
                }
            }

            if let Err(e) = window.set_focus() {
                eprintln!("(macOS) set_focus attempt {} error: {}", i, e);
            }

            // Small delay to allow macOS to process the focus request
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Show the window if it's hidden
        if let Err(e) = window.show() {
            eprintln!("(Windows) show error: {}", e);
        }
        // Unminimize the window (important!)
        if let Err(e) = window.unminimize() {
            eprintln!("(Windows) unminimize error: {}", e);
        }
        // Attempt to focus the window directly
        if let Err(e) = window.set_focus() {
            eprintln!("(Windows) set_focus error: {}", e);
        }
        // Temporarily set always-on-top to force focus
        if let Err(e) = window.set_always_on_top(true) {
            eprintln!("(Windows) set_always_on_top(true) error: {}", e);
        }
        // Remove always-on-top after focusing
        if let Err(e) = window.set_always_on_top(false) {
            eprintln!("(Windows) set_always_on_top(false) error: {}", e);
        }
    }

    #[cfg(target_os = "linux")]
    {
        // First, unminimize the window if it's minimized
        if let Err(e) = window.unminimize() {
            eprintln!("(Linux) unminimize error: {}", e);
        }

        // Show the window if it's hidden
        if let Err(e) = window.show() {
            eprintln!("(Linux) show error: {}", e);
        }

        // Attempt to focus the window
        if let Err(e) = window.set_focus() {
            eprintln!("(Linux) set_focus error: {}", e);
        }

        // On Linux, sometimes we need multiple focus attempts
        std::thread::sleep(std::time::Duration::from_millis(30));
        if let Ok(focused) = window.is_focused() {
            if !focused {
                if let Err(e) = window.set_focus() {
                    eprintln!("(Linux) set_focus retry error: {}", e);
                }
            }
        }
    }
}

/// Attempt to move the window out of the user's way so they can resume
/// other tasks. The exact behavior (switch/minimize) differs per platform.
#[tauri::command]
fn relinquish_focus(window: Window) {
    #[cfg(target_os = "linux")]
    {
        // Minimize the window instead of hiding
        if let Err(e) = window.minimize() {
            eprintln!("Linux minimize error: {}", e);
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Minimize the window instead of hiding
        if let Err(e) = window.minimize() {
            eprintln!("Windows minimize error: {}", e);
        }
    }

    #[cfg(target_os = "macos")]
    {
        FOCUS_REQUEST_GENERATION.fetch_add(1, Ordering::SeqCst);

        // Try to restore focus to previous app
        let prev_bundle_id = {
            let prev = PREV_BUNDLE_ID.lock().unwrap();
            prev.clone()
        };
        if let Some(bundle_id) = prev_bundle_id {
            if !bundle_id.is_empty() && bundle_id != window.app_handle().config().identifier {
                if let Err(e) = activate_application_by_bundle_id(&bundle_id) {
                    eprintln!("MacOS failed to re-activate previous app: {}", e);
                }
            }
        }
        _ = window.is_focused();
    }
}

#[command]
async fn download(app_handle: AppHandle, filename: String, content: Vec<u8>) -> Result<(), String> {
    let downloads_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;
    let path = PathBuf::from(downloads_dir);

    // Split the filename into stem and extension (if any)
    let path_obj = Path::new(&filename);
    let stem = path_obj
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = path_obj.extension().and_then(|e| e.to_str()).unwrap_or("");

    // Initial path attempt
    let mut final_path = path.clone();
    final_path.push(&filename);

    // Check if file exists and increment if necessary
    let mut counter = 1;
    while final_path.exists() {
        let new_filename = if ext.is_empty() {
            format!("{} ({}).{}", stem, counter, ext)
        } else {
            format!("{} ({}).{}", stem, counter, ext)
        };
        final_path = path.clone();
        final_path.push(new_filename);
        counter += 1;
    }

    fs::write(&final_path, content).map_err(|e| e.to_string())
}
fn main() {
    if let Err(err) = elevate_process_priority() {
        eprintln!("Unable to raise process priority: {}", err);
    }

    if let Err(err) = elevate_current_thread_priority() {
        eprintln!("Unable to raise main thread priority: {}", err);
    }

    tauri::Builder::default()
        // This must be the first plugin. Repeat launches focus the already-running
        // wallet instead of creating a second window that competes for bridge ports.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_NAME) {
                raise_window_for_user(&window, "Repeat application launch");
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // === Keep app alive in tray when the user clicks the "X" ===
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the close so the app keeps running in background.
                api.prevent_close();

                #[cfg(target_os = "macos")]
                {
                    // Minimize so Dock click can restore even without events (fallback listener also present).
                    let _ = window.minimize();
                }
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                {
                    // Hide from taskbar but keep process alive.
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            install_native_crash_hook(app.handle());

            let bridge_listeners = match reserve_wallet_bridge_ports() {
                Ok(listeners) => listeners,
                Err(error) => {
                    let (title, message) = if error.is_addr_in_use() {
                        (
                            "Another BRC100 wallet is already running",
                            BRC100_WALLET_CONFLICT_MESSAGE.to_string(),
                        )
                    } else {
                        (
                            "Wallet bridge unavailable",
                            format!("Peacock Wallet could not start its local wallet bridge: {error}"),
                        )
                    };
                    app.dialog()
                        .message(message)
                        .title(title)
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    std::process::exit(0);
                }
            };
            let WalletBridgeListeners {
                binary: binary_listener,
                json: json_listener,
                https: https_listener,
            } = bridge_listeners;

            // Extract the main window.
            let main_window = app.get_webview_window(MAIN_WINDOW_NAME).unwrap();
            fit_main_window_to_work_area(&main_window);

            // --- Re-open window when the Dock/taskbar icon is clicked ---
            {
                let app_handle = app.handle().clone();
                let app_handle_for_cb = app_handle.clone();
	                app_handle.listen("tauri://activate", move |_evt| {
	                    if let Some(w) = app_handle_for_cb.get_webview_window(MAIN_WINDOW_NAME) {
	                        raise_window_for_user(&w, "Dock activation");
	                    } else {
                        // Re-create the main window if it was actually closed/destroyed.
                        let _ = WebviewWindowBuilder::new(
                            &app_handle_for_cb,
                            MAIN_WINDOW_NAME,
                            WebviewUrl::default(),
                        )
                        .title("Peacock Wallet")
                        .build();
                    }
                });
            }

            // --- System tray with a single "Quit" action; left-click shows window ---
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let app_handle = app.handle().clone();

                let open_item = MenuItemBuilder::with_id("open", "Open").build(&app_handle).unwrap();
                let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(&app_handle).unwrap();
                let tray_menu = MenuBuilder::new(&app_handle)
                    .items(&[&open_item, &quit_item])
                    .build()
                    .unwrap();

                // Build the tray icon using the bundled PNG so it shows correctly on macOS.
                let icon_bytes: &[u8] = include_bytes!("../icons/32x32.png");
                let dyn_img = image::load_from_memory(icon_bytes).expect("failed to decode tray icon png");
                let rgba = dyn_img.to_rgba8();
                let (w, h) = rgba.dimensions();
                let tray_img = Image::new_owned(rgba.to_vec(), w, h);

                let tray = TrayIconBuilder::new()
                    .menu(&tray_menu)
                    .icon(tray_img)
                    .show_menu_on_left_click(true)
                    .tooltip("Peacock Wallet")
                    // Only tray menu item = Quit
                    .on_menu_event(|app, ev| {
                        match ev.id() {
	                            id if id == "open" => {
	                                if let Some(w) = app.get_webview_window(MAIN_WINDOW_NAME) {
	                                    raise_window_for_user(&w, "Tray open");
	                                }
	                            }
                            id if id == "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .build(&app_handle)
                    .expect("failed to build tray icon");

                // Keep the tray alive for the lifetime of the app.
                app.manage(TrayHolder { _icon: tray });
            }

            // Binary ("cicada") substrate bridge state. Registered before spawning
            // the server so the frontend can attach its Channel as soon as it boots.
            app.manage(Arc::new(BinaryBridgeState::new()));
            binary_bridge::spawn(&app.handle(), binary_listener);

            // Shared, concurrent map to store pending responses.
            let pending_requests: Arc<PendingMap> = Arc::new(DashMap::new());
            // Atomic counter to generate unique request IDs.
            let request_counter = Arc::new(AtomicU64::new(1));
            let bridge_readiness: Arc<WalletBridgeReadiness> =
                Arc::new(WalletBridgeReadiness::default());
            app.manage(bridge_readiness.clone());
            let tls_state = match ensure_localhost_tls(&app.handle()) {
                Ok(state) => {
                    println!("Prepared local TLS certificate for https://localhost:2121");
                    Some(Arc::new(state))
                }
                Err(err) => {
                    eprintln!("Failed to prepare TLS certificate: {}", err);
                    None
                }
            };

            {
                // Set up a listener for "ts-response" events coming from the frontend.
                // We attach the listener to the main window (not globally) for security.
                let pending_requests = pending_requests.clone();
                main_window.listen("ts-response", move |event| {
                    let payload = event.payload();
                    if payload.len() > 0 {
                        match serde_json::from_str::<TsResponse>(payload) {
                            Ok(ts_response) => {
                                if let Some((req_id, tx)) = pending_requests.remove(&ts_response.request_id) {
                                    if let Err(err) = tx.send(ts_response) {
                                        eprintln!(
                                            "Failed to send response via oneshot channel for request {}: {:?}",
                                            req_id, err
                                        );
                                    }
                                } else {
                                    eprintln!("Received ts-response for unknown request_id: {}", ts_response.request_id);
                                }
                            }
                            Err(err) => {
                                eprintln!("Failed to parse ts-response payload: {:?}", err);
                            }
                        }
                    } else {
                        eprintln!("ts-response event did not include a payload");
                    }
                });
            }

            // Spawn a separate thread to run our asynchronous HTTP server.
            let main_window_clone = main_window.clone();
            let pending_requests_clone = pending_requests.clone();
            let request_counter_clone = request_counter.clone();
            let bridge_readiness_clone = bridge_readiness.clone();
            std::thread::spawn(move || {
                if let Err(err) = elevate_current_thread_priority() {
                    eprintln!("Unable to raise HTTP runtime bootstrap thread priority: {}", err);
                }

                // Build a multi-threaded Tokio runtime.
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .on_thread_start(|| {
                        if let Err(err) = elevate_current_thread_priority() {
                            eprintln!(
                                "Unable to raise HTTP worker thread priority: {}",
                                err
                            );
                        }
                    })
                    .build()
                    .expect("Failed to create Tokio runtime");

                rt.block_on(async move {
                    let addr = json_listener
                        .local_addr()
                        .expect("reserved JSON bridge listener has no local address");
                    println!("HTTP server listening on http://{}", addr);

                    let builder = match Server::from_tcp(json_listener) {
                        Ok(builder) => builder,
                        Err(error) => {
                            eprintln!("Failed to use reserved JSON bridge listener: {}", error);
                            return;
                        }
                    };
                    let make_svc = make_service_fn(move |_conn| {
                        let pending_requests = pending_requests_clone.clone();
                        let main_window = main_window_clone.clone();
                        let request_counter = request_counter_clone.clone();
                        let bridge_readiness = bridge_readiness_clone.clone();

                        async move {
                            Ok::<_, Infallible>(service_fn(move |req: Request<Body>| {
                                handle_bridge_request(
                                    req,
                                    pending_requests.clone(),
                                    main_window.clone(),
                                    request_counter.clone(),
                                    bridge_readiness.clone(),
                                )
                            }))
                        }
                    });
                    if let Err(error) = builder.serve(make_svc).await {
                        eprintln!("Server error: {}", error);
                    }
                });
            });

            if let Some(tls_state) = tls_state {
                let main_window_clone = main_window.clone();
                let pending_requests_clone = pending_requests.clone();
                let request_counter_clone = request_counter.clone();
                let bridge_readiness_clone = bridge_readiness.clone();
                std::thread::spawn(move || {
                    if let Err(err) = elevate_current_thread_priority() {
                        eprintln!(
                            "Unable to raise HTTPS runtime bootstrap thread priority: {}",
                            err
                        );
                    }

                    let rt = tokio::runtime::Builder::new_multi_thread()
                        .enable_all()
                        .on_thread_start(|| {
                            if let Err(err) = elevate_current_thread_priority() {
                                eprintln!(
                                    "Unable to raise HTTPS worker thread priority: {}",
                                    err
                                );
                            }
                        })
                        .build()
                        .expect("Failed to create Tokio runtime");

                    rt.block_on(async move {
                        let addr = https_listener
                            .local_addr()
                            .expect("reserved HTTPS bridge listener has no local address");
                        println!("HTTPS server listening on https://{}", addr);

                        let listener = match TcpListener::from_std(https_listener) {
                            Ok(listener) => listener,
                            Err(err) => {
                                eprintln!("Failed to use reserved HTTPS bridge listener: {}", err);
                                return;
                            }
                        };

                        let tls_acceptor = TlsAcceptor::from(tls_state.server_config.clone());

                        loop {
                            match listener.accept().await {
                                Ok((stream, _addr)) => {
                                    let tls_acceptor = tls_acceptor.clone();
                                    let pending_requests = pending_requests_clone.clone();
                                    let main_window = main_window_clone.clone();
                                    let request_counter = request_counter_clone.clone();
                                    let bridge_readiness = bridge_readiness_clone.clone();

                                    tokio::spawn(async move {
                                        match tls_acceptor.accept(stream).await {
                                            Ok(tls_stream) => {
                                                let service = service_fn(move |req: Request<Body>| {
                                                    handle_bridge_request(
                                                        req,
                                                        pending_requests.clone(),
                                                        main_window.clone(),
                                                        request_counter.clone(),
                                                        bridge_readiness.clone(),
                                                    )
                                                });

                                                if let Err(err) = Http::new()
                                                    .serve_connection(tls_stream, service)
                                                    .await
                                                {
                                                    eprintln!("HTTPS connection error: {}", err);
                                                }
                                            }
                                            Err(err) => {
                                                eprintln!("TLS handshake error: {:?}", err);
                                            }
                                        }
                                    });
                                }
                                Err(err) => {
                                    eprintln!("HTTPS TCP accept error: {}", err);
                                }
                            }
                        }
                    });
                });
            } else {
                eprintln!("HTTPS server not started because TLS preparation failed.");
            }


        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        is_focused,
        set_wallet_bridge_accepts_requests,
        request_focus,
        relinquish_focus,
        download,
        save_file,
        proxy_fetch_manifest,
        take_pending_crash_report,
        binary_bridge::register_binary_handler,
        binary_bridge::clear_binary_handler,
        binary_bridge::respond_binary
    ])
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .run(tauri::generate_context!())
    .expect("Error while running Tauri application");
}
