<p align="center">
  <img src="clipmaster@gnome.extension/icons/clipmaster-symbolic.svg" width="128" height="128" alt="ClipMaster Logo">
</p>

<h1 align="center">ClipMaster</h1>

<p align="center">
  <strong>A powerful, modern clipboard manager for GNOME Shell 45+</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#screenshots">Screenshots</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/GNOME-45%2B-blue?style=flat-square&logo=gnome" alt="GNOME 45+">
  <img src="https://img.shields.io/badge/License-GPL--2.0-green?style=flat-square" alt="GPL-2.0 License">
  <img src="https://img.shields.io/badge/Platform-Linux-orange?style=flat-square&logo=linux" alt="Linux">
</p>

---

## ✨ Features

### 📋 Clipboard History
- **Unlimited history** - Keep track of everything you copy
- **Text & Images** - Full support for both text and image clipboard content
- **Smart search** - Instantly find any item in your clipboard history
- **Quick paste** - Press 1-9 to instantly paste recent items

### 🎨 Modern UI
- **Beautiful popup** - Clean, modern interface that follows GNOME design guidelines
- **Dark & Light themes** - Automatically adapts or manually choose your preference
- **Draggable window** - Move the popup anywhere on your screen
- **Pin functionality** - Keep the popup open while you work
- **Cursor position** - Popup appears right where your mouse is

### 🔒 Security & Privacy
- **Encrypted database** - Your clipboard history is encrypted by default using XOR encryption
- **Custom storage location** - Choose where to store your clipboard data
- **Skip duplicates** - Optionally prevent duplicate entries

### ⚡ Performance
- **Debounced saves** - Optimized disk writes for better performance
- **Configurable limits** - Set maximum item size, image size, and database size
- **Efficient monitoring** - Low resource usage clipboard monitoring

### 📁 Organization
- **Favorites** - Star important items for quick access
- **Custom lists** - Create your own categories to organize clips
- **Filter by type** - View only text, images, or favorites

### ⌨️ Keyboard-First Design
- Full keyboard navigation
- Customizable global shortcut
- Quick actions with single key presses

---

## 📦 Installation

### Quick Install (Recommended)

```bash
git clone https://github.com/sfnemis/ClipMaster.git
cd ClipMaster
./install.sh
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/sfnemis/ClipMaster.git
```

2. Copy extension to GNOME extensions directory:
```bash
cp -r ClipMaster/clipmaster@gnome.extension ~/.local/share/gnome-shell/extensions/
```

3. Compile the GSettings schema:
```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/clipmaster@gnome.extension/schemas/
```

4. Restart GNOME Shell:
   - **Wayland**: Log out and log back in
   - **X11**: Press `Alt+F2`, type `r`, press Enter

5. Enable the extension:
```bash
gnome-extensions enable clipmaster@gnome.extension
```

### Dependencies

- GNOME Shell 45 or later
- `wl-paste` (for Wayland image support) or `xclip` (for X11)

**Fedora/RHEL:**
```bash
sudo dnf install wl-clipboard xclip
```

**Ubuntu/Debian:**
```bash
sudo apt install wl-clipboard xclip
```

**Arch Linux:**
```bash
sudo pacman -S wl-clipboard xclip
```

---

## 🚀 Usage

### Opening ClipMaster

- **Keyboard shortcut**: Press `Super+V` (default) to open the clipboard popup
- **System tray**: Click the ClipMaster icon in the top panel

### Basic Operations

| Action | How to |
|--------|--------|
| Copy to clipboard | Just copy normally (`Ctrl+C`) - ClipMaster captures it automatically |
| Paste from history | Click an item or press `Enter` on selected item |
| Search | Start typing when popup is open |
| Navigate | Use `↑` `↓` arrow keys |
| Quick paste | Press `1-9` for recent items |

### Popup Controls

| Button | Function |
|--------|----------|
| 📌 Pin | Keep popup open when clicking outside |
| 📝 Text | Toggle plain text mode (strips formatting) |
| ➕ Add | Create a new custom list |
| ✕ Close | Close the popup |

---

## ⌨️ Keyboard Shortcuts

### Global Shortcut
| Shortcut | Action |
|----------|--------|
| `Super+V` | Toggle clipboard popup (customizable) |

### Popup Shortcuts
| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate through items |
| `Enter` | Paste selected item |
| `1-9` | Quick paste (1st to 9th item) |
| `F` | Toggle favorite on selected item |
| `T` | Toggle plain text mode |
| `P` | Toggle pin (keep popup open) |
| `Del` | Delete selected item |
| `Esc` | Close popup |

---

## ⚙️ Configuration

Access settings through:
- **GNOME Extensions app** → ClipMaster → Settings
- **Command**: `gnome-extensions prefs clipmaster@gnome.extension`

### General Settings

| Setting | Description | Default |
|---------|-------------|---------|
| History Size | Maximum number of items to store | 100 |
| Skip Duplicates | Don't add duplicate entries | Enabled |
| Show at Cursor | Open popup at mouse position | Enabled |

### Storage Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Max Item Size | Maximum size per text item (MB) | 1 MB |
| Max Image Size | Maximum size per image (MB) | 5 MB |
| Max DB Size | Maximum total database size (MB) | 50 MB |
| Custom Location | Custom storage directory | ~/.local/share/clipmaster |

### Appearance

| Setting | Description | Default |
|---------|-------------|---------|
| Dark Theme | Use dark color scheme | Enabled |
| Popup Width | Width of the popup window | 450px |
| Popup Height | Height of the popup window | 550px |

### Security

| Setting | Description | Default |
|---------|-------------|---------|
| Encrypt Database | Encrypt clipboard history | Enabled |

### Advanced

| Setting | Description | Default |
|---------|-------------|---------|
| Debug Mode | Enable debug logging | Disabled |

---

## 🖼️ Screenshots

### Clipboard Popup
<p align="center">
  <img src="screenshots/ClipMaster_PopUp.png" alt="ClipMaster Popup" width="400">
</p>

### Settings

<p align="center">
  <img src="screenshots/ClipMaster_Settings.png" alt="Settings - General" width="600">
</p>

<p align="center">
  <img src="screenshots/ClipMaster_Settings2.png" alt="Settings - Behavior" width="600">
</p>

<p align="center">
  <img src="screenshots/ClipMaster_Settings3.png" alt="Settings - Storage" width="600">
</p>

<p align="center">
  <img src="screenshots/ClipMaster_Settings4.png" alt="Settings - Appearance" width="600">
</p>

<p align="center">
  <img src="screenshots/ClipMaster_Settings5.png" alt="Settings - Advanced" width="600">
</p>

---

## 🔧 Troubleshooting

### Extension not loading?

1. Check GNOME Shell version compatibility:
```bash
gnome-shell --version
```

2. View extension logs:
```bash
journalctl -f -o cat /usr/bin/gnome-shell 2>&1 | grep -i clipmaster
```

3. Enable debug mode in settings for detailed logging

### Images not being captured?

Make sure you have the required clipboard tools installed:

```bash
# For Wayland
which wl-paste

# For X11
which xclip
```

### Popup not appearing?

1. Check if the extension is enabled:
```bash
gnome-extensions list --enabled | grep clipmaster
```

2. Try changing the keyboard shortcut in settings

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **GPL-2.0-or-later** License - see the [LICENSE](clipmaster@gnome.extension/LICENSE) file for details.

---

## 🙏 Acknowledgments

- GNOME Shell team for the amazing extension API
- All contributors and users of ClipMaster

---

<p align="center">
  Made with ❤️ for the GNOME community
</p>

<p align="center">
  <a href="https://github.com/sfnemis/ClipMaster/issues">Report Bug</a> •
  <a href="https://github.com/sfnemis/ClipMaster/issues">Request Feature</a>
</p>
