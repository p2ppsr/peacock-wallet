#!/usr/bin/env bash
set -euo pipefail

# Diagnostic comparison only; no system installation or production launcher changes.
root=$(realpath "${1:?usage: build-libsoup-control.sh <scratch> <upstream|fixed>}")
variant=${2:?choose upstream or fixed}
[[ $variant == upstream || $variant == fixed ]]
mkdir -p "$root/$variant"
archive="$root/libsoup-3.0.7.tar.xz"
if [[ ! -f $archive ]]; then
  curl --fail --location --silent --show-error \
    https://download.gnome.org/sources/libsoup/3.0/libsoup-3.0.7.tar.xz -o "$archive"
fi
echo "ebdf90cf3599c11acbb6818a9d9e3fc9d2c68e56eb829b93962972683e1bf7c8  $archive" | sha256sum --check --status
tar -xJf "$archive" -C "$root/$variant"
source_dir="$root/$variant/libsoup-3.0.7"
if [[ $variant == fixed ]]; then
  patch_file="$root/default-proxy.patch"
  curl --fail --location --silent --show-error \
    https://github.com/GNOME/libsoup/commit/2696fc8ddfd9237f8844452c6f8a12f6a612b97a.patch -o "$patch_file"
  echo "728d3c1d2a67351e6a72fcb5d72c2cc4482ab163cba43a2917733c6ff923684a  $patch_file" | sha256sum --check --status
  patch --batch --fuzz=0 -d "$source_dir" -p1 < "$patch_file"
fi
meson setup "$root/$variant/build" "$source_dir" \
  --prefix="$root/$variant/prefix" --libdir=lib --buildtype=debugoptimized \
  -Dtests=false -Dintrospection=disabled -Dvapi=disabled \
  -Dgssapi=enabled -Dntlm=enabled -Dbrotli=enabled
meson compile -C "$root/$variant/build"
meson install -C "$root/$variant/build"
