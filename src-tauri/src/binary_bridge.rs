// Binary ("cicada") substrate HTTP bridge on 127.0.0.1:3301.
//
// Protocol (matches @bsv/sdk HTTPWalletWire):
//   Request:  POST /{callName}  Content-Type: application/octet-stream
//             Origin: <originator>
//             body = params bytes (no framing)
//   Response: body = [errorByte(u8) | payload] framed by WalletWireProcessor in TS
//             HTTP status is always 200 for wallet-level responses; non-200 only
//             for transport-level problems (bad method, unknown call, etc.).
//
// The IPC frame we push into the Tauri Channel is:
//   [u64 request_id LE | u8 callCode | u8 originLen | origin utf8 | payload]
// Bytes [8..] are precisely the wire format expected by WalletWireProcessor.

use std::{
    convert::Infallible,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use dashmap::DashMap;
use hyper::{
    header::{HeaderValue, CONTENT_TYPE},
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server, StatusCode,
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager,
};
use tokio::sync::oneshot;

use crate::origin::{parse_bridge_origin, OriginError};
use crate::priority::elevate_current_thread_priority;

type Pending = DashMap<u64, oneshot::Sender<(u16, Vec<u8>)>>;

pub struct BinaryBridgeState {
    pending: Arc<Pending>,
    counter: Arc<AtomicU64>,
    handler: Mutex<Option<Channel<InvokeResponseBody>>>,
}

impl BinaryBridgeState {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(DashMap::new()),
            counter: Arc::new(AtomicU64::new(1)),
            handler: Mutex::new(None),
        }
    }
}

fn apply_cors(res: &mut Response<Body>) {
    let h = res.headers_mut();
    h.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    h.insert("Access-Control-Allow-Headers", HeaderValue::from_static("*"));
    h.insert("Access-Control-Allow-Methods", HeaderValue::from_static("*"));
    h.insert("Access-Control-Expose-Headers", HeaderValue::from_static("*"));
    h.insert(
        "Access-Control-Allow-Private-Network",
        HeaderValue::from_static("true"),
    );
}

fn call_name_to_code(name: &str) -> Option<u8> {
    Some(match name {
        "createAction" => 1,
        "signAction" => 2,
        "abortAction" => 3,
        "listActions" => 4,
        "internalizeAction" => 5,
        "listOutputs" => 6,
        "relinquishOutput" => 7,
        "getPublicKey" => 8,
        "revealCounterpartyKeyLinkage" => 9,
        "revealSpecificKeyLinkage" => 10,
        "encrypt" => 11,
        "decrypt" => 12,
        "createHmac" => 13,
        "verifyHmac" => 14,
        "createSignature" => 15,
        "verifySignature" => 16,
        "acquireCertificate" => 17,
        "listCertificates" => 18,
        "proveCertificate" => 19,
        "relinquishCertificate" => 20,
        "discoverByIdentityKey" => 21,
        "discoverByAttributes" => 22,
        "isAuthenticated" => 23,
        "waitForAuthentication" => 24,
        "getHeight" => 25,
        "getHeaderForHeight" => 26,
        "getNetwork" => 27,
        "getVersion" => 28,
        _ => return None,
    })
}

fn plain(status: StatusCode, msg: &'static str) -> Response<Body> {
    let mut res = Response::new(Body::from(msg));
    *res.status_mut() = status;
    apply_cors(&mut res);
    res
}

fn origin_error_response(err: OriginError) -> Response<Body> {
    match err {
        OriginError::Required => plain(StatusCode::BAD_REQUEST, "Origin header is required"),
        OriginError::Invalid => plain(StatusCode::BAD_REQUEST, "Invalid Origin header"),
        OriginError::TooLong => plain(StatusCode::BAD_REQUEST, "Origin too long"),
        OriginError::Reserved => plain(
            StatusCode::FORBIDDEN,
            "Reserved wallet originator cannot be used by external applications",
        ),
    }
}

async fn handle(
    req: Request<Body>,
    state: Arc<BinaryBridgeState>,
) -> Result<Response<Body>, Infallible> {
    if req.method() == Method::OPTIONS {
        let mut res = Response::new(Body::empty());
        apply_cors(&mut res);
        return Ok(res);
    }

    if req.method() != Method::POST {
        return Ok(plain(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed"));
    }

    let call_name = req
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();

    let call_code = match call_name_to_code(&call_name) {
        Some(c) => c,
        None => return Ok(plain(StatusCode::NOT_FOUND, "Unknown call")),
    };

    let origin = match parse_bridge_origin(req.headers()) {
        Ok(origin) => origin,
        Err(err) => return Ok(origin_error_response(err)),
    };

    let body = match hyper::body::to_bytes(req.into_body()).await {
        Ok(b) => b,
        Err(_) => return Ok(plain(StatusCode::BAD_REQUEST, "Bad body")),
    };

    let request_id = state.counter.fetch_add(1, Ordering::Relaxed);
    let origin_bytes = origin.as_bytes();

    let mut frame = Vec::with_capacity(10 + origin_bytes.len() + body.len());
    frame.extend_from_slice(&request_id.to_le_bytes());
    frame.push(call_code);
    frame.push(origin_bytes.len() as u8);
    frame.extend_from_slice(origin_bytes);
    frame.extend_from_slice(&body);

    let (tx, rx) = oneshot::channel::<(u16, Vec<u8>)>();
    state.pending.insert(request_id, tx);

    let send_result = {
        let guard = state.handler.lock().unwrap();
        match guard.as_ref() {
            Some(ch) => ch.send(InvokeResponseBody::Raw(frame)),
            None => {
                state.pending.remove(&request_id);
                return Ok(plain(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Binary bridge not ready",
                ));
            }
        }
    };

    if let Err(err) = send_result {
        eprintln!("binary_bridge: channel send failed: {:?}", err);
        state.pending.remove(&request_id);
        return Ok(plain(StatusCode::INTERNAL_SERVER_ERROR, "IPC send failed"));
    }

    match rx.await {
        Ok((status, bytes)) => {
            let mut res = Response::new(Body::from(bytes));
            *res.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
            res.headers_mut().insert(
                CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            apply_cors(&mut res);
            Ok(res)
        }
        Err(_) => {
            state.pending.remove(&request_id);
            Ok(plain(StatusCode::BAD_GATEWAY, "Bridge sender dropped"))
        }
    }
}

pub fn spawn(app: &AppHandle) {
    let state = app.state::<Arc<BinaryBridgeState>>().inner().clone();
    std::thread::spawn(move || {
        if let Err(err) = elevate_current_thread_priority() {
            eprintln!(
                "binary_bridge: unable to raise bootstrap thread priority: {}",
                err
            );
        }

        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .on_thread_start(|| {
                let _ = elevate_current_thread_priority();
            })
            .build()
            .expect("binary_bridge: failed to build Tokio runtime");

        rt.block_on(async move {
            let addr: SocketAddr = "127.0.0.1:3301"
                .parse()
                .expect("binary_bridge: invalid socket address");
            println!("Binary HTTP server listening on http://{}", addr);

            let builder = match Server::try_bind(&addr) {
                Ok(b) => b,
                Err(err) => {
                    eprintln!("binary_bridge: failed to bind on 3301: {}", err);
                    return;
                }
            };

            let make_svc = make_service_fn(move |_conn| {
                let state = state.clone();
                async move {
                    Ok::<_, Infallible>(service_fn(move |req: Request<Body>| {
                        handle(req, state.clone())
                    }))
                }
            });

            let server = builder.tcp_nodelay(true).serve(make_svc);

            if let Err(err) = server.await {
                eprintln!("binary_bridge: server error: {}", err);
            }
        });
    });
}

#[tauri::command]
pub fn register_binary_handler(
    state: tauri::State<'_, Arc<BinaryBridgeState>>,
    channel: Channel<InvokeResponseBody>,
) {
    let mut guard = state.handler.lock().unwrap();
    *guard = Some(channel);
}

#[tauri::command]
pub fn clear_binary_handler(state: tauri::State<'_, Arc<BinaryBridgeState>>) {
    {
        let mut guard = state.handler.lock().unwrap();
        *guard = None;
    }
    state.pending.clear();
}

#[tauri::command]
pub fn respond_binary(
    state: tauri::State<'_, Arc<BinaryBridgeState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let headers = request.headers();
    let request_id: u64 = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "missing x-request-id".to_string())?
        .parse()
        .map_err(|_| "bad x-request-id".to_string())?;
    let status: u16 = headers
        .get("x-status")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(200);

    let body_bytes: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(v) => v.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("expected raw binary body".into());
        }
    };

    if let Some((_, tx)) = state.pending.remove(&request_id) {
        tx.send((status, body_bytes))
            .map_err(|_| "receiver dropped".to_string())?;
        Ok(())
    } else {
        Err(format!("unknown request_id {}", request_id))
    }
}
