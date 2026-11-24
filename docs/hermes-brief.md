# ClipMaster brief

Living document. What the product is, what has shipped, where it stands today.
Last updated 2026-11-24.

## What it is

ClipMaster is a clipboard history for GNOME Shell, written in GJS. It keeps
what the user copies so they can get it back later: text, links, colours, code
and images. Everything stays on the machine. There is no network code in it,
no telemetry, and no account.

- Repository: https://github.com/sfnemis/ClipMaster (public)
- Published at: https://extensions.gnome.org/extension/8923/clipmaster/
- License: GPL-2.0-or-later. The QR encoder is derived from Project Nayuki's
  MIT-licensed library and carries its notice.
- Author: Sait Firat NEMIS
- Price: free. Donations through GitHub Sponsors, Ko-fi and Buy Me a Coffee.

## Platforms

A GNOME Shell extension only. Version 2 declares GNOME Shell 46 to 51, on
Wayland and X11. GNOME 45 was dropped because one St API it uses only behaves
correctly from 46. There is no macOS, Windows, KDE or iOS version and none is
planned.

## State today

Live on extensions.gnome.org: **1.3.1**, 5723 downloads, 36 stars and 6 forks
on GitHub.

Uploaded and waiting for review: **2.0**, sent by Sait on 2026-11-24. The
package is `build/clipmaster@gnome.extension.shell-extension.zip`, built by
`scripts/build.sh` from `release/v2.0`. It is verified on two virtual machines,
Ubuntu 26.04 with GNOME Shell 50.1 and Fedora 45 with GNOME Shell 51.1, with
104 unit checks, 27 behaviour checks and 24 interface checks passing on each.

The site's automated checker raised two items on the upload and neither blocks
approval: a manual review note about reading the clipboard directly, which is
what the extension is for and which the description declares, and a warning
about seven failure messages in one file against a threshold of five. The
second is already fixed on the branch and deliberately held back for the next
version, because it changes no behaviour and replacing a package during review
costs the queue position.

Until that review passes, 1.3.1 is what users get. Describe ClipMaster by what
1.3.1 does only where the difference matters; everything in the 2.0 section
below is real, tested and submitted, but not yet public.

## What shipped when

**2.0, uploaded 2026-11-24, in review.** A correctness and honesty
release. The popup did not open at all on GNOME 50 and 51. Any failure reading
the stored history silently replaced it, which is how users lost their history.
The excluded applications list had no effect. The preferences window claimed
AES-256 encryption that the code never implemented. Shipped keyboard shortcuts
broke terminal paste and are now empty by default, which the review guidelines
require. New in this release: private mode, pinned items, a fixed popup
position, a resize handle, display-scale aware sizing, and a confirmation before
clearing the history. Full detail in `CHANGELOG.md` and `docs/feature-requests.md`.

**1.3.1.** Current public release. Added a fix for the popup disappearing with
Dash to Panel auto hide, and a merged contribution improving the Wayland paste
flow after selection.

**1.3.** Pinned lists, a code category, light themes, tooltips and image
thumbnails.

**1.2.x.** Review feedback from the GNOME Extensions team, multi-monitor
support, search behaviour fixes, and the preferences dialog launching from the
panel menu.

## Features

Clipboard history for text, links, colours, code snippets and images with
thumbnails. Search, favourites, pinned items and custom lists. Private mode and
a per-application exclusion list. A QR code view for sharing an entry with a
phone. Twelve themes or follow the system light and dark setting. A resizable
popup that can open at the pointer or at a fixed screen position. Optional
obfuscation of the stored history file.

## Things that change how ClipMaster should be described

- **It does not come with a keyboard shortcut.** This is deliberate and
  required by the GNOME Extensions review guidelines for any extension that
  reads the clipboard. Never describe a default shortcut.
- **The storage feature is obfuscation, never encryption.** The key is stored
  next to the data. Anything that calls it encryption, or names a cipher, is
  wrong. Versions up to 1.3.1 made that mistake in their own preferences window.
- **Nothing is sent anywhere.** There is no network code, no telemetry and no
  account. This is worth saying plainly wherever ClipMaster is described,
  because it is the first question people ask about a clipboard manager.
- **It has no dependencies.** Older documentation asked for `wl-clipboard` and
  `xclip`. No version has ever used them.
- **A copy that is both text and a picture is kept as text.** Spreadsheets,
  note applications and drawing canvases offer both at once. Up to 1.3.1
  ClipMaster took the picture and discarded the text.

## Open items

- Issue #18, the popup and Dash to Panel with auto hide, is unverified: neither
  test machine has Dash to Panel installed.
- X11, multi-monitor and HiDPI hardware are untested; both test machines are
  single-monitor Wayland at scale 1.
- No translations are shipped. Every string is marked for translation, so this
  is a packaging job rather than a code one.
- The preferences file choosers, import and export have no automated coverage.
- A reviewer on extensions.gnome.org reported a chosen theme reverting to the
  default dark one. It was not reproduced and is waiting on more detail.
