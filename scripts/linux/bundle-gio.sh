#!/usr/bin/env bash
set -euo pipefail

appdir=$(realpath "${1:?usage: bundle-gio.sh <AppDir>}")
: "${LINUXDEPLOY:?linuxdeploy must supply LINUXDEPLOY}"
modules=$(pkg-config --variable=giomoduledir gio-2.0)
libdir=$(pkg-config --variable=libdir gio-2.0)
destination="$appdir/usr/lib/peacock-gio"
proxy_destination="$appdir/usr/lib/peacock-libproxy"

# Load modules from the same distribution as the bundled GLib/libnghttp2.
# Missing proxy/TLS/settings support is a packaging failure, not a direct fallback.
for module in libgiolibproxy.so libgiognutls.so libdconfsettings.so; do
  test -f "$modules/$module" || { echo "Required GIO module missing: $module" >&2; exit 1; }
done
mkdir -p "$destination" "$proxy_destination" "$appdir/apprun-hooks"
cp -L "$modules/"*.so "$destination/"

# libproxy 0.4 also discovers optional desktop/PAC backends using dlopen.
# Keep all installed backends and their dependencies together with libproxy.
if [[ -d "$libdir/libproxy" ]]; then
  while IFS= read -r -d '' module; do
    cp -L "$module" "$proxy_destination/"
  done < <(find "$libdir/libproxy" -name '*.so' -print0)
fi

# linuxdeploy scans ELF files recursively under usr/lib and bundles their dependencies.
env LINUXDEPLOY_PLUGIN_MODE=1 "$LINUXDEPLOY" --appdir="$appdir"
while IFS= read -r -d '' module; do
  # shellcheck disable=SC2016 # $ORIGIN is expanded by the ELF loader.
  patchelf --set-rpath '$ORIGIN/..' "$module"
done < <(find "$destination" "$proxy_destination" -type f -name '*.so' -print0)
gio-querymodules "$destination"

# Run before GTK's theme/settings helpers. GTK may subsequently set GIO_EXTRA_MODULES
# to its bundled TLS directory; GIO_MODULE_DIR still excludes incompatible host modules.
cat > "$appdir/apprun-hooks/00-peacock-gio.sh" <<'HOOK'
#!/usr/bin/env bash
export APPDIR="${APPDIR:-"$(dirname "$(realpath "$0")")"}"
export GIO_MODULE_DIR="$APPDIR/usr/lib/peacock-gio"
export GIO_EXTRA_MODULES="$GIO_MODULE_DIR"
export PX_MODULE_PATH="$APPDIR/usr/lib/peacock-libproxy"
HOOK
chmod +x "$appdir/apprun-hooks/00-peacock-gio.sh"
