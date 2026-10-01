#!/usr/bin/env python3
"""Local HTTPS and CONNECT fixture. No wallet, credentials, or external traffic."""
import http.server
import os
import pathlib
import select
import socket
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading


class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"fixture healthy\n")

    def log_message(self, *_args):
        pass


class Proxy(socketserver.StreamRequestHandler):
    connections = 0

    def handle(self):
        # Only tunnel the fixture authority to our loopback TLS server.
        request = self.rfile.readline().split()
        if (len(request) != 3 or request[0] != b"CONNECT"
                or request[1] not in (b"peacock-proxy.invalid:443", b"peacock-proxy.invalid")
                or request[2] not in (b"HTTP/1.0", b"HTTP/1.1")):
            print("Rejected fixture CONNECT request:", request, flush=True)
            return
        while self.rfile.readline() not in (b"\r\n", b""):
            pass
        with socket.create_connection(https.server_address, timeout=10) as upstream:
            Proxy.connections += 1
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            self.wfile.flush()
            peers = (self.connection, upstream)
            while True:
                ready, _, _ = select.select(peers, [], [], 10)
                if not ready:
                    return
                for peer in ready:
                    data = peer.recv(65536)
                    if not data:
                        return
                    peers[1 if peer is peers[0] else 0].sendall(data)


with tempfile.TemporaryDirectory(prefix="peacock-proxy-") as temporary:
    directory = pathlib.Path(temporary)
    certificate = directory / "fixture.pem"
    key = directory / "fixture.key"
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=peacock-proxy.invalid", "-addext", "subjectAltName=DNS:peacock-proxy.invalid",
        "-keyout", str(key), "-out", str(certificate),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    https = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Health)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    https.socket = context.wrap_socket(https.socket, server_side=True)
    proxy = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Proxy)
    proxy.daemon_threads = True
    for server in (https, proxy):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    proxy_url = f"http://127.0.0.1:{proxy.server_address[1]}"
    environment = {key: value for key, value in os.environ.items() if "proxy" not in key.lower()}
    environment.update(https_proxy=proxy_url, HTTPS_PROXY=proxy_url, no_proxy="", NO_PROXY="")
    environment.pop("APPDIR", None)
    # A bundled hook must override this host-module directory, including after extraction.
    environment["GIO_MODULE_DIR"] = "/usr/lib/x86_64-linux-gnu/gio/modules"
    environment["GIO_EXTRA_MODULES"] = environment["GIO_MODULE_DIR"]
    # Keep the default resolver test, then require the libproxy chain implicated in #37.
    for resolver in (None, "libproxy"):
        environment.pop("GIO_USE_PROXY_RESOLVER", None)
        if resolver:
            environment["GIO_USE_PROXY_RESOLVER"] = resolver
        for mode in ("reject", "accept"):
            result = subprocess.run([
                sys.argv[1], "https://peacock-proxy.invalid/healthz", str(certificate), proxy_url, mode,
            ], env=environment, timeout=30, capture_output=True, text=True)
            print(result.stdout, end="")
            if result.returncode:
                raise RuntimeError(f"AppImage probe failed ({mode}, {resolver or 'default'}): " + result.stderr)
            if resolver and "resolver=GLibproxyResolver" not in result.stdout:
                raise RuntimeError("Bundled libproxy resolver did not load")
            if "Failed to load module" in result.stderr or "undefined symbol" in result.stderr:
                raise RuntimeError("GIO module ABI failure: " + result.stderr)
    if Proxy.connections < 4:
        raise RuntimeError("HTTPS requests did not traverse the proxy")
    proxy.shutdown()
    https.shutdown()
