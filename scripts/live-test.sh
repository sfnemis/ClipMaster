#!/usr/bin/env bash
#
# Live checks against a running GNOME Shell with ClipMaster installed and
# enabled. Run it on the machine under test, not over a pipe from elsewhere.
#
# Counts are compared as deltas rather than absolute numbers, because enabling
# the extension deliberately records whatever is already on the clipboard.
set -uo pipefail

UUID="clipmaster@gnome.extension"
EXT="$HOME/.local/share/gnome-shell/extensions/$UUID"
SD="$EXT/schemas"
SCHEMA="org.gnome.shell.extensions.clipmaster"
DB="$HOME/.local/share/clipmaster/clipboard.json"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SRC:-$(cd "$HERE/.." && pwd)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf "  ok   %s\n" "$1"; }
bad() { fail=$((fail+1)); printf "  FAIL %s\n" "$1"; }
set_s() { gsettings --schemadir "$SD" set "$SCHEMA" "$1" "$2"; sleep 0.6; }
# A session that has just logged in opens in the Activities overview, where no
# window holds the focus and a Wayland client therefore cannot take the
# clipboard at all. The development harness closes it when it is installed.
hide_overview() {
    gdbus call --session \
        -d org.gnome.Shell.Extensions.CmHarness \
        -o /org/gnome/Shell/Extensions/CmHarness \
        -m org.gnome.Shell.Extensions.CmHarness.Eval \
        'Main.overview.hide(); return true;' >/dev/null 2>&1 || true
}

copy() {
    local out
    out=$(timeout 25 gjs -m "$HERE/set-clipboard.js" "$1" "${2:-1500}" 2>&1)
    case "$out" in
        *NOT_OWNED*)
            bad "the test helper could not take the clipboard, so this run says nothing about ClipMaster"
            printf '       close the Activities overview on that machine and run it again\n'
            return 1
            ;;
    esac
    sleep 1.6
}
dump()  { gjs -m "$HERE/read-history.js" "$DB" "$SRC" 2>/dev/null; }
items() { dump | sed -n 's/^ITEMS \([0-9]*\).*/\1/p'; }
has()   { dump | grep -Fq "$1"; }
cycle() { gnome-extensions disable "$UUID"; sleep 2; gnome-extensions enable "$UUID"; sleep 3; }

echo "== reset"
gnome-extensions disable "$UUID"; sleep 2
rm -f "$DB" "$DB".bak "$DB".unreadable-* "$DB".tmp
set_s private-mode false
set_s excluded-apps "[]"
set_s encrypt-database true
set_s skip-duplicates true
set_s track-images true
gnome-extensions enable "$UUID"; sleep 3
hide_overview
journalctl --user -b -o cat --since "-5s" >/dev/null 2>&1
MARK=$(date '+%Y-%m-%d %H:%M:%S')

echo "== 0 calibration"
# A locked screen puts the session into unlock-dialog mode, where GNOME Shell
# disables every user extension. ClipMaster is then not running at all and every
# check below would blame it for doing nothing.
state=$(gnome-extensions info "$UUID" | sed -n 's/^ *State: *//p')
if [ "$state" = "ACTIVE" ]; then
    ok "ClipMaster is active"
else
    bad "ClipMaster is $state, not ACTIVE. Is the screen locked? Nothing below would mean anything."
    echo
    echo "passed: $pass  failed: $fail"
    exit 1
fi

if copy "calibration: the helper owns the clipboard"; then
    ok "the test helper owns the clipboard, so a failure below is ClipMaster's"
else
    echo
    echo "passed: $pass  failed: $fail"
    exit 1
fi

echo "== 1 text capture"
before=$(items); before=${before:-0}
copy "first captured line"
[ "$(items)" -eq "$((before + 1))" ] && ok "a copy adds exactly one item" || bad "expected $((before + 1)) items, got $(items)"
has "first captured line" && ok "the stored content matches what was copied" || bad "the content is missing"

echo "== 2 unicode round trip"
copy "emoji and turkish: 🖼️ 🔒 👨‍👩‍👧‍👦 ğüşıöçĞÜŞİÖÇ"
has "🖼️ 🔒 👨‍👩‍👧‍👦 ğüşıöçĞÜŞİÖÇ" \
    && ok "emoji and Turkish survive the stored format" \
    || bad "unicode was corrupted on the way to disk"

echo "== 3 excluded application"
before=$(items)
set_s excluded-apps "[\"gjs\"]"
copy "this must never be stored"
[ "$(items)" -eq "$before" ] && ok "an excluded application is not recorded" || bad "the excluded application was recorded"
has "this must never be stored" && bad "excluded content reached the history" || ok "excluded content is absent"
set_s excluded-apps "[]"

echo "== 4 private mode"
set_s private-mode true
before=$(items)
copy "private mode must drop this"
[ "$(items)" -eq "$before" ] && ok "private mode records nothing" || bad "private mode recorded an item"
has "private mode must drop this" && bad "private content reached the history" || ok "private content is absent"
set_s private-mode false

echo "== 5 the startup capture honours the exclusion list"
set_s excluded-apps "[\"gjs\"]"
copy "excluded while the extension restarts" 6000 &
sleep 2
cycle
wait
[ "$(items)" -gt 0 ] && ok "the history is intact after a restart" || bad "the history is empty after a restart"
has "excluded while the extension restarts" && bad "the startup capture ignored the exclusion list" || ok "the startup capture honours the exclusion list"
set_s excluded-apps "[]"

echo "== 6 duplicates"
copy "a line that repeats"
before=$(items)
copy "a line that repeats"
[ "$(items)" -eq "$before" ] && ok "a duplicate does not add a second item" || bad "a duplicate was added"

echo "== 7 a restart does not duplicate the clipboard it finds"
copy "still on the clipboard across a restart" 8000 &
sleep 2
before=$(items)
cycle
wait
[ "$(items)" -eq "$before" ] && ok "the startup capture deduplicates" || bad "the startup capture duplicated an item ($before -> $(items))"

echo "== 8 identifiers are unique"
dup=$(dump | sed -n 's/^ITEM id=\([0-9]*\).*/\1/p' | sort | uniq -d | wc -l)
[ "${dup:-0}" -eq 0 ] && ok "no two items share an identifier" || bad "$dup identifier(s) are used twice"

echo "== 9 turning obfuscation off keeps the history"
expected=$(items)
set_s encrypt-database false
cycle
[ "$(items)" -eq "$expected" ] && ok "every item survived turning obfuscation off" || bad "history changed: $expected -> $(items)"
has "first captured line" && ok "the oldest item is still readable" || bad "the oldest item was lost"
copy "written while plain"
dump | head -1 | grep -q "FORMAT plain" && ok "new writes are plain" || bad "the format did not change"

echo "== 10 and turning it back on"
expected=$(items)
set_s encrypt-database true
cycle
copy "written while obfuscated again"
dump | head -1 | grep -q "FORMAT obfuscated" && ok "writes are obfuscated again" || bad "writes are still plain"
[ "$(items)" -ge "$expected" ] && ok "nothing was lost turning it back on" || bad "items were lost"

echo "== 11 a damaged history is never overwritten"
cp "$DB" /tmp/clipmaster-good.json
gnome-extensions disable "$UUID"; sleep 2
printf 'CMOB1:this-is-not-valid-base64-or-utf8' > "$DB"
gnome-extensions enable "$UUID"; sleep 3
copy "this must not replace the damaged file"
if grep -q "this-is-not-valid" "$DB"; then
    ok "the damaged file was left exactly as it was"
else
    bad "the damaged file was overwritten"
fi
ls "$DB".unreadable-* >/dev/null 2>&1 && ok "a copy of the damaged file was kept" || bad "no copy of the damaged file was kept"
cp /tmp/clipmaster-good.json "$DB"
rm -f "$DB".unreadable-*
cycle
has "first captured line" && ok "the restored history reads back" || bad "the restored history does not read back"

echo "== 12 enable and disable leaves nothing behind"
for i in 1 2 3; do cycle; done
errors=$(journalctl --user -b -o cat --since "$MARK" 2>/dev/null | grep -cE "JS ERROR|clipmaster.*(TypeError|ReferenceError)")
[ "${errors:-0}" -eq 0 ] && ok "no JavaScript errors across the whole run" || bad "$errors JavaScript error(s) in the journal"

echo "== 13 the history file stays private"
mode=$(stat -c %a "$DB")
[ "$mode" = "600" ] && ok "the history file is readable by its owner only" || bad "the history file mode is $mode"
keymode=$(stat -c %a "${DB%.json}.key")
[ "$keymode" = "600" ] && ok "the key file is readable by its owner only" || bad "the key file mode is $keymode"

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
