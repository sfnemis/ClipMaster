/**
 * ClipMaster - GNOME Shell Extension
 * A powerful clipboard manager with history, favorites, lists, and more.
 * 
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Import modules
import { SignalManager, ValidationUtils } from './utils.js';
import { setDebugMode, debugLog } from './constants.js';
import { ClipboardDatabase } from './database.js';
import { ClipboardMonitor } from './monitor.js';
import { ClipboardPopup } from './popup.js';
import { ClipMasterIndicator } from './indicator.js';


export default class ClipMasterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._extensionPath = this.path;
        
        // Use SignalManager for proper signal lifecycle management
        this._signalManager = new SignalManager();
        
        // Setup debug mode from settings
        setDebugMode(this._settings.get_boolean('debug-mode'));
        this._signalManager.connect(
            this._settings,
            'changed::debug-mode',
            () => setDebugMode(this._settings.get_boolean('debug-mode')),
            'debug-mode-changed'
        );
        
        // Initialize database with settings for encryption support
        const storagePath = this._settings.get_string('storage-path');
        this._database = new ClipboardDatabase(
            storagePath || null, 
            this._settings,
            (title, message) => Main.notify(title, message)
        );
        
        // Initialize clipboard monitor
        this._monitor = new ClipboardMonitor(
            this._settings,
            this._database,
            this._onNewItem.bind(this)
        );
        this._monitor.start();
        
        // Create popup
        this._popup = new ClipboardPopup(this);
        this._popup.set_size(450, 550);
        this._popup.set_position(100, 100);
        this._popup.visible = false;
        this._popup.opacity = 0;
        this._popup.reactive = false;
        Main.layoutManager.addChrome(this._popup, {
            affectsInputRegion: false,
            trackFullscreen: true
        });
        
        // Create panel indicator
        if (this._settings.get_boolean('show-indicator')) {
            this._indicator = new ClipMasterIndicator(this);
            Main.panel.addToStatusArea('clipmaster', this._indicator);
        }
        
        // Bind keyboard shortcuts
        this._bindShortcuts();
        
        // Apply stylesheet
        this._loadStylesheet();
        
        log('ClipMaster extension enabled');
    }
    
    disable() {
        // Unbind shortcuts
        this._unbindShortcuts();
        
        // Stop monitor
        if (this._monitor) {
            this._monitor.stop();
            this._monitor = null;
        }
        
        // Destroy popup
        if (this._popup) {
            Main.layoutManager.removeChrome(this._popup);
            this._popup.destroy();
            this._popup = null;
        }
        
        // Destroy indicator
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        
        // Unload stylesheet
        this._unloadStylesheet();
        
        // Save database before shutdown
        if (this._database) {
            this._database.destroy();
            this._database = null;
        }
        
        // Disconnect all signals using SignalManager
        if (this._signalManager) {
            this._signalManager.disconnectAll();
            this._signalManager = null;
        }
        
        setDebugMode(false);
        
        this._settings = null;
        
        log('ClipMaster extension disabled');
    }
    
    _bindShortcuts() {
        Main.wm.addKeybinding(
            'toggle-popup',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            this.togglePopup.bind(this)
        );
        
        Main.wm.addKeybinding(
            'paste-as-plain',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            this._pasteAsPlain.bind(this)
        );
    }
    
    _unbindShortcuts() {
        Main.wm.removeKeybinding('toggle-popup');
        Main.wm.removeKeybinding('paste-as-plain');
    }
    
    _loadStylesheet() {
        const stylesheetPath = GLib.build_filenamev([
            this.path, 'stylesheet.css'
        ]);
        
        const file = Gio.File.new_for_path(stylesheetPath);
        if (file.query_exists(null)) {
            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            theme.load_stylesheet(file);
            this._stylesheet = file;
        }
    }
    
    _unloadStylesheet() {
        if (this._stylesheet) {
            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            theme.unload_stylesheet(this._stylesheet);
            this._stylesheet = null;
        }
    }
    
    _onNewItem(itemId) {
        this._refreshIndicator();
        
        if (this._settings.get_boolean('show-notification')) {
            Main.notify('ClipMaster', _('New item added to clipboard'));
        }
    }
    
    _refreshIndicator() {
        if (this._indicator) {
            this._indicator.refresh();
        }
    }
    
    showPopup() {
        if (!this._popup) {
            debugLog('showPopup: No popup available');
            return;
        }
        
        if (this._popup._isShowing) {
            debugLog('showPopup: Already showing, ignoring');
            return;
        }
        
        debugLog('showPopup: Starting to show popup');
        
        try {
            if (this._popup._clickOutsideId) {
                debugLog('showPopup: Removing existing click outside handler');
                try {
                    global.stage.disconnect(this._popup._clickOutsideId);
                } catch (e) {
                    debugLog(`Error removing handler: ${e.message}`);
                }
                this._popup._clickOutsideId = null;
            }
            
            this._popup._isShowing = true;
            
            let popupWidth = ValidationUtils.validateNumber(
                this._settings.get_int('popup-width'),
                300, 2000, 450
            );
            let popupHeight = ValidationUtils.validateNumber(
                this._settings.get_int('popup-height'),
                300, 2000, 550
            );
            
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor || !monitor.width || !monitor.height) {
                log('ClipMaster: No valid monitor found');
                this._popup._isShowing = false;
                return;
            }
            
            let posX = Math.round(monitor.x + (monitor.width - popupWidth) / 2);
            let posY = Math.round(monitor.y + (monitor.height - popupHeight) / 2);
            
            try {
                if (this._settings.get_boolean('popup-at-cursor')) {
                    const [mouseX, mouseY] = global.get_pointer();
                    
                    if (mouseX !== undefined && mouseY !== undefined && 
                        !isNaN(mouseX) && !isNaN(mouseY) &&
                        mouseX >= 0 && mouseY >= 0) {
                        posX = Math.round(mouseX - popupWidth / 2);
                        posY = Math.round(mouseY - 50);
                        
                        posX = Math.max(monitor.x + 10, Math.min(posX, monitor.x + monitor.width - popupWidth - 10));
                        posY = Math.max(monitor.y + 50, Math.min(posY, monitor.y + monitor.height - popupHeight - 10));
                    }
                }
            } catch (e) {
                // Use center position
            }
            
            posX = ValidationUtils.validateNumber(posX, 0, 10000, 100);
            posY = ValidationUtils.validateNumber(posY, 0, 10000, 100);
            
            this._popup.set_size(Math.round(popupWidth), Math.round(popupHeight));
            this._popup.set_position(Math.round(posX), Math.round(posY));
            
            debugLog(`showPopup: Calling popup.show() at position (${posX}, ${posY})`);
            this._popup.show();
            debugLog('showPopup: Popup.show() completed');
        } catch (e) {
            log(`ClipMaster: Error showing popup: ${e.message}`);
            debugLog(`showPopup: Error - ${e.message}`);
            this._popup._isShowing = false;
        }
    }
    
    hidePopup() {
        debugLog('hidePopup: Called');
        if (this._popup) {
            debugLog(`hidePopup: _isShowing=${this._popup._isShowing}, visible=${this._popup.visible}, _isPinned=${this._popup._isPinned}`);
            
            if (this._popup._isPinned) {
                debugLog('hidePopup: Popup is pinned, not hiding');
                return;
            }
            
            this._popup._isShowing = false;
            this._popup.hide();
            debugLog('hidePopup: Popup hidden');
        } else {
            debugLog('hidePopup: No popup available');
        }
    }
    
    togglePopup() {
        debugLog(`togglePopup: _isShowing=${this._popup ? this._popup._isShowing : 'no popup'}`);
        if (this._popup && this._popup._isShowing) {
            debugLog('togglePopup: Hiding popup');
            this.hidePopup();
        } else {
            debugLog('togglePopup: Showing popup');
            this.showPopup();
        }
    }
    
    _pasteAsPlain() {
        const items = this._database.getItems({ limit: 1 });
        if (items.length > 0) {
            this._monitor.copyToClipboard(items[0].plainText, true);
        }
    }
    
    _openPreferencesWindow() {
        try {
            const uuid = this.metadata.uuid;
            
            const proc = Gio.Subprocess.new(
                ['gnome-extensions', 'prefs', uuid],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_async(null, null);
        } catch (e) {
            log(`ClipMaster: Error opening preferences: ${e.message}`);
            try {
                const ExtensionUtils = imports.misc.extensionUtils;
                ExtensionUtils.openPrefs();
            } catch (e2) {
                log(`ClipMaster: Fallback preferences open failed: ${e2.message}`);
            }
        }
    }
}
