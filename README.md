# ClipMaster

Clipboard manager for GNOME Shell 45+

![Screenshot](screenshots/ClipMaster_PopUp.png)

## Features

- Clipboard history (text, images, files, URLs)
- Follows system dark/light theme by default
- Optional themes: Adwaita, Catppuccin, Dracula, Nord, Gruvbox, etc.
- Search, favorites, custom lists
- Encrypted local storage
- Works on Wayland and X11

## Installation

```bash
git clone https://github.com/sfnemis/ClipMaster.git
cd ClipMaster
./install.sh
```

Then restart GNOME Shell (log out/in on Wayland) and enable the extension.

### Dependencies

Wayland needs `wl-clipboard`, X11 needs `xclip`:

```bash
# Fedora
sudo dnf install wl-clipboard xclip

# Ubuntu/Debian
sudo apt install wl-clipboard xclip

# Arch
sudo pacman -S wl-clipboard xclip
```

## Usage

Press `Super+V` to open. Start typing to search.

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate |
| `Enter` | Paste |
| `1-9` | Quick paste |
| `Alt+F` | Toggle favorite |
| `Alt+T` | Plain text mode |
| `Alt+P` | Pin popup |
| `Alt+D` | Delete |
| `Esc` | Close |

## Settings

Open with: `gnome-extensions prefs clipmaster@gnome.extension`

- **Follow System Theme**: Uses Adwaita and follows your dark/light preference (default: on)
- **Theme**: Manual theme selection when not following system
- **History Size**: Up to 5000 items
- **Encryption**: On by default

## License

GPL-2.0-or-later
