use hyper::HeaderMap;
use url::Url;

pub const INTERNAL_ADMIN_ORIGINATOR: &str = "metanet-client.wallet.internal";
pub const LEGACY_ADMIN_ORIGINATOR: &str = "admin.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginError {
    Required,
    Invalid,
    Reserved,
    TooLong,
}

fn is_reserved_originator(originator: &str) -> bool {
    let normalized = originator.trim().to_ascii_lowercase();
    normalized == INTERNAL_ADMIN_ORIGINATOR || normalized == LEGACY_ADMIN_ORIGINATOR
}

fn canonicalize_url(value: &str) -> Result<String, OriginError> {
    let url = Url::parse(value).map_err(|_| OriginError::Invalid)?;
    let host = url.host_str().ok_or(OriginError::Invalid)?;
    let mut result = host.to_ascii_lowercase();

    if result.contains(':') && !result.starts_with('[') {
        result = format!("[{}]", result);
    }

    if let Some(port) = url.port() {
        let default_port = match url.scheme() {
            "http" => Some(80),
            "https" => Some(443),
            _ => None,
        };

        if Some(port) != default_port {
            result.push(':');
            result.push_str(&port.to_string());
        }
    }

    validate_external_originator(&result)?;
    Ok(result)
}

pub fn validate_external_originator(originator: &str) -> Result<(), OriginError> {
    if originator.trim().is_empty() {
        return Err(OriginError::Required);
    }

    if originator.len() > 250 {
        return Err(OriginError::TooLong);
    }

    if is_reserved_originator(originator) {
        return Err(OriginError::Reserved);
    }

    Ok(())
}

pub fn parse_originator_value(value: &str) -> Result<String, OriginError> {
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{}", value)
    };
    canonicalize_url(&candidate)
}

pub fn parse_bridge_origin(headers: &HeaderMap) -> Result<String, OriginError> {
    if let Some(origin) = headers.get("origin") {
        let value = origin.to_str().map_err(|_| OriginError::Invalid)?;
        return canonicalize_url(value);
    }

    if let Some(originator) = headers.get("originator") {
        let value = originator.to_str().map_err(|_| OriginError::Invalid)?;
        return parse_originator_value(value);
    }

    Err(OriginError::Required)
}
