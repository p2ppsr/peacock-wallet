#!/usr/bin/env bash
set -euo pipefail
tools=$(cd -- "$(dirname -- "$0")" && pwd)

# Preserve linuxdeploy's plugin discovery/help protocol without running packaging.
if [[ ${1:-} != --appdir || $# != 2 ]]; then
  exec bash "$tools/peacock-upstream-gtk.sh" "$@"
fi
bash "$tools/peacock-upstream-gtk.sh" "$@"
bash "$tools/peacock-bundle-gio.sh" "$2"
