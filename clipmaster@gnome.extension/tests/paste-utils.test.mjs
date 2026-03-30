import test from 'node:test';
import assert from 'node:assert/strict';

import { getPasteKeySpec, isTerminalWindow } from '../src/Util/PasteUtils.js';

const SHIFT_LEFT = 42;
const CTRL_LEFT = 29;
const INSERT_KEY = 110;
const V_KEY = 47;

test('detects terminal windows from app id', () => {
    assert.equal(isTerminalWindow({ appId: 'org.gnome.Terminal' }), true);
    assert.equal(isTerminalWindow({ appId: 'org.gnome.Console' }), true);
    assert.equal(isTerminalWindow({ appId: 'firefox.desktop' }), false);
});

test('detects terminal windows from wm class', () => {
    assert.equal(isTerminalWindow({ wmClass: 'kitty' }), true);
    assert.equal(isTerminalWindow({ wmClass: 'Alacritty' }), true);
    assert.equal(isTerminalWindow({ wmClass: 'Code' }), false);
});

test('uses terminal-specific paste shortcuts', () => {
    assert.deepEqual(getPasteKeySpec({ appId: 'org.gnome.Terminal' }), {
        modifiers: [CTRL_LEFT, SHIFT_LEFT],
        keycode: V_KEY,
        label: 'Ctrl+Shift+V',
    });

    assert.deepEqual(getPasteKeySpec({ appId: 'firefox.desktop' }), {
        modifiers: [SHIFT_LEFT],
        keycode: INSERT_KEY,
        label: 'Shift+Insert',
    });
});
