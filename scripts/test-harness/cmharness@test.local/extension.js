/*
 * ClipMaster test harness - DEVELOPMENT ONLY, NEVER PUBLISHED
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * GNOME Shell refuses screenshots and input injection to anything that is not
 * the shell itself, and its own Eval method is disabled outside Looking Glass.
 * That leaves no way to drive an extension's own user interface from a test
 * script, which is why this exists: it runs inside the shell process and
 * forwards a script there over the session bus.
 *
 * It is an arbitrary code execution service for the session that installs it.
 * It belongs on a throwaway test machine and nowhere else, it is not part of
 * the ClipMaster package, and `scripts/live-ui-test.sh` removes it when it is
 * finished.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.CmHarness">
    <method name="Eval">
      <arg type="s" direction="in" name="script"/>
      <arg type="b" direction="out" name="queued"/>
      <arg type="s" direction="out" name="error"/>
    </method>
    <method name="Result">
      <arg type="b" direction="out" name="done"/>
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

export default class HarnessExtension extends Extension {
    enable() {
        this._result = null;
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/CmHarness');
        this._nameId = Gio.DBus.session.own_name(
            'org.gnome.Shell.Extensions.CmHarness', Gio.BusNameOwnerFlags.REPLACE, null, null);
    }

    disable() {
        if (this._nameId) {
            Gio.DBus.session.unown_name(this._nameId);
            this._nameId = null;
        }

        this._dbus.unexport();
        this._dbus = null;
        this._result = null;
    }

    /**
     * Queues a script and returns at once. Every script is treated as
     * asynchronous, so there is one protocol rather than two: the caller polls
     * `Result()` for the value.
     */
    Eval(script) {
        this._result = null;

        try {
            // `new Function` builds the script in global scope, where none of
            // the shell's modules are visible, so the ones a test needs are
            // passed in as arguments.
            const fn = new Function(
                'Main', 'Gio', 'GLib', 'GObject', 'St', 'Clutter', 'Meta', 'Shell',
                `return (async () => { ${script} })();`);

            fn(Main, Gio, GLib, GObject, St, Clutter, Meta, Shell).then(
                value => {
                    this._result = { ok: true, value: value ?? null };
                },
                error => {
                    this._result = { ok: false, error: String(error), stack: error?.stack ?? '' };
                });

            return [true, ''];
        } catch (e) {
            this._result = { ok: false, error: String(e), stack: e?.stack ?? '' };
            return [false, String(e)];
        }
    }

    Result() {
        if (this._result === null)
            return [false, ''];

        const result = this._result;
        this._result = null;

        try {
            return [true, JSON.stringify(result)];
        } catch (e) {
            return [true, JSON.stringify({ ok: false, error: `result is not serialisable: ${e}` })];
        }
    }
}
