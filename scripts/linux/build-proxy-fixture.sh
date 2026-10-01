#!/usr/bin/env bash
set -euo pipefail
output=$(realpath -m "${1:?usage: build-proxy-fixture.sh <output-directory>}")
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
tools="$output/cache/tauri"
bash "$source_dir/prepare-appimage-tools.sh" "$tools"
curl --fail --location --silent --show-error \
  https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-x86_64.AppImage \
  -o "$tools/linuxdeploy-x86_64.AppImage"
chmod +x "$tools/linuxdeploy-x86_64.AppImage"
appdir="$output/ProxyFixture.AppDir"
mkdir -p "$appdir/usr/bin" "$appdir/usr/share/applications"
read -r -a compiler_flags <<< "$(pkg-config --cflags --libs gio-2.0)"
cc -g "$source_dir/gio-proxy-probe.c" -o "$appdir/usr/bin/proxy-fixture" "${compiler_flags[@]}"
# Exercise the same retained AppRun and GTK hook discovery used by Tauri.
curl --fail --location --silent --show-error \
  https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64 \
  -o "$appdir/AppRun"
chmod +x "$appdir/AppRun"
cat > "$appdir/usr/share/applications/proxy-fixture.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Proxy Fixture
Exec=proxy-fixture
Icon=proxy-fixture
Categories=Utility;
DESKTOP
cp "$source_dir/../../src-tauri/icons/128x128.png" "$output/proxy-fixture.png"
export APPIMAGE_EXTRACT_AND_RUN=1
export OUTPUT="$output/proxy-fixture.AppImage"
"$tools/linuxdeploy-x86_64.AppImage" --appimage-extract-and-run --appdir "$appdir" \
  --plugin gtk --output appimage --icon-file "$output/proxy-fixture.png" \
  --desktop-file "$appdir/usr/share/applications/proxy-fixture.desktop"
test -s "$OUTPUT"
