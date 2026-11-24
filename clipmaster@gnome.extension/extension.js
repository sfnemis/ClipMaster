/*
 * ClipMaster - GNOME Shell Extension
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SignalManager, TimeoutManager, ValidationUtils } from './src/Util/Utils.js';
import { setDebugMode, debugLog } from './src/Util/Constants.js';
import { getPasteKeySpec } from './src/Util/PasteUtils.js';
import { migrateSettings } from './src/Util/Migrations.js';
import { ClipboardDatabase } from './src/Manager/Database.js';
import { ClipboardMonitor } from './src/Manager/ClipboardMonitor.js';
import { ClipboardPopup } from './src/UI/Popup.js';
import { ClipMasterIndicator } from './src/UI/Indicator.js';

const KEYBINDINGS = ['toggle-popup', 'paste-as-plain', 'toggle-private-mode'];

const FOCUS_RESTORE_DELAY_MS = 50;
const PASTE_DELAY_MS = 75;

export default class ClipMasterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signalManager = new SignalManager();
        this._timeoutManager = new TimeoutManager();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._boundKeys = new Set();
        this._pendingPasteKeySpec = null;
        this._previousFocusWindow = null;
        this._previousFocusMeta = null;
        this._popupAddedToChrome = false;

        migrateSettings(this._settings);

        setDebugMode(this._settings.get_boolean('debug-mode'));
        this._signalManager.connect(
            this._settings, 'changed::debug-mode',
            () => setDebugMode(this._settings.get_boolean('debug-mode')), 'debug-mode');

        this._database = new ClipboardDatabase(
            this._settings.get_string('storage-path') || null,
            this._settings,
            (title, message) => Main.notify(title, message));

        this._monitor = new ClipboardMonitor(this._settings, this._database, id => this._onNewItem(id));

        // Reading the history is asynchronous and the monitor must not record
        // anything before it finishes: an item stored first would be given an
        // identifier that the stored history also uses. `enable()` itself stays
        // synchronous, which is what GNOME Shell expects.
        this._database.init()
            .then(() => this._monitor?.start())
            .catch(e => console.error(`ClipMaster: could not open the history: ${e.message}`));

        this._popup = new ClipboardPopup(this);
        this._popup.visible = false;
        this._popup.opacity = 0;
        this._popup.reactive = false;
        this._popup.set_position(-10000, -10000);

        if (this._settings.get_boolean('show-indicator'))
            this._addIndicator();

        this._signalManager.connect(
            this._settings, 'changed::show-indicator',
            () => {
                if (this._settings.get_boolean('show-indicator'))
                    this._addIndicator();
                else
                    this._removeIndicator();
            },
            'show-indicator');

        this._signalManager.connect(
            this._settings, 'changed::reload-request', () => this._reloadDatabase(), 'reload-request');

        this._bindShortcuts();
        for (const key of KEYBINDINGS) {
            this._signalManager.connect(
                this._settings, `changed::${key}`, () => this._rebindShortcut(key), `rebind-${key}`);
        }

        this._maybeShowShortcutHint();
    }

    /**
     * Tells a user upgrading from 1.3.1 once that the keyboard shortcut is now
     * theirs to choose, since the extension no longer ships one.
     */
    _maybeShowShortcutHint() {
        if (!this._settings.get_boolean('show-shortcut-hint'))
            return;

        this._settings.set_boolean('show-shortcut-hint', false);
        this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 3000, () => {
            Main.notify(
                _('ClipMaster needs a keyboard shortcut'),
                _('ClipMaster no longer sets one by default. Open its preferences to choose a shortcut for the clipboard popup.'));
            return GLib.SOURCE_REMOVE;
        }, 'shortcut-hint');
    }

    disable() {
        this._unbindShortcuts();

        this._signalManager.disconnectAll();
        this._signalManager = null;

        this._timeoutManager.removeAll();
        this._timeoutManager = null;

        this._monitor.stop();
        this._monitor = null;

        if (this._popupAddedToChrome) {
            Main.layoutManager.removeChrome(this._popup);
            this._popupAddedToChrome = false;
        }
        this._popup.destroy();
        this._popup = null;

        this._removeIndicator();

        this._database.destroy();
        this._database = null;

        setDebugMode(false);

        this._windowTracker = null;
        this._pendingPasteKeySpec = null;
        this._previousFocusWindow = null;
        this._previousFocusMeta = null;
        this._boundKeys = null;
        this._settings = null;
    }

    /**
     * The preferences window runs in its own process, so when it changes the
     * history file it raises `reload-request` rather than hoping the shell
     * notices. Without this the copy held here would be written back over it.
     */
    _reloadDatabase() {
        this._database.reload()
            .then(() => {
                this._indicator?.refresh();
                if (this._popup.isShowing)
                    this._popup.open();
            })
            .catch(e => console.error(`ClipMaster: could not reload the history: ${e.message}`));
    }

    _addIndicator() {
        if (this._indicator)
            return;

        this._indicator = new ClipMasterIndicator(this);
        Main.panel.addToStatusArea('clipmaster', this._indicator);
    }

    _removeIndicator() {
        if (!this._indicator)
            return;

        this._indicator.destroy();
        this._indicator = null;
    }

    /**
     * Shortcuts ship with no default, because the review guidelines forbid an
     * extension that touches the clipboard from claiming one, and because the
     * two defaults earlier versions used were already taken: `<Super>v` by the
     * notification list and `<Ctrl><Shift>v` by every terminal. A binding is
     * registered only once the user has chosen it in the preferences.
     */
    _bindShortcuts() {
        for (const key of KEYBINDINGS)
            this._bindShortcut(key);
    }

    _bindShortcut(key) {
        if (this._settings.get_strv(key).length === 0)
            return;

        const handlers = {
            'toggle-popup': () => this.togglePopup(),
            'paste-as-plain': () => this._pasteAsPlain(),
            'toggle-private-mode': () => this.togglePrivateMode(),
        };

        Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, handlers[key]);
        this._boundKeys.add(key);
    }

    _rebindShortcut(key) {
        if (this._boundKeys.has(key)) {
            Main.wm.removeKeybinding(key);
            this._boundKeys.delete(key);
        }
        this._bindShortcut(key);
    }

    _unbindShortcuts() {
        for (const key of this._boundKeys)
            Main.wm.removeKeybinding(key);
        this._boundKeys.clear();
    }

    togglePrivateMode() {
        const enabled = !this._settings.get_boolean('private-mode');
        this._settings.set_boolean('private-mode', enabled);

        Main.notify('ClipMaster', enabled
            ? _('Private mode is on. Nothing is being recorded.')
            : _('Private mode is off. The clipboard is being recorded again.'));

        this._indicator?.refreshIcon();
    }

    _onNewItem() {
        this._indicator?.refresh();

        if (this._settings.get_boolean('show-notification'))
            Main.notify('ClipMaster', _('New item added to the clipboard history'));
    }

    _refreshIndicator() {
        this._indicator?.refresh();
    }

    get database() {
        return this._database;
    }

    get monitor() {
        return this._monitor;
    }

    get settings() {
        return this._settings;
    }

    showPopup() {
        if (this._popup.isShowing)
            return;

        this._previousFocusWindow = global.display.focus_window;
        this._previousFocusMeta = this._getWindowMeta(this._previousFocusWindow);
        this._pendingPasteKeySpec = null;

        // The popup joins the chrome only while it is on screen. Tracked chrome
        // always affects the input region, so leaving it there when hidden made
        // unrelated windows swallow clicks, which is what issue #2 reported.
        //
        // No parameters are passed. `affectsInputRegion` was accepted up to
        // GNOME 49 and removed in GNOME 50, where passing it makes addChrome
        // throw and the popup never appears at all: that is what issue #27 was
        // really about. `trackFullscreen` is left at its default of false on
        // purpose, so the history can still be opened over a fullscreen window.
        if (!this._popupAddedToChrome) {
            Main.layoutManager.addChrome(this._popup);
            this._popupAddedToChrome = true;
        }

        const [width, height] = this._popupSize();
        const monitor = this._targetMonitor();
        const [x, y] = this._popupPosition(monitor, width, height);

        this._popup.set_size(width, height);
        this._popup.set_position(x, y);
        this._popup.open();
    }

    /**
     * The stored size is in logical pixels, so it is multiplied by the scale
     * factor to come out the same physical size on a HiDPI monitor. Issue #28
     * was a 4K user getting a popup a quarter of the area they expected.
     */
    _popupSize() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const monitor = this._targetMonitor();

        const width = ValidationUtils.validateNumber(this._settings.get_int('popup-width'), 280, 4000, 450) * scale;
        const height = ValidationUtils.validateNumber(this._settings.get_int('popup-height'), 280, 4000, 550) * scale;

        return [
            Math.round(Math.min(width, monitor.width - 20)),
            Math.round(Math.min(height, monitor.height - 20)),
        ];
    }

    _targetMonitor() {
        const [pointerX, pointerY] = global.get_pointer();

        const pointerMonitor = Main.layoutManager.monitors.find(monitor =>
            pointerX >= monitor.x && pointerX < monitor.x + monitor.width
            && pointerY >= monitor.y && pointerY < monitor.y + monitor.height);

        return pointerMonitor || Main.layoutManager.primaryMonitor;
    }

    _popupPosition(monitor, width, height) {
        const margin = 12;
        const position = this._settings.get_string('popup-position');

        const left = monitor.x + margin;
        const right = monitor.x + monitor.width - width - margin;
        const centerX = monitor.x + Math.round((monitor.width - width) / 2);
        const top = monitor.y + margin;
        const bottom = monitor.y + monitor.height - height - margin;
        const centerY = monitor.y + Math.round((monitor.height - height) / 2);

        const anchors = {
            'center': [centerX, centerY],
            'top-left': [left, top],
            'top-center': [centerX, top],
            'top-right': [right, top],
            'left': [left, centerY],
            'right': [right, centerY],
            'bottom-left': [left, bottom],
            'bottom-center': [centerX, bottom],
            'bottom-right': [right, bottom],
        };

        if (position !== 'cursor')
            return anchors[position] || anchors['center'];

        const [pointerX, pointerY] = global.get_pointer();
        return [
            Math.max(left, Math.min(Math.round(pointerX - width / 2), right)),
            Math.max(top, Math.min(Math.round(pointerY - 50), bottom)),
        ];
    }

    hidePopup() {
        if (!this._popup || this._popup.isPinned)
            return;

        this._popup.close();

        // Closing the indicator menu tells panel extensions such as Dash to
        // Panel that nothing of ours is open any more, so auto hide can resume.
        this._indicator?.menu.close();

        if (this._popupAddedToChrome) {
            Main.layoutManager.removeChrome(this._popup);
            this._popupAddedToChrome = false;
        }

        this._restorePreviousFocusAndMaybePaste();
        this._popup.set_position(-10000, -10000);
    }

    togglePopup() {
        if (this._popup.isShowing)
            this.hidePopup();
        else
            this.showPopup();
    }

    _pasteAsPlain() {
        const items = this._database.getItems({ limit: 1 });
        if (items.length > 0)
            this._monitor.copyToClipboard(items[0].plainText, true);
    }

    queueAutoPasteForSelection() {
        this._pendingPasteKeySpec = getPasteKeySpec(this._previousFocusMeta || {});
    }

    _getWindowMeta(window) {
        if (!window)
            return null;

        const app = this._windowTracker.get_window_app(window);

        return {
            appId: app?.get_id() || '',
            wmClass: window.get_wm_class() || '',
            wmClassInstance: window.get_wm_class_instance() || '',
            title: window.get_title() || '',
        };
    }

    _restorePreviousFocusAndMaybePaste() {
        const window = this._previousFocusWindow;
        const keySpec = this._pendingPasteKeySpec;

        this._previousFocusWindow = null;
        this._previousFocusMeta = null;
        this._pendingPasteKeySpec = null;

        if (!window && !keySpec)
            return;

        this._timeoutManager.add(GLib.PRIORITY_DEFAULT, FOCUS_RESTORE_DELAY_MS, () => {
            if (window)
                window.activate(global.get_current_time());

            if (keySpec) {
                this._timeoutManager.add(GLib.PRIORITY_DEFAULT, PASTE_DELAY_MS, () => {
                    if (global.display.focus_window)
                        this._sendPasteShortcut(keySpec);
                    return GLib.SOURCE_REMOVE;
                }, 'auto-paste');
            }

            return GLib.SOURCE_REMOVE;
        }, 'restore-focus');
    }

    _sendPasteShortcut(keySpec) {
        const keyboard = this._createVirtualKeyboard();
        if (!keyboard) {
            debugLog('No virtual keyboard device is available, skipping the paste');
            return;
        }

        let timestamp = GLib.get_monotonic_time();
        const press = keycode => {
            keyboard.notify_key(timestamp, keycode, Clutter.KeyState.PRESSED);
            timestamp += 1000;
        };
        const release = keycode => {
            keyboard.notify_key(timestamp, keycode, Clutter.KeyState.RELEASED);
            timestamp += 1000;
        };

        for (const modifier of keySpec.modifiers)
            press(modifier);

        press(keySpec.keycode);
        release(keySpec.keycode);

        for (const modifier of [...keySpec.modifiers].reverse())
            release(modifier);

        debugLog(`Sent ${keySpec.label} to the focused window`);
    }

    /**
     * `Clutter.get_default_backend()` was removed in GNOME 51, so the backend
     * comes from the stage context there. The older call is kept for the shell
     * versions that do not have the newer one.
     */
    _createVirtualKeyboard() {
        const backend = global.stage.context?.get_backend?.() ?? Clutter.get_default_backend?.();
        const seat = backend?.get_default_seat();

        return seat?.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE) || null;
    }
}
