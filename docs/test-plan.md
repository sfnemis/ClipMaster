# ClipMaster test plan

Three layers, in the order they are cheapest to run.

## 1. Static

```bash
npx eslint .
bash scripts/build.sh
```

The build refuses to produce a package if a file in the source tree is neither
packaged nor listed as deliberately left out, so a new file cannot be forgotten
in either direction.

## 2. Unit checks

```bash
gjs -m tests/run-tests.js
```

Runs under plain `gjs`, so it works on any machine with GNOME installed and
needs no session. It covers the stored format, including a database written by
1.3.1 and text containing emoji; the signal and timeout bookkeeping; hashing;
atomic writes and their file permissions; code detection; the paste shortcut
choice; and the settings migration.

Every asynchronous Gio call in the extension is wrapped by hand in
`src/Util/Utils.js` rather than awaited directly. GNOME Shell promisifies a
list of those calls for its own code and plain `gjs` does not, so without the
wrappers these checks could not run outside the shell at all.

## 3. Live checks against a real GNOME session

```bash
bash scripts/live-test.sh      # behaviour, asserted against the stored history
bash scripts/live-ui-test.sh   # the popup itself, needs scripts/test-harness
```

Both begin with a calibration step, because an automation harness reports on
itself as well as on the thing it is testing:

- `live-test.sh` refuses to run unless the extension is ACTIVE, and stops if the
  helper that puts text on the clipboard did not actually take ownership of it.
- `live-ui-test.sh` makes the harness return a value known in advance and makes
  it report a thrown error, and compares a screenshot of the screen with the
  popup open against one with it closed.

Three things on the machine under test will make every check fail for reasons
that have nothing to do with ClipMaster:

- **A locked screen.** GNOME Shell disables every user extension in
  `unlock-dialog` mode. Turn off `org.gnome.desktop.screensaver lock-enabled`
  and set `org.gnome.desktop.session idle-delay` to 0.
- **The Activities overview.** A session that has just logged in opens in it, no
  window has the focus, and a Wayland client cannot take the clipboard without
  a focus serial.
- **A stale install.** GNOME Shell keeps the extension's modules loaded for the
  life of the session, so installing a new version and toggling it off and on
  runs the old code. Restart the session after installing.

## What is covered where

| Area | Layer |
|------|-------|
| Stored format, old and new, including emoji | unit |
| A 1.3.1 database still reading back | unit |
| Signals and main loop sources released | unit |
| File permissions on the history and the key | unit and live |
| Clipboard capture, text and images | live |
| Excluded applications and private mode | live |
| Duplicates and identifier uniqueness | live |
| A damaged history never being overwritten | live |
| Turning obfuscation on and off without loss | live |
| The popup opening, closing, sizing, position | live UI |
| Keyboard navigation and pasting | live UI |
| The global shortcut, with real key events | live UI |
| Actors released when the extension is disabled | live UI |

## What still needs a person

- The preferences window beyond opening it: the file choosers, import and
  export, and the dialogs they raise.
- Multi-monitor and HiDPI, which neither virtual machine has.
- X11. Both machines run Wayland.
- Dash to Panel with auto hide, which issue #18 was about.
- Pasting into a real application, where the synthetic paste shortcut has to
  reach the window that had the focus.
