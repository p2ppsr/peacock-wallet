#!/usr/bin/env python3
"""Local HTTPS and CONNECT fixture. No wallet, credentials, or external traffic."""
import http.server
import os
import pathlib
import select
import socket
import socketserver
import ssl
import shutil
import subprocess
import sys
import tempfile
import threading


class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        if self.path == "/proxy.pac":
            self.send_header("Content-Type", "application/x-ns-proxy-autoconfig")
        self.end_headers()
        if self.path == "/proxy.pac":
            self.wfile.write(("function FindProxyForURL(url, host) { "
                             "if (host === 'localhost' || host === '127.0.0.1') return 'DIRECT'; "
                             f"return 'PROXY 127.0.0.1:{proxy.server_address[1]}'; "
                             "}").encode())
        else:
            self.wfile.write(b"fixture healthy\n")

    def log_message(self, *_args):
        pass


class Proxy(socketserver.StreamRequestHandler):
    connections = 0

    def handle(self):
        # Only tunnel the fixture authority to our loopback TLS server.
        request = self.rfile.readline().split()
        if (len(request) != 3 or request[0] != b"CONNECT"
                or request[1] not in (b"peacock-proxy.invalid:443", b"peacock-proxy.invalid", b"wrong-host.invalid:443", b"wrong-host.invalid")
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
                    try:
                        data = peer.recv(65536)
                    except ConnectionResetError:
                        return
                    if not data:
                        return
                    try:
                        peers[1 if peer is peers[0] else 0].sendall(data)
                    except (BrokenPipeError, ConnectionResetError):
                        return


with tempfile.TemporaryDirectory(prefix="peacock-proxy-") as temporary:
    webkit = len(sys.argv) > 2 and sys.argv[2] == "--webkit-host-ca"
    profile = sys.argv[3] if len(sys.argv) > 3 else "environment"
    if profile not in ("environment", "gnome-manual", "gnome-pac"):
        raise ValueError("Unknown proxy fixture profile")
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
    local_http = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Health)
    proxy.daemon_threads = True
    for server in (https, proxy, local_http):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    proxy_url = f"http://127.0.0.1:{proxy.server_address[1]}"
    environment = {key: value for key, value in os.environ.items() if "proxy" not in key.lower()}
    if profile == "environment":
        environment.update(https_proxy=proxy_url, HTTPS_PROXY=proxy_url, no_proxy="", NO_PROXY="")
    else:
        environment["XDG_CURRENT_DESKTOP"] = "GNOME"
    environment.pop("APPDIR", None)
    if webkit:
        environment["G_MESSAGES_DEBUG"] = "all"
        for variable in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
            environment[variable] = str(directory / variable.lower())
    # A bundled hook must override this host-module directory, including after extraction.
    environment["GIO_MODULE_DIR"] = "/usr/lib/x86_64-linux-gnu/gio/modules"
    environment["GIO_EXTRA_MODULES"] = environment["GIO_MODULE_DIR"]
    # Keep the default resolver test, then require the libproxy chain implicated in #37.
    for resolver in ((None, "libproxy") if profile == "environment" else (None,)):
        environment.pop("GIO_USE_PROXY_RESOLVER", None)
        if resolver:
            environment["GIO_USE_PROXY_RESOLVER"] = resolver
        for mode in ("reject", "accept"):
            trust_file = f"/usr/local/share/ca-certificates/{directory.name}.crt"
            command = [sys.argv[1], "https://peacock-proxy.invalid/healthz", str(certificate), proxy_url, mode]
            if webkit:
                if profile == "environment":
                    command = ["dbus-run-session", "--", "xvfb-run", "-a"] + command
                else:
                    settings = '''set -e
gsettings set org.gnome.system.proxy mode "$1"
gsettings set org.gnome.system.proxy autoconfig-url "$2"
gsettings set org.gnome.system.proxy ignore-hosts "['localhost', '127.0.0.1']"
gsettings set org.gnome.system.proxy use-same-proxy false
gsettings set org.gnome.system.proxy.http host 127.0.0.1
gsettings set org.gnome.system.proxy.http port "$3"
gsettings set org.gnome.system.proxy.https host 127.0.0.1
gsettings set org.gnome.system.proxy.https port "$3"
shift 3
exec xvfb-run -a "$@"
'''
                    command = ["dbus-run-session", "--", "bash", "-c", settings, "desktop-fixture",
                               "auto" if profile == "gnome-pac" else "manual",
                               f"http://127.0.0.1:{local_http.server_address[1]}/proxy.pac",
                               str(proxy.server_address[1])] + command
            try:
                if webkit and mode == "accept":
                    subprocess.run(["sudo", "install", "-m", "644", str(certificate), trust_file], check=True)
                    subprocess.run(["sudo", "update-ca-certificates"], check=True, stdout=subprocess.DEVNULL)
                    wrong_host = command.copy()
                    wrong_host[-4] = "https://wrong-host.invalid/healthz"
                    wrong_host[-1] = "reject"
                    mismatch = subprocess.run(wrong_host, env=environment, timeout=35, capture_output=True, text=True)
                    print(mismatch.stdout, end="")
                    if mismatch.returncode:
                        raise RuntimeError("Trusted certificate hostname mismatch was not rejected: " + mismatch.stderr)
                    bypass = command.copy()
                    bypass[-4] = f"http://127.0.0.1:{local_http.server_address[1]}/healthz"
                    bypass[-2] = "direct://"
                    connections = Proxy.connections
                    bypass_environment = environment.copy()
                    if profile == "environment":
                        bypass_environment.update(http_proxy=proxy_url, HTTP_PROXY=proxy_url,
                                                  no_proxy="127.0.0.1", NO_PROXY="127.0.0.1")
                    direct = subprocess.run(bypass, env=bypass_environment, timeout=35, capture_output=True, text=True)
                    print(direct.stdout, end="")
                    if direct.returncode or Proxy.connections != connections:
                        raise RuntimeError("Loopback exclusion did not stay direct: " + direct.stderr)
                result = subprocess.run(command, env=environment, timeout=35, capture_output=True, text=True)
            finally:
                if webkit and mode == "accept":
                    subprocess.run(["sudo", "rm", "-f", trust_file], check=True)
                    subprocess.run(["sudo", "update-ca-certificates", "--fresh"], check=True, stdout=subprocess.DEVNULL)
            print(result.stdout, end="")
            if result.returncode:
                print(f"{profile}: {mode}, {resolver or 'default'}, fixture CONNECTs={Proxy.connections}", flush=True)
                if result.returncode == -11 and not webkit and shutil.which("gdb"):
                    app_run = pathlib.Path(sys.argv[1])
                    if app_run.suffix == ".AppImage":
                        subprocess.run([str(app_run), "--appimage-extract"], cwd=directory,
                                       check=True, stdout=subprocess.DEVNULL)
                        app_run = directory / "squashfs-root/AppRun"
                    debug_script = '''set -e
export APPDIR="$1"
shift
for hook in "$APPDIR"/apprun-hooks/*; do source "$hook"; done
exec gdb --batch -ex run -ex 'thread apply all bt' -ex 'info sharedlibrary' --args "$APPDIR/AppRun.wrapped" "$@"
'''
                    debug = subprocess.run(["bash", "-c", debug_script, "probe-debug", str(app_run.parent)] + command[-4:],
                                           env=environment, timeout=45, capture_output=True, text=True)
                    print(debug.stdout, debug.stderr, flush=True)
                raise RuntimeError(f"AppImage probe exit {result.returncode} ({mode}, {resolver or 'default'}): " + result.stderr)
            if resolver and "resolver=GLibproxyResolver" not in result.stdout:
                raise RuntimeError("Bundled libproxy resolver did not load")
            if "Failed to load module" in result.stderr or "undefined symbol" in result.stderr:
                raise RuntimeError("GIO module ABI failure: " + result.stderr)
    if Proxy.connections < (4 if profile == "environment" else 2):
        raise RuntimeError("HTTPS requests did not traverse the proxy")
    proxy.shutdown()
    https.shutdown()
    local_http.shutdown()
