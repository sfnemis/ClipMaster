#!/bin/bash
# ClipMaster GNOME Extension Installer

set -e

EXTENSION_UUID="clipmaster@gnome.extension"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SOURCE_DIR="$(dirname "$(readlink -f "$0")")/$EXTENSION_UUID"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          ClipMaster GNOME Extension Installer            ║"
echo "║   A powerful clipboard manager for GNOME 45+             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check GNOME Shell version
GNOME_VERSION=$(gnome-shell --version 2>/dev/null | grep -oP '\d+' | head -1)
echo "Detected GNOME Shell version: $GNOME_VERSION"

if [ "$GNOME_VERSION" -lt 45 ]; then
    echo "⚠️  Warning: This extension requires GNOME 45 or later."
    echo "   Your version: $GNOME_VERSION"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "Installing ClipMaster extension..."

# Create extension directory
mkdir -p "$EXTENSION_DIR"

# Copy files
echo "→ Copying extension files..."
cp -r "$SOURCE_DIR"/* "$EXTENSION_DIR/"

# Compile schemas
echo "→ Compiling GSettings schemas..."
if [ -d "$EXTENSION_DIR/schemas" ]; then
    glib-compile-schemas "$EXTENSION_DIR/schemas/"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    Next Steps                            ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  1. Log out and log back in (required on Wayland)        ║"
echo "║     OR press Alt+F2, type 'r', press Enter (X11 only)    ║"
echo "║                                                          ║"
echo "║  2. Enable the extension:                                ║"
echo "║     gnome-extensions enable $EXTENSION_UUID              ║"
echo "║                                                          ║"
echo "║  3. Or use GNOME Extensions app / extensions.gnome.org   ║"
echo "║                                                          ║"
echo "║  4. Default shortcut: Super+V to show clipboard popup    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Enjoy ClipMaster! 🎉"

