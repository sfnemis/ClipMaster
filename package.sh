#!/bin/bash
# ClipMaster Extension Package Script for extensions.gnome.org
# This script creates a properly formatted zip file for submission

set -e

EXTENSION_UUID="clipmaster@gnome.extension"
EXTENSION_DIR="clipmaster@gnome.extension"
PACKAGE_NAME="clipmaster@gnome.extension.shell-extension.zip"
TEMP_DIR=$(mktemp -d)

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     ClipMaster Extension Package Script                 ║"
echo "║     Preparing package for extensions.gnome.org          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check if extension directory exists
if [ ! -d "$EXTENSION_DIR" ]; then
    echo "❌ Error: Extension directory '$EXTENSION_DIR' not found!"
    exit 1
fi

echo "→ Creating temporary package directory..."
mkdir -p "$TEMP_DIR/$EXTENSION_UUID"

echo "→ Copying extension files..."
# Copy all necessary files
cp -r "$EXTENSION_DIR"/* "$TEMP_DIR/$EXTENSION_UUID/"

# Remove compiled schemas (will be recompiled on install)
echo "→ Cleaning up compiled schemas..."
rm -f "$TEMP_DIR/$EXTENSION_UUID/schemas/gschemas.compiled"

echo "→ Creating zip package..."
cd "$TEMP_DIR"

# Try zip command first, fallback to Python
if command -v zip &> /dev/null; then
    zip -r "$PACKAGE_NAME" "$EXTENSION_UUID" -x "*.git*" "*.DS_Store" "*~" "*.swp" "*.swo"
elif command -v python3 &> /dev/null; then
    python3 -m zipfile -c "$PACKAGE_NAME" "$EXTENSION_UUID"
elif command -v python &> /dev/null; then
    python -m zipfile -c "$PACKAGE_NAME" "$EXTENSION_UUID"
else
    echo "❌ Error: No zip tool found. Please install zip or Python."
    exit 1
fi

# Move to original directory
cd - > /dev/null
mv "$TEMP_DIR/$PACKAGE_NAME" .

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "✅ Package created successfully: $PACKAGE_NAME"
echo ""
echo "📦 Package contents:"
unzip -l "$PACKAGE_NAME" | head -20
echo ""
echo "📋 Next steps:"
echo "   1. Review the package: unzip -l $PACKAGE_NAME"
echo "   2. Test installation locally"
echo "   3. Upload to extensions.gnome.org"
echo ""

