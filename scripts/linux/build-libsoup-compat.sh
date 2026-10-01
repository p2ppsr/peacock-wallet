#!/usr/bin/env bash
set -euo pipefail

# Preserve the supported Ubuntu 22.04 library baseline and its packaging patches.
# Stop when Ubuntu changes it, so a future security update is never overwritten.
version=$(dpkg-query -W -f='${Version}' libsoup-3.0-0)
[[ $version == 3.0.7-0ubuntu1 ]] || { echo "Review libsoup compatibility backport for Ubuntu version $version" >&2; exit 1; }
mkdir -p "${1:?usage: build-libsoup-compat.sh <dedicated-cache>}"
root=$(realpath "$1")
source_script=$(realpath "$0")
download() {
  curl --fail --location --silent --show-error "$1" -o "$root/$2"
  echo "$3  $root/$2" | sha256sum --check --status
}
download https://archive.ubuntu.com/ubuntu/pool/universe/libs/libsoup3/libsoup3_3.0.7.orig.tar.xz \
  libsoup3_3.0.7.orig.tar.xz ebdf90cf3599c11acbb6818a9d9e3fc9d2c68e56eb829b93962972683e1bf7c8
download https://archive.ubuntu.com/ubuntu/pool/universe/libs/libsoup3/libsoup3_3.0.7-0ubuntu1.debian.tar.xz \
  libsoup3_3.0.7-0ubuntu1.debian.tar.xz 41f8224a492af1f917cdf7d9284154ed2b921031b4b6f331925447fcc35410d2
download https://github.com/GNOME/libsoup/commit/2696fc8ddfd9237f8844452c6f8a12f6a612b97a.patch \
  default-proxy.patch 728d3c1d2a67351e6a72fcb5d72c2cc4482ab163cba43a2917733c6ff923684a
tar -xJf "$root/libsoup3_3.0.7.orig.tar.xz" -C "$root"
source_dir="$root/libsoup-3.0.7"
tar -xJf "$root/libsoup3_3.0.7-0ubuntu1.debian.tar.xz" -C "$source_dir"
while IFS= read -r name; do
  [[ -z $name || $name == \#* ]] && continue
  patch --batch --fuzz=0 -d "$source_dir" -p1 < "$source_dir/debian/patches/$name"
done < "$source_dir/debian/patches/series"
patch --batch --fuzz=0 -d "$source_dir" -p1 < "$root/default-proxy.patch"

# Match Debian/Ubuntu hardening and retain all runtime authentication/decompression features.
export DEB_BUILD_MAINT_OPTIONS=hardening=+all
export DEB_LDFLAGS_MAINT_APPEND='-Wl,-O1 -Wl,-z,defs'
eval "$(dpkg-buildflags --export=sh)"
meson setup "$root/build" "$source_dir" --prefix="$root/prefix" --libdir=lib \
  --buildtype=plain --wrap-mode=nodownload -Dtests=false \
  -Dintrospection=disabled -Dvapi=disabled -Dsysprof=enabled \
  -Dgssapi=enabled -Dntlm=enabled -Dbrotli=enabled
meson compile -C "$root/build"
meson install -C "$root/build"
strip --strip-unneeded "$root/prefix/lib/libsoup-3.0.so.0"
install -m 644 "$source_script" "$root/source-build.sh"
install -m 644 "$source_dir/COPYING" "$root/COPYING"
