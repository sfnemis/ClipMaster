# Agent log

One entry per finished task, newest first. Facts only.

## 2026-11-28: GitHub brought up to 2.0

**What changed.** The repository was still presenting 1.3.1 to anyone who
visited it, four days after 2.0 was uploaded to extensions.gnome.org. Nothing
was lost: every commit was on origin, and `release/v2.0` had been there at
`51899bd` the whole time. What had not happened was everything else a release
consists of.

- `main` was ten commits behind at `ed30721` and zero ahead, so it was
  fast-forwarded to `51899bd` and pushed. No merge commit.
- Annotated tag `v2.0` created on `51899bd` and pushed. The name matches
  `version-name` in `metadata.json` and the `## 2.0` heading in `CHANGELOG.md`;
  the older tags are inconsistent (`v1.3` and `v1.3.1` both exist) and Sait
  chose `v2.0`.
- GitHub release `v2.0`, titled "ClipMaster 2.0", published as the latest
  release with the 2.0 section of `CHANGELOG.md` as its notes and
  `clipmaster@gnome.extension.zip` attached, 71203 bytes, built by
  `scripts/build.sh` from the tag. Every earlier release carries the same asset
  name.
- The repository description still read "with history, encryption, image
  support", which is the claim 2.0 exists to withdraw. It now reads: "Clipboard
  history for GNOME Shell. Search, favourites, images, QR codes and a private
  mode. There is no network code in it, so nothing leaves your machine. GNOME
  46 to 51, on Wayland and X11." The homepage field, previously empty, now
  points at the extensions.gnome.org page.

**Where it is live.** https://github.com/sfnemis/ClipMaster, `main` and tag
`v2.0` at `51899bd`, release at
https://github.com/sfnemis/ClipMaster/releases/tag/v2.0

**How it was verified.** `git ls-remote` for `main` and the tag, both reporting
`51899bd...`/`67d722b...`; `gh release view v2.0` reporting `draft: false` and
the one asset; `gh repo view` reading back the new description and homepage.
`scripts/build.sh` ran with no "missing" and no "NOT PACKAGED" output and
listed 26 files.

**What is still open.** The GitHub zip is built from `51899bd` and therefore
contains the EGO-A-004 logging change (`ec0de9a`) that the package in review at
extensions.gnome.org, built from `060a684`, does not. No behaviour differs.
Carried over and still by hand, both on extensions.gnome.org: the 2.0 page
screenshot, and the reply to the 2 star review tracked as E2.

**Issues closed.** Sait then asked for the seven open issues to be answered and
closed, which reverses the earlier "wait until 2.0 is public on the site"
decision now that the GitHub release exists. #17, #20, #23, #25, #26, #27 and
#28 are closed as completed, each with a short comment linking the release and
saying that extensions.gnome.org still serves 1.3.1. All seven were already
fixed in 2.0 and already had an explanation from 2026-11-24, so nothing was
re-explained. The comment on #28 states that no test machine here has a hidpi
monitor, so its scale fix is unverified on real hardware, and asks the reporter
to report back. The repository has no open issue now, verified with
`gh issue list --state open --json number --jq 'length'` returning 0.

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
