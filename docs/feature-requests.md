# ClipMaster tracked list

Newest section first. Every reported bug, feature request and audit finding
lands here before any code is written.

Published extension: https://extensions.gnome.org/extension/8923/clipmaster/
Repository: https://github.com/sfnemis/ClipMaster (public, 36 stars, 6 forks)
Live version on EGO: 1.3.1, 5723 downloads.

Test machines:

| Host | Address | OS | GNOME Shell | Session |
|------|---------|----|-------------|---------|
| ubuntu | xfn@192.168.10.184 | Ubuntu 26.04.1 LTS | 50.1 | Wayland |
| fedora | sfn@192.168.10.160 | Fedora Linux 45 Workstation | 51.1 | Wayland |

## Version 2, 2026-11-24

Everything below was found by auditing 1.3.1 against the extensions.gnome.org
review guidelines and the GNOME 49, 50 and 51 porting notes, then by running
the extension on both machines.

### A. Review blockers, all fixed

- **A1 FIXED. Shipped default keyboard shortcuts for clipboard actions.**
  The guidelines forbid them for an extension that reads the clipboard. 1.3.1
  shipped `<Shift><Super>v` and `<Ctrl><Shift>v`. Both defaults are now empty
  and the preferences window captures a shortcut from a key press. Closes #16
  and #23.
- **A2 FIXED. Main loop sources outliving `disable()`.** The two `GLib.timeout_add`
  calls in `extension.js` went through no manager. They are in a `TimeoutManager`
  now and `disable()` removes every source.
- **A3 FIXED. Per-row paste timeouts bypassed the timeout manager** and could
  fire against a row that `_loadItems()` had already destroyed, pasting whatever
  had taken its place.
- **A4 FIXED. The preferences window claimed AES-256.** See C1.
- **A5 FIXED. `metadata.json` set `version`.** Removed; EGO assigns it.
- **A6 FIXED. `shell-version` stopped at 49.** Now 46 to 51. GNOME 45 is dropped
  because `St.ScrollView.add_child` only behaves correctly from 46.
- **A7 FIXED. `gettext-domain` was declared with no translations shipped.**
  The key is gone. Translations are F7.
- **A8 FIXED. The package could carry files the guidelines call unnecessary.**
  `scripts/build.sh` assembles the zip from an explicit list of 26 files and
  reports anything in the source tree that is neither packaged nor deliberately
  excluded. `tests/` moved out of the extension directory entirely.
- **A9 FIXED. The MIT notice for the QR encoder was incomplete.** The full
  Project Nayuki notice is now in `src/Util/QrCodeGenerator.js`.
- **A10 FIXED. Clipboard access is now declared explicitly** in the description,
  along with the fact that nothing leaves the machine.
- **A11 FIXED. `addChrome` threw on GNOME 50 and later, so the popup never
  opened at all.** `affectsInputRegion` was a valid parameter up to GNOME 49 and
  was removed in 50, where `Params.parse` rejects it. This, and not the error in
  D2, is what issue #27 was really reporting. Found by driving the popup from
  inside the shell; nothing in the journal pointed at it.
- **A12 FIXED. `St.BoxLayout.vertical` was removed in GNOME 51.** Every box in
  the popup used it. The property is now chosen from what the running shell has,
  since `orientation` does not exist before GNOME 48.
- **A13 FIXED. `Clutter.get_default_backend()` was removed in GNOME 51**, which
  broke the synthetic paste. The backend now comes from the stage context, with
  the old call as a fallback.
- **A14 FIXED. Emoji used as icons and leftover drafting comments.** The
  guidelines' best practices page asks for neither. Comments such as
  "lists and import/export methods remain mostly same but logging fixed" are
  gone.

### B. Data loss and privacy, all fixed

- **B1 FIXED. A load failure replaced the whole history.** Any unreadable file,
  including the one produced by simply turning the obfuscation switch off, ended
  with an empty `_items` and the next copy wrote that over the stored history.
  ClipMaster now refuses to write after a failed read, keeps a timestamped copy
  of the unreadable file and says so in a notification. Most likely cause of #20.
- **B2 FIXED. The final save raced with shutdown.** `destroy()` started an
  asynchronous write and did not wait. There is a synchronous flush now, and
  writes go through a temporary file and a rename, with one generation kept as
  `clipboard.json.bak`.
- **B3 FIXED. The excluded applications list did nothing.** Nothing outside
  `prefs.js` ever read it. Closes #25.
- **B4 FIXED. Clearing the history left every image file on disk.** Images are
  deleted with their items, and orphans left by earlier versions are swept on
  load.
- **B5 FIXED. Content hashing used a 32 bit hash**, where a collision silently
  discarded a distinct entry. SHA-256 now.
- **B6 FIXED. The stored format corrupted emoji.** The XOR ran over UTF-16 code
  units, so a surrogate pair became U+FFFD and could not be recovered. The new
  format works on UTF-8 bytes; the old one is still read so existing databases
  survive the upgrade.
- **B7 FIXED. Two items could share an identifier.** Anything copied while the
  history was still loading took an identifier from a counter that had not seen
  the stored items yet, so deleting one item removed another. Identifiers are
  now assigned after the load, and the monitor does not start until then.
- **B8 FIXED. An excluded application's copy was recorded anyway.** One copy
  produces several selection events, and the ones after the first arrive once
  the source application has lost the focus, so they were credited to whatever
  window was focused by then. Found on Fedora, where a second window was open;
  it passed on Ubuntu only because the desktop was empty. Refusal is now by
  content fingerprint and a short time window, not by focus alone.

### C. Security

- **C1 FIXED by telling the truth.** `src/Util/Encryption.js` was a repeating
  32 byte XOR keyed from `Math.random()`, with the key stored in the clear next
  to the database, and the preferences window called it AES-256. The feature is
  now named obfuscation everywhere, in the preferences window, the schema
  descriptions and the README, with a plain statement that anyone who can read
  the file can recover its contents. The key comes from the system random source
  instead of `Math.random()`. Sait chose this over attempting real encryption,
  which GJS cannot offer without a helper process the guidelines discourage.
- **C2 FIXED. Decryption swallowed its errors and returned an empty string**,
  which is what turned a failed read into B1. It throws now.
- **C3 FIXED. Stored files were created with default permissions.** The history,
  the key and the image directory are owner-only.

### D. Correctness and performance, all fixed

- **D1 FIXED. `SignalManager` never disconnected anything.** It guarded every
  disconnect with `object.handler_is_connected`, which GJS does not define on a
  GObject instance, so the guard was always false. Measured on both machines:
  `typeof settings.handler_is_connected` is `undefined` on GJS 1.88 and 1.90.
  Every signal the extension connected leaked on every disable. This is the
  single root cause behind #27, #21 and #2.
- **D2 FIXED. `_updateCachedSetting` was not null safe**, the error in #27. The
  cached-settings layer it depended on is gone; settings are read through a
  cache that invalidates itself.
- **D3 FIXED. Enforcing the size limit froze the desktop.** It re-serialized and
  re-encoded the entire database once per removed item, up to a thousand times,
  on the compositor thread. It estimates from each item's own length now.
- **D4 FIXED. The QR dialog built one actor per module**, up to about 9400. It
  is drawn once with Cairo.
- **D5 FIXED. `TimeoutManager.remove()` was called with a GLib source id**
  instead of a tracking name, so it removed nothing.
- **D6 FIXED. The popup position was clamped to a 10000 pixel box** and to
  non-negative coordinates, which breaks on some monitor layouts. It is clamped
  to the monitor the pointer is on.
- **D7 FIXED. The schema and the code disagreed about the popup size range.**
- **D8 FIXED. Code items showed the plain text icon.**
- **D9 FIXED. Dead code removed**: `Database.exportData` and `importData`,
  `QrCodeGenerator.toSvg`, `ImageStorage.getStats`, an ignored `format`
  parameter, and a thumbnails directory that was created but never written to.
- **D10 FIXED. Debug logging was invisible.** It used `console.debug`, which
  journald drops unless asked for it, while the preferences window gave a
  command that would never show it.
- **D11 FIXED. The preferences window would not open at all.** Calling the
  gettext helper at module scope throws "gettext can only be called from
  extensions". Found by opening the window on a machine, not by reading the code.
- **D12 FIXED. The shortcut rows showed nothing.** The label was built and never
  added to the row, and `Gtk.ShortcutLabel` draws nothing when it has no
  accelerator.
- **D13 FIXED. The README asked for `wl-clipboard` and `xclip`** for image
  pasting. No version of ClipMaster has ever called either one.
- **D14 FIXED. `setup-shortcut.sh` contained the four characters `vvvd`** and
  `verification_artifact.txt` held three lines of notes. Both removed.
- **D15 FIXED. `Gtk.MessageDialog` and `Adw.MessageDialog`**, both deprecated,
  are replaced by `Adw.AlertDialog`.
- **D16 FIXED. The preferences window edited the history file behind the running
  extension's back**, then asked the user to reload it by hand. It raises a
  counter the extension watches instead.

### E. GitHub issues

| # | Title | Status | Where |
|---|-------|--------|-------|
| 28 | Popup is tiny on a HiDPI monitor, no drag handle | FIXED | F1 |
| 27 | GNOME 50 compatibility | FIXED | A11, A6, D1, D2 |
| 26 | Option to always open at a fixed position | FIXED | F2 |
| 25 | Excluded applications still recorded | FIXED | B3, B8 |
| 23 | `Shift+Ctrl+V` breaks terminal paste | FIXED | A1 |
| 20 | History blank after logout and login | FIXED | B1, B2 |
| 17 | Dismiss when clicking outside | FIXED | F3 |
| 21 | Primary selection always tracked | FIXED | D1, and it is off by default now |
| 19 | Enter copies but does not paste on Wayland | FIXED | A13 kept it working on 51 |
| 18 | Popup vanishes with Dash to Panel auto hide | OPEN to verify | needs Dash to Panel, not installed on either machine |
| 16 | Change the default plain text paste shortcut | FIXED | A1 |

### E2. The 2 star review on extensions.gnome.org, from huesosdebrasa on Fedora 43

Four complaints, checked one by one against the code.

- **E2.1 FIXED. The panel icon could not be turned off.** `show-indicator` was
  read once in `enable()` and nothing watched it, so the switch did nothing
  until the session restarted. It adds and removes the indicator live now.
- **E2.2 FIXED. A shortcut conflict survived changing the shortcut.** The
  reviewer set the popup to `Super+Shift+V` and still lost `Ctrl+Shift+V` in
  LibreOffice, because that was the *second* shortcut, "paste as plain text",
  which kept its own default. Both ship empty now. Same root cause as #16 and
  #23.
- **E2.3 FIXED. A copy was stored as a picture when it was also text.**
  Copying canvas elements in Obsidian stored a rendered image instead of the
  text. `_checkForImage` took the image whenever any `image/*` flavour was on
  offer, and applications that offer both are common: spreadsheets, note
  applications, drawing canvases. Text now wins when `text/plain` is offered
  beside the image, with `prefer-image-over-text` to reverse it. A real image
  copy offers no `text/plain` and is unaffected.
- **E2.4 OPEN, partly addressed. A chosen theme reverts to the default dark
  one.** `follow-system-theme` defaults to on and overrides the theme choice,
  which fits the symptom, but the exact sequence the reviewer described was not
  reproduced. In version 2 the theme list is insensitive while the follow
  switch is on, so the override is visible rather than silent. Needs the
  reviewer to say whether it still happens.

### F. Features added in version 2

- **F1 FIXED. HiDPI and resizing.** The stored size is in logical pixels and is
  multiplied by the display scale factor, the range goes to 2400 by 2000, and
  there is a drag handle in the bottom right corner that stores the new size.
  Closes #28.
- **F2 FIXED. Fixed popup position.** At the pointer, the middle of the monitor,
  or any of its edges and corners. Closes #26.
- **F3 FIXED. Click outside behaviour is a setting**, with its own grace period,
  down from a fixed 1000 ms to 250 ms. Closes #17.
- **F4 FIXED. Private mode.** A switch in the panel menu, a button in the popup,
  an optional shortcut, a banner in the popup and a changed panel icon while it
  is on.
- **F5 FIXED. Clearing the history asks first**, from the panel menu and from
  the preferences window, and says how many items will go.
- **F6 FIXED. Items can be pinned to the top of the list**, separately from
  favourites.
- **F7 OPEN. Translations.** No locales are shipped and `gettext-domain` is not
  declared. Every string is marked, so this is a packaging job, not a code one.

### G. Open

- **G1 OPEN. Issue #18, Dash to Panel with auto hide.** The workaround from
  1.3.1 is still in place and still looks right, but neither test machine has
  Dash to Panel installed, so it has not been exercised.
- **G2 OPEN. X11.** Both machines run Wayland.
- **G3 OPEN. Multi-monitor and HiDPI on real hardware.** The code reads the
  scale factor and picks the monitor the pointer is on; both machines report a
  single monitor at scale 1.
- **G4 OPEN. The preferences file choosers, import and export** are not covered
  by any automated check.
- **G5 OPEN. E2.4, the theme reverting to the default dark one.** Not
  reproduced; waiting on the reviewer.

## Release

Uploaded to extensions.gnome.org by Sait on 2026-11-24 at 21:05, waiting for
review. The submitted zip matches a rebuild of `release/v2.0` at `060a684` file
by file. Still to do by hand: upload the new page screenshot, post the two
drafted comments, merge the branch and close the issues once 2.0 is public.

### H. The automated check on the 2.0 submission

extensions.gnome.org ran its own checker on the uploaded package and raised two
items.

- **H1 NO CHANGE NEEDED. EGO-A-005, manual review: "extensions should not
  access the clipboard directly".** It flags `St.Clipboard.get_default()` at
  `src/Manager/ClipboardMonitor.js:37`. Reading the clipboard is what a
  clipboard manager is, the review guidelines allow it provided the description
  declares it, and the description does. This is a note for the human reviewer,
  not a defect.
- **H2 FIXED. EGO-A-004, warning: 7 ungated console calls in
  `src/Manager/Database.js` against a threshold of 5.** Every message was a
  genuine failure report, so none were removed; they now go through
  `reportError` and `reportWarning` in `Constants.js`, which also writes the
  `ClipMaster` prefix that each call site repeated by hand. Database.js has
  none at the call sites and Constants.js has three. One message, a failed
  delete of a stored image, was downgraded to debug output because the sweep on
  the next load clears what is left behind.

  Verified on 2026-11-25 on both machines after the fix: 104 unit checks, 27
  behaviour checks and 24 interface checks pass on each, ESLint clean. The
  uploaded package does not contain this change.

### I. Decision on the submitted package

Leave it alone. Neither checker item is a rejection, the A-004 fix changes no
behaviour, and replacing a package while it is in the queue costs the position.
The fix ships in the next version. Sait asked twice whether he had to upload
again; the answer recorded here is no.

## Verification

Run on the exact source that produces the package.

| Layer | Ubuntu 26.04, GNOME 50.1 | Fedora 45, GNOME 51.1 |
|-------|--------------------------|------------------------|
| ESLint | clean | clean |
| Unit, `tests/run-tests.js` | 104 checks pass | 104 checks pass |
| Live behaviour, `scripts/live-test.sh` | 27 pass | 27 pass |
| Live interface, `scripts/live-ui-test.sh` | 24 pass | 24 pass |

## Process notes

- The screen lock disables every user extension, because the session enters
  `unlock-dialog` mode. A test run against a locked session reports the
  extension as doing nothing. Both machines now have the lock turned off.
- A session that has just logged in opens in the Activities overview, where no
  window holds the focus, and a Wayland client cannot take the clipboard
  without a focus serial. The clipboard helper reads the clipboard back to
  prove it owns it before the checks trust anything that follows.
- GNOME Shell keeps an extension's modules loaded for the life of the session,
  so a new version needs a session restart, not a disable and enable.
- `scripts/test-harness` runs scripts inside the shell process, which is the
  only way to drive the popup or take a screenshot from a script. It is an
  arbitrary code execution service and belongs only on a throwaway machine.
