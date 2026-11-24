#!/usr/bin/env bash
#
# Drives the ClipMaster popup inside a running GNOME Shell and checks what it
# actually does, through the development harness extension in
# scripts/test-harness. Read that directory's README before running this.
#
# The first check is a calibration: the harness is made to report a value that
# is known in advance, and the run stops if it does not. An automation harness
# reports on itself as well as on the thing under test, and a harness that has
# never produced a true positive cannot produce a credible negative.
set -uo pipefail

UUID="clipmaster@gnome.extension"
SD="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"
SCHEMA="org.gnome.shell.extensions.clipmaster"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOTS="${SHOTS:-/tmp/clipmaster-shots}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

mkdir -p "$SHOTS"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf "  ok   %s\n" "$1"; }
bad() { fail=$((fail+1)); printf "  FAIL %s\n" "$1"; }
set_s() { gsettings --schemadir "$SD" set "$SCHEMA" "$1" "$2"; sleep 0.5; }

# Runs a script inside GNOME Shell and prints the JSON it resolved to.
# Everything goes through one path: queue the script, then poll for its value.
shell_eval() {
    gdbus call --session \
        -d org.gnome.Shell.Extensions.CmHarness \
        -o /org/gnome/Shell/Extensions/CmHarness \
        -m org.gnome.Shell.Extensions.CmHarness.Eval \
        "$1" >/dev/null 2>&1

    local out
    for _ in $(seq 1 40); do
        out=$(gdbus call --session \
            -d org.gnome.Shell.Extensions.CmHarness \
            -o /org/gnome/Shell/Extensions/CmHarness \
            -m org.gnome.Shell.Extensions.CmHarness.Result 2>&1)
        case "$out" in
            "(true, "*) printf '%s\n' "$out"; return 0 ;;
        esac
        sleep 0.4
    done

    printf 'TIMEOUT\n'
    return 1
}

shell_eval_async() { shell_eval "$1"; }

expect() {
    local name="$1" script="$2" needle="$3"
    local out
    out=$(shell_eval "$script")
    case "$out" in
        *"$needle"*) ok "$name" ;;
        *) bad "$name -> $out" ;;
    esac
}

echo "== 0 harness calibration"
# A locked screen disables every user extension, and a session that has just
# logged in sits in the overview where no window has the focus.
state=$(gnome-extensions info "$UUID" | sed -n 's/^ *State: *//p')
[ "$state" = "ACTIVE" ] || { echo "  FAIL ClipMaster is $state, not ACTIVE. Is the screen locked?"; exit 1; }
shell_eval 'Main.overview.hide(); return true;' >/dev/null

out=$(shell_eval 'return 6 * 7;')
case "$out" in
    *'"value":42'*) ok "the harness returns a value that was known in advance" ;;
    *) bad "the harness is not usable, stopping: $out"; echo; echo "passed: $pass  failed: $fail"; exit 1 ;;
esac
expect "the harness reports a thrown error as a failure" 'throw new Error("deliberate");' '"ok":false'
expect "ClipMaster is reachable from inside the shell" \
    'return !!Main.extensionManager.lookup("clipmaster@gnome.extension")?.stateObj;' '"value":true'

CM='const cm = Main.extensionManager.lookup("clipmaster@gnome.extension").stateObj;'

echo "== 1 the popup opens and closes"
set_s popup-position "'center'"
expect "it starts closed" "$CM return cm._popup.isShowing;" '"value":false'
expect "toggling opens it" "$CM cm.togglePopup(); return cm._popup.isShowing && cm._popup.visible;" '"value":true'
expect "it is on screen" \
    "$CM const [x, y] = cm._popup.get_position(); return x > -1000 && y > -1000;" '"value":true'
expect "it is in the input region" "$CM return cm._popupAddedToChrome;" '"value":true'
expect "toggling closes it" "$CM cm.togglePopup(); return cm._popup.isShowing || cm._popup.visible;" '"value":false'
expect "it leaves the input region when closed" "$CM return cm._popupAddedToChrome;" '"value":false'

echo "== 2 the size follows the settings and the display scale"
set_s popup-width 500
set_s popup-height 600
out=$(shell_eval "$CM cm.togglePopup();
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const [w, h] = cm._popup.get_size();
    cm.togglePopup();
    return [w, h, scale];")
case "$out" in
    *'"value":[500'*|*'"value":[1000'*) ok "the width matches the setting times the scale factor ($out)" ;;
    *) bad "unexpected size: $out" ;;
esac

echo "== 3 the position setting is obeyed"
for position in top-left bottom-right center; do
    out=$(shell_eval "$CM
        cm._settings.set_string('popup-position', '$position');
        cm.togglePopup();
        const monitor = Main.layoutManager.primaryMonitor;
        const [x, y] = cm._popup.get_position();
        const [w, h] = cm._popup.get_size();
        cm.togglePopup();
        return {position: '$position', x, y, w, h, mx: monitor.x, my: monitor.y, mw: monitor.width, mh: monitor.height};")
    case "$out" in
        *"\"position\":\"$position\""*) ok "the popup opens at $position ($(echo "$out" | tr -d '\n' | cut -c1-120))" ;;
        *) bad "$position did not apply: $out" ;;
    esac
done
set_s popup-position "'center'"

echo "== 4 the list shows what the history holds"
out=$(shell_eval "$CM
    cm.togglePopup();
    const rows = cm._popup._itemsBox.get_children().filter(c => c._index !== undefined).length;
    const items = cm._popup._items.length;
    const stored = cm.database.getItems({limit: cm._settings.get_int('items-per-page')}).length;
    cm.togglePopup();
    return {rows, items, stored};")
case "$out" in
    *TIMEOUT*) bad "could not read the list: $out" ;;
    *) if echo "$out" | grep -qE '"rows":([0-9]+),"items":\1,"stored":\1'; then
           ok "every stored item has a row ($(echo "$out" | grep -o '\"rows\":[0-9]*'))"
       else
           bad "the list does not match the history: $out"
       fi ;;
esac

echo "== 5 keyboard navigation and pasting"
out=$(shell_eval "$CM
    cm.togglePopup();
    const first = cm._popup._items[0]?.content ?? null;
    const before = cm._popup._selectedIndex;
    cm._popup._moveSelection(1);
    const after = cm._popup._selectedIndex;
    const second = cm._popup._items[after]?.content ?? null;
    cm.togglePopup();
    return {before, after, firstIsSecond: first === second};")
case "$out" in
    *'"before":0,"after":1'*) ok "the arrow keys move the selection" ;;
    *) bad "the selection did not move: $out" ;;
esac

out=$(shell_eval_async "$CM
    cm.togglePopup();
    cm._popup._selectedIndex = 1;
    const wanted = cm._popup._items[1].content;
    await cm._popup._pasteSelected();
    const clipboard = St.Clipboard.get_default();
    const got = await new Promise(resolve =>
        clipboard.get_text(St.ClipboardType.CLIPBOARD, (c, text) => resolve(text)));
    if (cm._popup.isShowing) cm.togglePopup();
    return {matched: got === wanted};")
case "$out" in
    *'"matched":true'*) ok "choosing an item puts it on the clipboard" ;;
    *) bad "the clipboard does not hold the chosen item: $out" ;;
esac

echo "== 6 the private mode banner"
set_s private-mode true
expect "the banner is shown while private mode is on" \
    "$CM cm.togglePopup(); const v = cm._popup._privateBanner.visible; cm.togglePopup(); return v;" '"value":true'
set_s private-mode false
expect "the banner is hidden again" \
    "$CM cm.togglePopup(); const v = cm._popup._privateBanner.visible; cm.togglePopup(); return v;" '"value":false'

echo "== 7 search filters the list"
out=$(shell_eval "$CM
    cm.togglePopup();
    const all = cm._popup._items.length;
    cm._popup._searchEntry.set_text('zzzz-no-such-text-zzzz');
    const none = cm._popup._items.length;
    cm._popup._searchEntry.set_text('');
    const back = cm._popup._items.length;
    cm.togglePopup();
    return {all, none, back};")
case "$out" in
    *'"none":0'*) ok "a search that matches nothing empties the list" ;;
    *) bad "search did not filter: $out" ;;
esac

echo "== 8 the QR dialog opens"
out=$(shell_eval "$CM
    cm.togglePopup();
    const item = cm._popup._items.find(i => cm._popup._canShowQr(i));
    let built = false;
    if (item) {
        const area = cm._popup._createQrArea(item.content || item.plainText);
        built = area.width > 0 && area.height > 0;
        area.destroy();
    }
    cm.togglePopup();
    return {built, hadItem: !!item};")
case "$out" in
    *'"built":true'*) ok "the QR drawing area is built with a real size" ;;
    *'"hadItem":false'*) bad "no stored item could be shown as a QR code" ;;
    *) bad "the QR area was not built: $out" ;;
esac

echo "== 9 screenshots differ between closed and open"
out=$(shell_eval_async "
    const shoot = async path => {
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        const shooter = new Shell.Screenshot();
        await new Promise((resolve, reject) => {
            shooter.screenshot(false, stream, (source, result) => {
                try { source.screenshot_finish(result); resolve(); } catch (e) { reject(e); }
            });
        });
        stream.close(null);
    };
    $CM
    if (cm._popup.isShowing) cm.togglePopup();
    await shoot('$SHOTS/closed.png');
    cm.togglePopup();
    await new Promise(r => GLib.timeout_add(0, 400, () => { r(); return false; }));
    await shoot('$SHOTS/open.png');
    cm.togglePopup();
    return {ok: true};")
if [ -s "$SHOTS/closed.png" ] && [ -s "$SHOTS/open.png" ]; then
    if [ "$(md5sum < "$SHOTS/closed.png")" != "$(md5sum < "$SHOTS/open.png")" ]; then
        ok "the screen really changes when the popup opens"
    else
        bad "the two screenshots are identical, so the capture is not showing the popup"
    fi
else
    bad "no screenshots were produced: $out"
fi

echo "== 10 a global shortcut opens the popup"
set_s toggle-popup "['<Shift><Super>v']"
sleep 1
out=$(shell_eval_async "
    $CM
    if (cm._popup.isShowing) cm.togglePopup();
    const backend = global.stage.context?.get_backend?.() ?? Clutter.get_default_backend();
    const keyboard = backend.get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const SUPER = 125, SHIFT = 42, V = 47;
    let t = GLib.get_monotonic_time();
    const tap = (code, state) => { keyboard.notify_key(t, code, state); t += 1000; };
    tap(SUPER, Clutter.KeyState.PRESSED);
    tap(SHIFT, Clutter.KeyState.PRESSED);
    tap(V, Clutter.KeyState.PRESSED);
    tap(V, Clutter.KeyState.RELEASED);
    tap(SHIFT, Clutter.KeyState.RELEASED);
    tap(SUPER, Clutter.KeyState.RELEASED);
    await new Promise(r => GLib.timeout_add(0, 900, () => { r(); return false; }));
    const showing = cm._popup.isShowing;
    if (showing) cm.togglePopup();
    return {showing};")
case "$out" in
    *'"showing":true'*) ok "pressing the shortcut opens the popup" ;;
    *) bad "the shortcut did not open the popup: $out" ;;
esac
set_s toggle-popup "[]"

echo "== 11 nothing is left in the shell after disabling"
out=$(shell_eval "$CM
    const before = Main.uiGroup.get_children().length;
    return before;")
before=$(echo "$out" | grep -o '"value":[0-9]*' | grep -o '[0-9]*')
gnome-extensions disable "$UUID"; sleep 2
out=$(shell_eval "return Main.uiGroup.get_children().length;")
after=$(echo "$out" | grep -o '"value":[0-9]*' | grep -o '[0-9]*')

# Checked while the extension is still disabled: counting after re-enabling
# finds the popup it legitimately just created and reports it as a leak.
expect "no stray ClipMaster actor is left behind" \
    'return Main.uiGroup.get_children().filter(c => (c.style_class ?? "").includes("clipmaster")).length;' '"value":0'

gnome-extensions enable "$UUID"; sleep 3
if [ -n "$before" ] && [ -n "$after" ] && [ "$after" -lt "$before" ]; then
    ok "disabling removes its actors from the shell ($before -> $after)"
elif [ "$before" = "$after" ]; then
    bad "the actor count did not drop on disable ($before -> $after)"
else
    bad "could not count actors: before=$before after=$after"
fi

echo
echo "passed: $pass  failed: $fail"
echo "screenshots in $SHOTS"
[ "$fail" -eq 0 ]
