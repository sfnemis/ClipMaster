#!/usr/bin/env bash
#
# Installs ClipMaster from a clone of this repository.
#
# Most people should install from https://extensions.gnome.org/extension/8923/clipmaster/
# instead. This script is for trying out a development version.
set -euo pipefail

UUID="clipmaster@gnome.extension"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "ClipMaster installer"
echo

if ! command -v gnome-shell >/dev/null 2>&1; then
    echo "gnome-shell was not found. ClipMaster is a GNOME Shell extension." >&2
    exit 1
fi

VERSION=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
echo "GNOME Shell $VERSION detected."

if [ "$VERSION" -lt 46 ]; then
    echo "ClipMaster 2 supports GNOME Shell 46 and later." >&2
    exit 1
fi

# The same file list the release package uses, so a development install and a
# published one contain exactly the same thing.
echo "Building the package..."
bash "$ROOT/scripts/build.sh" >/dev/null

echo "Installing into $TARGET"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -r "$ROOT/build/$UUID/." "$TARGET/"

if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas "$TARGET/schemas/"
fi

echo
echo "Installed. Two things are left:"
echo
echo "  1. Restart the GNOME session so the shell notices the extension."
echo "     On Wayland that means logging out and back in."
echo "     On X11 you can press Alt+F2, type r and press Enter."
echo
echo "  2. Enable it and choose a keyboard shortcut:"
echo "       gnome-extensions enable $UUID"
echo "       gnome-extensions prefs $UUID"
echo
echo "ClipMaster ships without a keyboard shortcut on purpose. The GNOME"
echo "Extensions review guidelines do not allow one for an extension that reads"
echo "the clipboard, and the shortcuts earlier versions used were already taken"
echo "by GNOME and by every terminal. Pick your own on the Shortcuts page."
