use std::{
    fmt, io,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener},
};

pub const BRC100_WALLET_CONFLICT_MESSAGE: &str =
    "Only one BRC100 wallet (e.g. Metanet Desktop, BSV Desktop, Peacock Wallet, Yours Wallet) may be running on your computer at a time.";

const BINARY_BRIDGE_PORT: u16 = 3301;
const JSON_BRIDGE_PORT: u16 = 3321;
const HTTPS_BRIDGE_PORT: u16 = 2121;

#[derive(Debug)]
pub struct WalletBridgeListeners {
    pub binary: TcpListener,
    pub json: TcpListener,
    pub https: TcpListener,
}

#[derive(Debug)]
pub struct BridgePortError {
    pub address: SocketAddr,
    pub source: io::Error,
}

impl BridgePortError {
    pub fn is_addr_in_use(&self) -> bool {
        self.source.kind() == io::ErrorKind::AddrInUse
    }
}

impl fmt::Display for BridgePortError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "could not reserve {}: {}",
            self.address, self.source
        )
    }
}

fn loopback(port: u16) -> SocketAddr {
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
}

fn bind_listener(address: SocketAddr) -> Result<TcpListener, BridgePortError> {
    let listener =
        TcpListener::bind(address).map_err(|source| BridgePortError { address, source })?;
    listener
        .set_nonblocking(true)
        .map_err(|source| BridgePortError { address, source })?;
    Ok(listener)
}

fn reserve_at(addresses: [SocketAddr; 3]) -> Result<WalletBridgeListeners, BridgePortError> {
    let binary = bind_listener(addresses[0])?;
    let json = bind_listener(addresses[1])?;
    let https = bind_listener(addresses[2])?;
    Ok(WalletBridgeListeners {
        binary,
        json,
        https,
    })
}

pub fn reserve_wallet_bridge_ports() -> Result<WalletBridgeListeners, BridgePortError> {
    reserve_at([
        loopback(BINARY_BRIDGE_PORT),
        loopback(JSON_BRIDGE_PORT),
        loopback(HTTPS_BRIDGE_PORT),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserves_all_bridge_listeners_on_loopback() {
        let ephemeral = loopback(0);
        let listeners = reserve_at([ephemeral, ephemeral, ephemeral]).unwrap();

        for listener in [listeners.binary, listeners.json, listeners.https] {
            assert!(listener.local_addr().unwrap().ip().is_loopback());
        }
    }

    #[test]
    fn identifies_a_competing_listener_without_leaking_partial_reservations() {
        let blocker = TcpListener::bind(loopback(0)).unwrap();
        let blocked_address = blocker.local_addr().unwrap();
        let error = reserve_at([blocked_address, loopback(0), loopback(0)]).unwrap_err();

        assert_eq!(error.address, blocked_address);
        assert!(error.is_addr_in_use());
    }

    #[test]
    fn conflict_message_names_the_shared_wallet_constraint() {
        assert_eq!(
            BRC100_WALLET_CONFLICT_MESSAGE,
            "Only one BRC100 wallet (e.g. Metanet Desktop, BSV Desktop, Peacock Wallet, Yours Wallet) may be running on your computer at a time."
        );
    }
}
