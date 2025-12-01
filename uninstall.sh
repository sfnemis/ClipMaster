#!/bin/bash
# ClipMaster GNOME Extension Uninstaller

EXTENSION_UUID="clipmaster@gnome.extension"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
DATA_DIR="$HOME/.local/share/clipmaster"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         ClipMaster GNOME Extension Uninstaller           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Disable extension first
echo "→ Disabling extension..."
gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null || true

# Remove extension directory
if [ -d "$EXTENSION_DIR" ]; then
    echo "→ Removing extension files..."
    rm -rf "$EXTENSION_DIR"
    echo "✓ Extension files removed"
else
    echo "✓ Extension files not found (already removed)"
fi

# Ask about data
if [ -d "$DATA_DIR" ]; then
    echo ""
    read -p "Remove clipboard history data? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$DATA_DIR"
        echo "✓ Clipboard data removed"
    else
        echo "✓ Clipboard data kept at: $DATA_DIR"
    fi
fi

echo ""
echo "✅ ClipMaster has been uninstalled."
echo ""
echo "Please log out and log back in to complete the removal."

