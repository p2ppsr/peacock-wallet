# Linux AppImage proxy compatibility

Issue [#37](https://github.com/p2ppsr/peacock-wallet/issues/37) reports a verified
v0.9.6 AppImage on Debian 13, X11, where HTTPS requires an existing proxy. The
reported bundled GLib/libnghttp2 versions could not load newer host GIO proxy and
dconf modules. The resolver fell back to direct connections. The reporter's
system-library-first launcher worked in that environment; it is not a general
packaging solution.

Tauri CLI 2.11.4 invokes its GTK linuxdeploy plugin from the Tauri tools cache. The
upstream plugin bundles GnuTLS, omits proxy modules, and uses `GIO_EXTRA_MODULES`
without changing GIO's host module directory. Peacock's build-only wrapper runs
that pinned GTK plugin, copies all installed GIO modules and libproxy 0.4 backends
from the Ubuntu 22.04 build host, and asks linuxdeploy to bundle their ELF
dependencies. Its early AppRun hook selects the matching bundled GIO directory
with `GIO_MODULE_DIR`, including when launched after extraction without FUSE.
`PX_MODULE_PATH` selects the bundled libproxy backends. GTK's own later hook can
still select its matching bundled TLS module directory with `GIO_EXTRA_MODULES`.

The wrapper changes no proxy URLs, exclusions, certificate policy, or library
search environment. The release workflow uses a dedicated tools cache and copies
the Tauri AppImage for the canonical Linux download before signing and hashing.
The versioned artifact, direct download, and updater payload therefore use the
same packaging path. Existing signing and updater verification stay in place.

## Local Linux builds

Install the normal Tauri dependencies plus `glib-networking`, `libglib2.0-bin`,
and `dconf-gsettings-backend` on the Ubuntu 22.04 builder. Before building:

```sh
export XDG_CACHE_HOME="$(mktemp -d)"
bash scripts/linux/prepare-appimage-tools.sh "$XDG_CACHE_HOME/tauri"
npm run tauri build
```

The GTK source is pinned to commit
`dda522bce37387f1b853d9095713bfaa924c8423` and checked by SHA-256 before use.
Review Tauri's cache/plugin discovery whenever updating the CLI. The release
build baseline remains Ubuntu 22.04; raising it can raise the glibc requirement.

## Regression coverage and limits

`python3 scripts/linux/test-packaging.py` runs portable contract checks, including
missing proxy module rejection, backend copying, paths containing spaces, and
extracted AppRun initialization while preserving proxy/TLS/library variables.

The `Linux AppImage proxy compatibility` workflow packages a small credential-free
GIO probe with the same GTK wrapper and retained Tauri AppRun. It tests
extracted execution on Ubuntu 22.04/24.04 and Debian 12/13, plus FUSE-mounted
execution on Ubuntu 22.04. A loopback CONNECT fixture is the only route to its
HTTPS origin. Both the default resolver and explicitly selected libproxy must
use it. An untrusted test certificate must fail; supplying its test CA must
produce HTTP 200. There are no external requests, wallet unlocks, or transactions.

An additional job builds the complete unsigned wallet AppImage, extracts it into
a disposable directory, and replaces only that scratch copy's wallet executable
with an ephemeral WebKit probe. The probe requires its own bundled network and
renderer helper processes, HTTP 200, and the rendered fixture body. It retains
WebKit's default proxy and TLS policy. On a disposable Ubuntu 22.04 runner, the
fixture first rejects a private CA, installs only that temporary CA in the normal
host trust store, rejects a hostname mismatch, accepts the matching host, and
removes the CA. The wallet executable, credentials, storage, and transactions are
never used. Private D-Bus sessions and temporary XDG directories isolate GNOME
manual/PAC settings; loopback exclusions must avoid CONNECT requests.

Early diagnostic probes using Ubuntu 22.04 libsoup 3.0.7 crashed during the
private-certificate CONNECT test with both untouched host and bundled libraries,
including async I/O. The direct GIO probe isolates module compatibility; it does
not explain or waive that HTTP-engine crash. The complete AppImage WebKit job
remains a release gate. Its passing result must be observed, not inferred from
the lower-level probe.

NetworkManager, KDE-specific backends, custom host GIO modules, and signed-artifact
verification remain separate qualification concerns. A macOS source review and
portable tests alone cannot establish Linux runtime compatibility. Confirm the
actual runtime jobs, supported distribution checks, platform builds, signatures,
and updater payloads before publishing a release.

Source references: [Tauri 2.11.4 bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs),
[pinned GTK plugin](https://github.com/tauri-apps/linuxdeploy-plugin-gtk/blob/dda522bce37387f1b853d9095713bfaa924c8423/linuxdeploy-plugin-gtk.sh),
[libproxy 0.4.17 backend discovery](https://github.com/libproxy/libproxy/blob/0.4.17/libproxy/proxy.cpp).
