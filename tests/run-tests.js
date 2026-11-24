#!/usr/bin/env -S gjs -m
/*
 * ClipMaster test suite
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Covers the parts that can run outside GNOME Shell: the obfuscation format,
 * the signal and timeout bookkeeping, hashing, code detection, paste shortcut
 * selection and the settings migration. Run it with:
 *
 *   gjs -m tests/run-tests.js
 *
 * The parts that need the shell process (the popup, the clipboard monitor) are
 * covered by the manual checks in docs/test-plan.md instead.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { HistoryObfuscator } from '../clipmaster@gnome.extension/src/Util/Obfuscation.js';
import { SignalManager, TimeoutManager, HashUtils, ValidationUtils, FileUtils } from '../clipmaster@gnome.extension/src/Util/Utils.js';
import { isCodeSnippet } from '../clipmaster@gnome.extension/src/Util/CodeDetect.js';
import { isTerminalWindow, getPasteKeySpec } from '../clipmaster@gnome.extension/src/Util/PasteUtils.js';
import { migrateSettings } from '../clipmaster@gnome.extension/src/Util/Migrations.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
    if (condition) {
        passed++;
        return;
    }
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function checkEqual(name, actual, expected) {
    check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function checkThrows(name, fn) {
    try {
        fn();
        failures.push(`${name}: expected a throw, nothing was thrown`);
    } catch {
        passed++;
    }
}

// ----------------------------------------------------------------- obfuscation

function testObfuscation() {
    const obfuscator = new HistoryObfuscator('0123456789abcdefghijklmnopqrstuv');

    const samples = [
        'plain ascii text',
        '{"items":[{"content":"hello"}],"nextId":2}',
        'Türkçe karakterler: ğüşıöçĞÜŞİÖÇ',
        'emoji survive the round trip: 🖼️ 🔒 👍🏽 family 👨‍👩‍👧‍👦',
        'mixed 中文 and русский and عربى',
        'control chars \t\n\r and a quote " and a backslash \\',
        'x'.repeat(5000),
    ];

    for (const sample of samples) {
        const encoded = obfuscator.obfuscate(sample);
        check(`obfuscate marks the payload (${sample.substring(0, 20)})`, HistoryObfuscator.isObfuscated(encoded));
        checkEqual(`round trip (${sample.substring(0, 20)})`, obfuscator.deobfuscate(encoded), sample);
    }

    checkEqual('an empty string obfuscates to an empty string', obfuscator.obfuscate(''), '');
    checkEqual('an empty string deobfuscates to an empty string', obfuscator.deobfuscate(''), '');

    check('plain JSON is not reported as obfuscated', !HistoryObfuscator.isObfuscated('{"items":[]}'));
    checkThrows('deobfuscating plain JSON throws', () => obfuscator.deobfuscate('{"items":[]}'));
    checkThrows('an empty payload throws', () => obfuscator.deobfuscate('CMOB1:'));

    // A wrong key has to be detected rather than returning rubbish silently,
    // which is what let a failed read become a write in version 1.
    const other = new HistoryObfuscator('vutsrqponmlkjihgfedcba9876543210');
    let detected = false;
    try {
        const decoded = other.deobfuscate(obfuscator.obfuscate('{"items":[],"nextId":1}'));
        detected = decoded !== '{"items":[],"nextId":1}';
    } catch {
        detected = true;
    }
    check('a wrong key does not quietly return the right text', detected);

    const key = HistoryObfuscator.generateKey();
    checkEqual('a generated key is 32 characters', key.length, 32);
    check('a generated key is alphanumeric', /^[A-Za-z0-9]{32}$/.test(key));
    check('two generated keys differ', HistoryObfuscator.generateKey() !== HistoryObfuscator.generateKey());
}

function testLegacyFormat() {
    // Reproduces exactly what version 1.3.1 wrote, to prove an existing
    // database is still readable after the upgrade.
    const key = '0123456789abcdefghijklmnopqrstuv';
    const plain = '{"items":[{"content":"legacy"}],"nextId":2}';

    let scrambled = '';
    for (let i = 0; i < plain.length; i++)
        scrambled += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    const legacy = `ENC:${GLib.base64_encode(new TextEncoder().encode(scrambled))}`;

    check('the legacy prefix is recognised', HistoryObfuscator.isObfuscated(legacy));
    checkEqual('a 1.3.1 database still reads back', new HistoryObfuscator(key).deobfuscate(legacy), plain);
}

// ------------------------------------------------------------------ signalling

function testSignalManager() {
    const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    const manager = new SignalManager();

    let calls = 0;
    manager.connect(settings, 'changed', () => calls++, 'group');
    manager.connect(settings, 'changed', () => calls++, 'group');

    checkEqual('both handlers are in one group', manager.size, 1);

    // The version 1 implementation guarded the disconnect with
    // `object.handler_is_connected`, a method GJS does not define on a GObject
    // instance, so the guard was always false and nothing was ever
    // disconnected. This asserts the guard is gone.
    check('GJS really has no handler_is_connected', settings.handler_is_connected === undefined);

    manager.disconnect('group');
    checkEqual('the group is gone after disconnect', manager.size, 0);

    settings.emit('changed', 'color-scheme');
    checkEqual('a disconnected handler does not run', calls, 0);

    manager.connect(settings, 'changed', () => calls++, 'a');
    manager.connect(settings, 'changed', () => calls++, 'b');
    manager.disconnectAll();
    settings.emit('changed', 'color-scheme');
    checkEqual('disconnectAll removes every group', calls, 0);
    checkEqual('nothing is left tracked', manager.size, 0);

    manager.disconnect('never-connected');
    check('disconnecting an unknown group is harmless', true);
}

function testTimeoutManager() {
    const manager = new TimeoutManager();
    const loop = new GLib.MainLoop(null, false);

    let fired = 0;
    manager.add(GLib.PRIORITY_DEFAULT, 5, () => {
        fired++;
        return GLib.SOURCE_REMOVE;
    }, 'once');
    checkEqual('one source is tracked', manager.size, 1);

    // Adding under a name that is in use replaces the earlier source, so a
    // repeated trigger cannot stack up timeouts.
    manager.add(GLib.PRIORITY_DEFAULT, 5, () => {
        fired += 10;
        return GLib.SOURCE_REMOVE;
    }, 'once');
    checkEqual('the name still tracks one source', manager.size, 1);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();

    checkEqual('only the replacement ran', fired, 10);
    checkEqual('a finished source stops being tracked', manager.size, 0);

    const id = manager.add(GLib.PRIORITY_DEFAULT, 10000, () => GLib.SOURCE_REMOVE, 'pending');
    checkEqual('add returns the tracking name', id, 'pending');
    manager.removeAll();
    checkEqual('removeAll clears everything', manager.size, 0);

    manager.remove('pending');
    check('removing an already removed source is harmless', true);
}

// --------------------------------------------------------------------- hashing

function testHashing() {
    checkEqual('an empty value hashes to an empty string', HashUtils.hashContent(''), '');
    checkEqual('hashing is stable', HashUtils.hashContent('abc'), HashUtils.hashContent('abc'));
    check('different content hashes differently',
        HashUtils.hashContent('abc') !== HashUtils.hashContent('abd'));
    checkEqual('the hash is a SHA-256 digest', HashUtils.hashContent('abc').length, 64);

    // The version 1 hash was a 32 bit sum, where a collision silently discarded
    // a distinct clipboard entry.
    const seen = new Set();
    for (let i = 0; i < 20000; i++)
        seen.add(HashUtils.hashContent(`item ${i}`));
    checkEqual('20000 distinct values give 20000 distinct hashes', seen.size, 20000);

    const image = new Uint8Array([1, 2, 3, 4, 5]);
    checkEqual('image hashing is stable',
        HashUtils.hashImageData(image), HashUtils.hashImageData(new Uint8Array([1, 2, 3, 4, 5])));
    check('different images hash differently',
        HashUtils.hashImageData(image) !== HashUtils.hashImageData(new Uint8Array([1, 2, 3, 4, 6])));
    checkEqual('empty image data hashes to an empty string', HashUtils.hashImageData(new Uint8Array([])), '');
}

function testValidation() {
    checkEqual('a value inside the range is kept', ValidationUtils.validateNumber(500, 280, 2400, 450), 500);
    checkEqual('a value below the range is clamped', ValidationUtils.validateNumber(10, 280, 2400, 450), 280);
    checkEqual('a value above the range is clamped', ValidationUtils.validateNumber(9999, 280, 2400, 450), 2400);
    checkEqual('a non number falls back', ValidationUtils.validateNumber('wide', 280, 2400, 450), 450);
    checkEqual('NaN falls back', ValidationUtils.validateNumber(NaN, 280, 2400, 450), 450);

    check('whitespace is not valid text', !ValidationUtils.isValidText('   '));
    check('null is not valid text', !ValidationUtils.isValidText(null));
    check('real text is valid', ValidationUtils.isValidText('hello'));
}

// ----------------------------------------------------------------- file writes

async function testAtomicWrites() {
    const dir = GLib.build_filenamev([GLib.get_tmp_dir(), `clipmaster-test-${GLib.get_monotonic_time()}`]);
    const path = GLib.build_filenamev([dir, 'history.json']);

    await FileUtils.saveTextFileAtomic(path, '{"items":[]}');
    checkEqual('the file is written', await FileUtils.loadTextFile(path), '{"items":[]}');

    const info = Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    checkEqual('the history is readable by its owner only',
        info.get_attribute_uint32('unix::mode') & 0o777, 0o600);

    FileUtils.saveTextFileAtomicSync(path, '{"items":[1]}');
    checkEqual('the synchronous write replaces it', await FileUtils.loadTextFile(path), '{"items":[1]}');

    check('no temporary file is left behind', !FileUtils.fileExists(`${path}.tmp`));
    checkEqual('a missing file reads as null',
        await FileUtils.loadTextFile(GLib.build_filenamev([dir, 'absent.json'])), null);

    Gio.File.new_for_path(path).delete(null);
    Gio.File.new_for_path(dir).delete(null);
}

// ------------------------------------------------------------- code detection

function testCodeDetection() {
    const code = [
        '#!/bin/bash\necho hello',
        'sudo apt install gnome-shell-extension-prefs',
        'git commit -m "fix"',
        'const value = compute();',
        'def main():\n    print("hi")',
        'fn main() {\n    println!("hi");\n}',
        'SELECT name FROM users WHERE id = 1;',
        '.clipmaster-popup { background-color: #000; }',
        'public static void main(String[] args) {',
        'console.log("x")',
        'Get-ChildItem -Path C:\\',
    ];

    for (const sample of code)
        check(`detected as code: ${sample.split('\n')[0].substring(0, 32)}`, isCodeSnippet(sample));

    const prose = [
        'Hello, could you send me the report by Friday please?',
        'Meeting room 4, tomorrow at ten.',
        'https://example.com/some/page',
        'The quick brown fox jumps over the lazy dog.',
        'Turkish text: merhaba, nasilsin?',
        'short',
        '',
    ];

    for (const sample of prose)
        check(`not code: ${sample.substring(0, 32)}`, !isCodeSnippet(sample));
}

// --------------------------------------------------------- paste key selection

function testPasteKeys() {
    const terminals = [
        { appId: 'org.gnome.Terminal.desktop' },
        { wmClass: 'Alacritty' },
        { appId: 'org.gnome.Console.desktop' },
        { wmClass: 'kitty' },
        { appId: 'app.devsuite.Ptyxis.desktop' },
    ];

    for (const meta of terminals) {
        check(`terminal detected: ${JSON.stringify(meta)}`, isTerminalWindow(meta));
        checkEqual(`terminal gets Ctrl+Shift+V: ${JSON.stringify(meta)}`,
            getPasteKeySpec(meta).label, 'Ctrl+Shift+V');
    }

    const others = [
        { appId: 'org.gnome.TextEditor.desktop' },
        { wmClass: 'firefox' },
        {},
    ];

    for (const meta of others) {
        check(`not a terminal: ${JSON.stringify(meta)}`, !isTerminalWindow(meta));
        checkEqual(`other windows get Shift+Insert: ${JSON.stringify(meta)}`,
            getPasteKeySpec(meta).label, 'Shift+Insert');
    }

    const spec = getPasteKeySpec({});
    check('a key spec carries a keycode', typeof spec.keycode === 'number' && spec.keycode > 0);
    check('a key spec carries modifiers', Array.isArray(spec.modifiers) && spec.modifiers.length > 0);
}

// ------------------------------------------------------------------ migrations

function fakeSettings(values) {
    const store = { ...values };
    return {
        store,
        get_int: key => store[key],
        set_int: (key, value) => {
            store[key] = value;
        },
        get_boolean: key => store[key],
        set_boolean: (key, value) => {
            store[key] = value;
        },
        get_string: key => store[key],
        set_string: (key, value) => {
            store[key] = value;
        },
        get_strv: key => store[key],
        set_strv: (key, value) => {
            store[key] = value;
        },
    };
}

function testMigrations() {
    // A user who had the popup pinned to the centre keeps that choice.
    const centred = fakeSettings({
        'settings-version': 0,
        'popup-at-cursor': false,
        'popup-position': 'cursor',
        'toggle-popup': [],
        'show-shortcut-hint': false,
    });
    migrateSettings(centred);
    checkEqual('popup-at-cursor off becomes centre', centred.store['popup-position'], 'center');
    checkEqual('the settings version is recorded', centred.store['settings-version'], 1);
    checkEqual('a user with no shortcut is told once', centred.store['show-shortcut-hint'], true);

    // A user who had chosen their own shortcut keeps it and is not nagged.
    const chosen = fakeSettings({
        'settings-version': 0,
        'popup-at-cursor': true,
        'popup-position': 'cursor',
        'toggle-popup': ['<Super><Alt>v'],
        'show-shortcut-hint': false,
    });
    migrateSettings(chosen);
    checkEqual('an existing shortcut is untouched', chosen.store['toggle-popup'][0], '<Super><Alt>v');
    checkEqual('no notice for a user who chose a shortcut', chosen.store['show-shortcut-hint'], false);
    checkEqual('at the pointer stays at the pointer', chosen.store['popup-position'], 'cursor');

    // Running again changes nothing.
    const already = fakeSettings({
        'settings-version': 1,
        'popup-at-cursor': false,
        'popup-position': 'bottom-right',
        'toggle-popup': [],
        'show-shortcut-hint': false,
    });
    migrateSettings(already);
    checkEqual('a migrated install is left alone', already.store['popup-position'], 'bottom-right');
    checkEqual('and is not nagged again', already.store['show-shortcut-hint'], false);
}

// ------------------------------------------------------------------------ main

testObfuscation();
testLegacyFormat();
testSignalManager();
testTimeoutManager();
testHashing();
testValidation();
await testAtomicWrites();
testCodeDetection();
testPasteKeys();
testMigrations();

print(`\nchecks passed: ${passed}`);

if (failures.length > 0) {
    print(`checks failed: ${failures.length}\n`);
    for (const failure of failures)
        print(`  FAIL ${failure}`);
    print('');
    imports.system.exit(1);
}

print('all checks passed\n');
