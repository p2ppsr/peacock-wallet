#!/usr/bin/env bash
set -euo pipefail

# Tauri 2.11.4 discovers the GTK plugin beside its cached linuxdeploy AppImage.
# Use a dedicated build cache; do not replace another project's plugin.
tools=${1:?usage: prepare-appimage-tools.sh <dedicated-cache>/tauri}
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$tools"
download=$(mktemp "$tools/gtk.XXXXXX")
trap 'rm -f "$download"' EXIT
curl --fail --location --silent --show-error \
  https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/dda522bce37387f1b853d9095713bfaa924c8423/linuxdeploy-plugin-gtk.sh \
  -o "$download"
echo "7804c9eef13e59bf2783aad9882ef9db8f3f3f9e8d631874b1d348d550a3693f  $download" | sha256sum --check --status
install -m 755 "$download" "$tools/peacock-upstream-gtk.sh"
install -m 755 "$source_dir/linuxdeploy-plugin-gtk.sh" "$tools/linuxdeploy-plugin-gtk.sh"
install -m 755 "$source_dir/bundle-gio.sh" "$tools/peacock-bundle-gio.sh"
