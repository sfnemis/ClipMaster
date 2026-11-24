#!/usr/bin/env -S gjs -m
/*
 * Reads the stored ClipMaster history and prints it, for the live checks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';

const SRC = ARGV[1] ?? GLib.build_filenamev([GLib.get_home_dir(), 'clipmaster-src']);
const { HistoryObfuscator } = await import(`file://${SRC}/clipmaster@gnome.extension/src/Util/Obfuscation.js`);

const path = ARGV[0] || GLib.build_filenamev([GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json']);

const [ok, bytes] = GLib.file_get_contents(path);
if (!ok) {
    print('READ_FAIL');
    imports.system.exit(2);
}

let text = new TextDecoder().decode(bytes);

if (HistoryObfuscator.isObfuscated(text)) {
    const keyPath = path.replace(/\.json$/, '.key');
    const [keyOk, keyBytes] = GLib.file_get_contents(keyPath);
    if (!keyOk) {
        print('NO_KEY');
        imports.system.exit(3);
    }
    text = new HistoryObfuscator(new TextDecoder().decode(keyBytes).trim()).deobfuscate(text);
    print('FORMAT obfuscated');
} else {
    print('FORMAT plain');
}

const data = JSON.parse(text);
print(`ITEMS ${data.items.length} NEXTID ${data.nextId} LISTS ${(data.lists ?? []).length}`);

for (const item of data.items) {
    print(`ITEM id=${item.id} type=${item.type} src=${item.sourceApp} sel=${item.selection} `
        + `pinned=${!!item.isPinned} fav=${!!item.isFavorite} content=${JSON.stringify(item.content).substring(0, 100)}`);
}
