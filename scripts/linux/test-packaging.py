#!/usr/bin/env python3
"""Portable packaging contract tests; fake libraries are never loaded or executed."""
import os
import pathlib
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parent


class Packaging(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="peacock packaging ")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.modules = self.root / "host/gio/modules"
        self.libdir = self.root / "host"
        self.bin = self.root / "bin"
        self.appdir = self.root / "extracted app"
        self.modules.mkdir(parents=True)
        self.bin.mkdir()
        self.appdir.mkdir()
        for name in ("libgiolibproxy.so", "libgiognutls.so", "libdconfsettings.so"):
            (self.modules / name).write_text("inert fixture " + name)
        backend = self.libdir / "libproxy/0.4.17/modules"
        backend.mkdir(parents=True)
        (backend / "config_gnome3.so").write_text("inert backend")
        self.tool("pkg-config", 'case "$*" in *giomoduledir*) printf "%s\\n" "$TEST_MODULES";; *) printf "%s\\n" "$TEST_LIBDIR";; esac')
        self.tool("linuxdeploy", 'printf "%s\\n" "$*" >> "$TEST_LOG"')
        self.tool("patchelf", 'printf "%s\\n" "$*" >> "$TEST_LOG"')
        self.tool("gio-querymodules", 'printf "cache\\n" > "$1/giomodule.cache"')
        self.environment = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                                TEST_MODULES=str(self.modules), TEST_LIBDIR=str(self.libdir),
                                TEST_LOG=str(self.root / "calls"), LINUXDEPLOY=str(self.bin / "linuxdeploy"))

    def tool(self, name, body):
        file = self.bin / name
        file.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body + "\n")
        file.chmod(0o755)

    def bundle(self):
        return subprocess.run(["bash", str(SOURCE / "bundle-gio.sh"), str(self.appdir)],
                              env=self.environment, capture_output=True, text=True)

    def test_modules_and_dynamic_backends_are_bundled(self):
        result = self.bundle()
        self.assertEqual(result.returncode, 0, result.stderr)
        bundled = self.appdir / "usr/lib/peacock-gio"
        self.assertEqual((bundled / "libgiolibproxy.so").read_bytes(), (self.modules / "libgiolibproxy.so").read_bytes())
        self.assertTrue((bundled / "giomodule.cache").is_file())
        self.assertTrue((self.appdir / "usr/lib/peacock-libproxy/config_gnome3.so").is_file())
        calls = (self.root / "calls").read_text()
        self.assertIn("--appdir=", calls)
        self.assertEqual(calls.count("--set-rpath $ORIGIN/.."), 4)

    def test_missing_proxy_module_fails_before_deployment(self):
        (self.modules / "libgiolibproxy.so").unlink()
        result = self.bundle()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Required GIO module missing: libgiolibproxy.so", result.stderr)
        self.assertFalse((self.root / "calls").exists())
        self.assertFalse((self.appdir / "apprun-hooks/00-peacock-gio.sh").exists())

    def test_extracted_hook_sets_appdir_and_preserves_network_policy(self):
        self.assertEqual(self.bundle().returncode, 0)
        app_run = self.appdir / "AppRun"
        app_run.write_text('''#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/apprun-hooks/00-peacock-gio.sh"
printf '%s\\n' "$APPDIR" "$GIO_MODULE_DIR" "$GIO_EXTRA_MODULES" "$PX_MODULE_PATH" "$https_proxy" "$no_proxy" "$LD_LIBRARY_PATH" "$SSL_CERT_FILE"
''')
        environment = dict(self.environment, https_proxy="http://configured.invalid:8080",
                           no_proxy="localhost", LD_LIBRARY_PATH="unchanged", SSL_CERT_FILE="existing-ca.pem",
                           GIO_MODULE_DIR="/host/modules", GIO_EXTRA_MODULES="/host/extra")
        environment.pop("APPDIR", None)
        result = subprocess.run(["bash", str(app_run)], env=environment, check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout.splitlines(), [str(self.appdir), str(self.appdir / "usr/lib/peacock-gio"),
                         str(self.appdir / "usr/lib/peacock-gio"), str(self.appdir / "usr/lib/peacock-libproxy"),
                         "http://configured.invalid:8080", "localhost", "unchanged", "existing-ca.pem"])


if __name__ == "__main__":
    unittest.main()
