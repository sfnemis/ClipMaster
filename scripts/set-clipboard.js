#!/usr/bin/env -S gjs -m
/*
 * Puts text on the clipboard from a real, focused window, for the live checks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * The window is not decoration. A Wayland client cannot take the selection
 * without a serial from a recent input event, so a windowless helper silently
 * owns nothing, the shell sees no selection change, and the checks report the
 * extension as broken when it is not.
 */

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

const text = ARGV[0] ?? 'hello';
const holdMs = Number(ARGV[1] ?? 3000);
const title = ARGV[2] ?? 'ClipMaster test source';

Gtk.init();

const window = new Gtk.Window({ title, default_width: 320, default_height: 120 });
window.set_child(new Gtk.Label({ label: `copying ${text.length} characters` }));

const loop = new GLib.MainLoop(null, false);

window.connect('map', () => {
    // A short wait so the window really has the focus before the selection is
    // claimed.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        const value = new GObject.Value();
        value.init(GObject.TYPE_STRING);
        value.set_string(text);

        const clipboard = window.get_clipboard();
        clipboard.set_content(Gdk.ContentProvider.new_for_value(value));

        // Reading it back is the instrument checking itself. A Wayland client
        // that has no focus cannot take the selection, and `set_content`
        // reports nothing when that happens, so without this the helper looks
        // like it worked and the extension looks broken. A session that has
        // just logged in sits in the Activities overview, where exactly that
        // is the case.
        clipboard.read_text_async(null, (source, result) => {
            let owned = false;
            try {
                owned = source.read_text_finish(result) === text;
            } catch (e) {
                owned = false;
            }

            print(owned ? `SET ${text.length} chars` : 'NOT_OWNED');

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, owned ? holdMs : 0, () => {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            });
        });

        return GLib.SOURCE_REMOVE;
    });
});

window.present();
loop.run();
window.destroy();
print('DONE');
