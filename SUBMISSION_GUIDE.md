# ClipMaster - Extensions.gnome.org Submission Guide

## Package Information

### Package File
- **File**: `clipmaster@gnome.extension.shell-extension.zip`
- **UUID**: `clipmaster@gnome.extension`
- **Version**: 1
- **GNOME Shell Versions**: 45, 46, 47, 48, 49

### Package Contents
- `extension.js` - Main extension code
- `prefs.js` - Preferences/settings UI
- `metadata.json` - Extension metadata
- `stylesheet.css` - Styles including 12 themes
- `schemas/org.gnome.shell.extensions.clipmaster.gschema.xml` - GSettings schema
- `icons/clipmaster-symbolic.svg` - Extension icon
- `LICENSE` - GPL-2.0-or-later license

## Submission Steps

### 1. Prepare Screenshots
You need at least one screenshot. Recommended screenshots:
- Main popup showing clipboard items
- Settings panel showing theme selection
- Settings panel showing all options

Screenshots should be:
- PNG format
- At least 800px wide
- Show the extension in action
- Clear and professional

### 2. Prepare Descriptions

#### Short Description (for metadata.json - already updated)
"A powerful clipboard manager for GNOME with unlimited history, 12 beautiful themes (Gruvbox, Dracula, Nord, Catppuccin, One Dark, Adwaita, Monokai, Solarized, Tokyo Night, Rose Pine, Material, Ayu), favorites, custom lists, image support, encrypted storage, keyboard shortcuts, and more."

#### Full Description (for extensions.gnome.org)
See `EXTENSIONS_GNOME_ORG_DESCRIPTION.md` for the complete description.

### 3. Upload to extensions.gnome.org

1. Go to https://extensions.gnome.org/upload/
2. Log in with your GNOME account
3. Fill in the form:
   - **Name**: ClipMaster
   - **UUID**: clipmaster@gnome.extension
   - **Description**: Use the full description from `EXTENSIONS_GNOME_ORG_DESCRIPTION.md`
   - **Screenshots**: Upload your screenshots
   - **Package**: Upload `clipmaster@gnome.extension.shell-extension.zip`
   - **Category**: Utilities
   - **Tags**: clipboard, clipboard-manager, history, favorites, themes, productivity, keyboard-shortcuts, encryption, images, search, organization
   - **License**: GPL-2.0-or-later
   - **Source Code URL**: https://github.com/sfnemis/ClipMaster

4. Submit for review

### 4. After Submission

- Wait for review (usually 1-3 days)
- Respond to any feedback
- Once approved, your extension will be available on extensions.gnome.org

## Key Features to Highlight

### 12 Beautiful Themes
- Gruvbox (Default)
- Dracula
- Nord
- Catppuccin
- One Dark
- Adwaita
- Monokai
- Solarized Dark
- Tokyo Night
- Rose Pine
- Material Dark
- Ayu

### Core Features
- Unlimited clipboard history
- Image support (Wayland & X11)
- Encrypted storage
- Favorites system
- Custom lists
- Smart search
- Keyboard-first design
- Full customization options

## Testing Before Submission

1. **Test Installation**:
   ```bash
   # Extract and test
   unzip clipmaster@gnome.extension.shell-extension.zip -d /tmp/test
   cp -r /tmp/test/clipmaster@gnome.extension ~/.local/share/gnome-shell/extensions/
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/clipmaster@gnome.extension/schemas/
   gnome-extensions enable clipmaster@gnome.extension
   ```

2. **Test All Features**:
   - Clipboard history tracking
   - Image capture
   - Theme switching
   - Favorites
   - Custom lists
   - Search
   - Keyboard shortcuts
   - Settings panel

3. **Test on Different GNOME Versions** (if possible):
   - GNOME 45
   - GNOME 46
   - GNOME 47

## Logo

The logo is already prepared at:
- `clipmaster@gnome.extension/icons/clipmaster-symbolic.svg`

This is a symbolic icon that will work well in the GNOME panel and extensions website.

## Additional Notes

- The package excludes `gschemas.compiled` - it will be compiled on installation
- All necessary files are included
- The extension follows GNOME Shell extension best practices
- Default theme is set to Gruvbox
- All 12 themes are fully implemented in stylesheet.css

## Support Information

- **GitHub**: https://github.com/sfnemis/ClipMaster
- **Issues**: https://github.com/sfnemis/ClipMaster/issues
- **License**: GPL-2.0-or-later

