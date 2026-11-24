# Agent log

One entry per finished task, newest first. Facts only.

## 2026-11-24: ClipMaster 2.0 prepared, audited and verified

**What changed.** A full audit of the published 1.3.1 against the
extensions.gnome.org review guidelines and the GNOME 49, 50 and 51 porting
notes, followed by the fixes. Roughly 45 findings, all recorded in
`docs/feature-requests.md` with their status. The ones that matter most:

- The popup never opened on GNOME 50 or 51. `Main.layoutManager.addChrome` was
  called with `affectsInputRegion`, which GNOME 50 removed, so the call threw.
  This is what issue #27 was reporting.
- `SignalManager` never disconnected anything, on any GNOME version, because it
  guarded every disconnect with `object.handler_is_connected`, which GJS does
  not define on a GObject instance. Every signal leaked on every disable.
- Any failure reading the stored history ended with an empty history that the
  next copy wrote over the real one. Turning the obfuscation switch off was
  enough to cause it. Most likely cause of issue #20.
- The excluded applications list was read only by the preferences window, so it
  had no effect at all. Issue #25.
- The preferences window said the history was encrypted with AES-256. The code
  is a repeating-key XOR with the key stored next to the data. Sait chose to
  rename the feature to obfuscation and describe it honestly rather than attempt
  real encryption, which GJS cannot offer without a helper process the review
  guidelines discourage.
- The stored format corrupted emoji, and two items could share an identifier.
- Default keyboard shortcuts were shipped, which the guidelines forbid for an
  extension that reads the clipboard, and one of them took `Ctrl+Shift+V` away
  from every terminal.

Features added: private mode, pinned items, a fixed popup position, a resize
handle, display-scale aware sizing, a click-outside setting, and a confirmation
before clearing the history.

**Where it is.** Not published. `build/clipmaster@gnome.extension.shell-extension.zip`
is the candidate package, 26 files, built by `scripts/build.sh` from an explicit
file list. Version name 2.0, `shell-version` 46 to 51. The repository is public
at https://github.com/sfnemis/ClipMaster.

**How it was verified.** On the exact source that produces the package.

| Layer | Ubuntu 26.04, GNOME Shell 50.1 | Fedora 45, GNOME Shell 51.1 |
|-------|-------------------------------|------------------------------|
| ESLint | clean | clean |
| Unit checks | 104 pass | 104 pass |
| Live behaviour | 27 pass | 27 pass |
| Live interface | 24 pass | 24 pass |

Both machines run Wayland. The live checks assert against the stored history
file rather than against screenshots, and the interface checks drive the real
popup inside GNOME Shell through a development-only harness extension, compare
screenshots of the screen with the popup open and closed, and send real key
events for the global shortcut. The preferences window was opened and walked
page by page with synthetic clicks, and the shortcut capture dialog was driven
end to end: pressing Super+Shift+V wrote `['<Shift><Super>v']` to the setting.

**After the upload.** The extensions.gnome.org checker raised two items on the
submitted package. One is a manual review note about reading the clipboard
directly, which is what the extension is for and which the description
declares, so nothing changes. The other is a warning that `Database.js` holds 7
ungated console calls against a threshold of 5; those are all failure reports,
so they were routed through one reporter in `Constants.js` rather than removed.
That change is commit `ec0de9a`, verified on both machines on 2026-11-25 with
the full set of checks passing. It is not in the uploaded package; the advice
was to leave the submission alone, because the item is a warning rather than a
rejection and swapping the package during review costs the queue position.

A third machine, `xfn@192.168.10.189`, turned out to be EndeavourOS running KDE
Plasma, with neither gnome-shell nor gjs installed. ClipMaster cannot run there
at all, so it was left alone.

**What is still open.** Issue #18 needs Dash to Panel, which neither machine
has. X11, multi-monitor, HiDPI hardware and the preferences file choosers are
not covered by any automated check. Translations are not shipped. All of this is
listed under G in `docs/feature-requests.md`.

**Issue replies.** With Sait's approval, a comment was posted on #17, #20, #21,
#23, #25, #26, #27 and #28, each naming what was actually wrong rather than
only saying it is fixed. No issue was closed; that waits until 2.0 is public.

**The 2 star review on extensions.gnome.org.** Checked against the code rather
than answered from memory. Three of its four complaints were real defects and
are fixed: the panel icon switch did nothing until a restart, the plain text
paste shortcut kept its own default so the terminal and LibreOffice conflict
survived changing the main shortcut, and a copy offered as both text and a
picture was stored as the picture, throwing the text away. That last one now
keeps the text, with `prefer-image-over-text` to reverse it, and has two live
checks. The fourth, a chosen theme reverting to the default dark one, was not
reproduced; `follow-system-theme` overriding the choice fits the symptom and
the theme list is insensitive while that switch is on, so the override is at
least visible now. Tracked as E2.4 and G5.

**Uploaded.** Sait uploaded the package to extensions.gnome.org himself at
21:05 on 2026-11-24 and it is waiting for review. The submitted zip was
extracted and compared file by file against a rebuild of the same source: no
difference, so what is in review is exactly `release/v2.0`. The page screenshot
is still the one from 1.2.1 and has to be uploaded separately, since it does
not come from `metadata.json`; the description does, so it updates itself when
the review passes.
