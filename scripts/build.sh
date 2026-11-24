#!/usr/bin/env bash
#
# Builds the extension zip for extensions.gnome.org.
#
# The zip is assembled from an explicit list of files rather than by archiving
# the source directory, so nothing that is added to the repository later can end
# up in a published package by accident. The review guidelines ask that build
# scripts, tests, screenshots and translation sources stay out of it.
set -euo pipefail

UUID="clipmaster@gnome.extension"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/$UUID"
OUT="$ROOT/build"
STAGE="$OUT/$UUID"

FILES=(
    "metadata.json"
    "extension.js"
    "prefs.js"
    "stylesheet.css"
    "LICENSE"
    "assets/icons/clipmaster-symbolic.svg"
    "schemas/org.gnome.shell.extensions.clipmaster.gschema.xml"
    "src/Manager/ClipboardMonitor.js"
    "src/Manager/Database.js"
    "src/UI/Indicator.js"
    "src/UI/Popup.js"
    "src/Util/CodeDetect.js"
    "src/Util/Constants.js"
    "src/Util/ImageStorage.js"
    "src/Util/Migrations.js"
    "src/Util/Obfuscation.js"
    "src/Util/PasteUtils.js"
    "src/Util/QrCodeGenerator.js"
    "src/Util/Utils.js"
)

rm -rf "$OUT"
mkdir -p "$STAGE"

for file in "${FILES[@]}"; do
    if [ ! -f "$SRC/$file" ]; then
        echo "missing: $file" >&2
        exit 1
    fi
    mkdir -p "$STAGE/$(dirname "$file")"
    cp "$SRC/$file" "$STAGE/$file"
done

# Every file in the source tree must be either packaged or deliberately left
# out, so a new file cannot be forgotten in either direction.
EXPECTED_EXTRA=("tests")
while IFS= read -r found; do
    rel="${found#"$SRC"/}"
    packaged=0
    for file in "${FILES[@]}"; do
        [ "$rel" = "$file" ] && packaged=1 && break
    done
    if [ "$packaged" -eq 0 ]; then
        skip=0
        for extra in "${EXPECTED_EXTRA[@]}"; do
            case "$rel" in "$extra"/*) skip=1 ;; esac
        done
        [ "$skip" -eq 0 ] && echo "NOT PACKAGED: $rel" >&2
    fi
done < <(find "$SRC" -type f ! -name 'gschemas.compiled' ! -name '*.tmp' | sort)

if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas --strict "$STAGE/schemas"
else
    echo "glib-compile-schemas not found: the zip ships the schema XML only." >&2
    echo "GNOME compiles it on install, so this is fine for a release built on macOS." >&2
fi

( cd "$STAGE" && zip -q -r -X "$OUT/$UUID.shell-extension.zip" . )

echo "built $OUT/$UUID.shell-extension.zip"
unzip -l "$OUT/$UUID.shell-extension.zip"
