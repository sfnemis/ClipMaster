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
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';


// ============================================================================
// Clipboard Item Types
// ============================================================================
const ItemType = {
    TEXT: 'text',
    HTML: 'html',
    IMAGE: 'image',
    FILE: 'file',
    URL: 'url',
    COLOR: 'color'
};


// ============================================================================
// Debug Logger - controlled by settings
// ============================================================================
let _debugMode = false;
let _debugSettings = null;

function debugLog(message) {
    if (_debugMode) {
        log(`ClipMaster DEBUG: ${message}`);
    }
}

function setDebugMode(enabled) {
    _debugMode = enabled;
    if (enabled) {
        log('ClipMaster: Debug mode ENABLED');
    }
}


// ============================================================================
// Simple XOR Encryption Helper (lightweight for GNOME Shell)
// ============================================================================
class SimpleEncryption {
    constructor(key) {
        this._key = key || this._generateKey();
    }
    
    _generateKey() {
        // Generate a random 32-character key
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let key = '';
        for (let i = 0; i < 32; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return key;
    }
    
    getKey() {
        return this._key;
    }
    
    encrypt(plainText) {
        if (!plainText) return '';
        
        let result = '';
        for (let i = 0; i < plainText.length; i++) {
            const charCode = plainText.charCodeAt(i) ^ this._key.charCodeAt(i % this._key.length);
            result += String.fromCharCode(charCode);
        }
        
        // Convert to base64 for safe storage
        return GLib.base64_encode(new TextEncoder().encode(result));
    }
    
    decrypt(encryptedText) {
        if (!encryptedText) return '';
        
        try {
            // Decode from base64
            const decoded = new TextDecoder().decode(GLib.base64_decode(encryptedText));
            
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                const charCode = decoded.charCodeAt(i) ^ this._key.charCodeAt(i % this._key.length);
                result += String.fromCharCode(charCode);
            }
            return result;
        } catch (e) {
            log(`ClipMaster: Decryption error: ${e.message}`);
            return '';
        }
    }
}


// ============================================================================
// Clipboard Database - JSON file storage (Optimized with debounced save + encryption)
// ============================================================================
class ClipboardDatabase {
    constructor(storagePath, settings) {
        this._storagePath = storagePath || GLib.build_filenamev([
            GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json'
        ]);
        this._settings = settings;
        
        this._items = [];
        this._lists = [];
        this._nextId = 1;
        this._saveTimeoutId = null;
        this._isDirty = false;
        
        // Debounce delay in milliseconds
        this._saveDebounceMs = 500;
        
        // Setup encryption if enabled
        this._encryption = null;
        this._setupEncryption();
        
        this._ensureDirectory();
        this._load();
    }
    
    _setupEncryption() {
        if (this._settings && this._settings.get_boolean('encrypt-database')) {
            let key = this._settings.get_string('encryption-key');
            
            if (!key) {
                // Generate new key and save it
                this._encryption = new SimpleEncryption();
                key = this._encryption.getKey();
                this._settings.set_string('encryption-key', key);
            } else {
                this._encryption = new SimpleEncryption(key);
            }
        }
    }
    
    _ensureDirectory() {
        const dir = GLib.path_get_dirname(this._storagePath);
        GLib.mkdir_with_parents(dir, 0o755);
    }
    
    _load() {
        try {
            const file = Gio.File.new_for_path(this._storagePath);
            if (file.query_exists(null)) {
                const [success, contents] = file.load_contents(null);
                if (success) {
                    let jsonStr = new TextDecoder().decode(contents);
                    
                    // Check if content is encrypted (starts with base64)
                    if (this._encryption && jsonStr.startsWith('ENC:')) {
                        jsonStr = this._encryption.decrypt(jsonStr.substring(4));
                    }
                    
                    const data = JSON.parse(jsonStr);
                    this._items = data.items || [];
                    this._lists = data.lists || [];
                    this._nextId = data.nextId || 1;
                }
            }
        } catch (e) {
            log(`ClipMaster: Error loading database: ${e.message}`);
            this._items = [];
            this._lists = [];
        }
    }
    
    // Debounced save - prevents excessive disk writes
    _save() {
        this._isDirty = true;
        
        // Cancel existing timeout
        if (this._saveTimeoutId) {
            GLib.source_remove(this._saveTimeoutId);
            this._saveTimeoutId = null;
        }
        
        // Schedule new save
        this._saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._saveDebounceMs, () => {
            this._doSave();
            this._saveTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }
    
    // Immediate save - used when extension is disabled
    _saveImmediate() {
        if (this._saveTimeoutId) {
            GLib.source_remove(this._saveTimeoutId);
            this._saveTimeoutId = null;
        }
        this._doSave();
    }
    
    _doSave() {
        if (!this._isDirty) return;
        
        try {
            const data = {
                items: this._items,
                lists: this._lists,
                nextId: this._nextId
            };
            
            let jsonStr = JSON.stringify(data, null, 2);
            
            // Encrypt if encryption is enabled
            if (this._encryption) {
                jsonStr = 'ENC:' + this._encryption.encrypt(jsonStr);
            }
            
            const file = Gio.File.new_for_path(this._storagePath);
            file.replace_contents(
                jsonStr,
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
            
            this._isDirty = false;
        } catch (e) {
            log(`ClipMaster: Error saving database: ${e.message}`);
        }
    }
    
    // Clean up method to be called when extension is disabled
    destroy() {
        this._saveImmediate();
    }
    
    addItem(item) {
        // Check for duplicates by content hash
        const contentHash = this._hashContent(item.content);
        const existing = this._items.find(i => i.contentHash === contentHash || i.hash === contentHash);
        
        // Check if we should skip duplicates
        let skipDuplicates = true;
        try {
            if (this._settings) {
                skipDuplicates = this._settings.get_boolean('skip-duplicates');
                debugLog(`skip-duplicates setting = ${skipDuplicates}`);
            } else {
                debugLog(`_settings is null!`);
            }
        } catch (e) {
            debugLog(`Error reading skip-duplicates: ${e.message}`);
            skipDuplicates = true;
        }
        
        debugLog(`existing=${!!existing}, skipDuplicates=${skipDuplicates}`);
        
        if (existing && skipDuplicates) {
            // Skip duplicates is ON - just update existing item and move to top
            debugLog(`Skipping duplicate, updating existing item`);
            existing.lastUsed = Date.now();
            existing.useCount = (existing.useCount || 1) + 1;
            this._moveToTop(existing.id);
            this._save();
            return existing.id;
        }
        
        debugLog(`Adding new item (existing=${!!existing}, skipDuplicates=${skipDuplicates})`);
        
        // Add new item (either no duplicate found, or skip duplicates is OFF)
        // Use unique hash when allowing duplicates
        const uniqueHash = skipDuplicates ? contentHash : `${contentHash}_${Date.now()}`;
        
        const newItem = {
            id: this._nextId++,
            type: item.type || ItemType.TEXT,
            content: item.content,
            plainText: item.plainText || item.content,
            preview: item.preview || (item.content || '').substring(0, 200),
            title: item.title || null,
            hash: uniqueHash,
            contentHash: contentHash,  // Keep original content hash for future duplicate checks
            isFavorite: false,
            listId: null,
            sourceApp: item.sourceApp || null,
            created: Date.now(),
            lastUsed: Date.now(),
            useCount: 1,
            imageFormat: item.imageFormat || null,
            metadata: item.metadata || null
        };
        
        this._items.unshift(newItem);
        this._save();
        return newItem.id;
    }
    
    _hashContent(content) {
        // Simple hash for deduplication
        let hash = 0;
        const str = (content || '').substring(0, 10000);
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }
    
    _moveToTop(itemId) {
        const index = this._items.findIndex(i => i.id === itemId);
        if (index > 0) {
            const item = this._items.splice(index, 1)[0];
            this._items.unshift(item);
        }
    }
    
    getItems(options = {}) {
        let items = [...this._items];
        
        // Filter by type
        if (options.type) {
            items = items.filter(i => i.type === options.type);
        }
        
        // Filter by list
        if (options.listId !== undefined) {
            if (options.listId === -1) {
                // Favorites only
                items = items.filter(i => i.isFavorite);
            } else if (options.listId !== null) {
                items = items.filter(i => i.listId === options.listId);
            }
        }
        
        // Search
        if (options.search) {
            const query = options.search.toLowerCase();
            items = items.filter(i => 
                (i.content && i.content.toLowerCase().includes(query)) ||
                (i.plainText && i.plainText.toLowerCase().includes(query)) ||
                (i.title && i.title.toLowerCase().includes(query))
            );
        }
        
        // Limit
        if (options.limit) {
            items = items.slice(0, options.limit);
        }
        
        return items;
    }
    
    getItem(itemId) {
        return this._items.find(i => i.id === itemId);
    }
    
    updateItem(itemId, updates) {
        const item = this._items.find(i => i.id === itemId);
        if (item) {
            Object.assign(item, updates);
            this._save();
            return true;
        }
        return false;
    }
    
    deleteItem(itemId) {
        const index = this._items.findIndex(i => i.id === itemId);
        if (index >= 0) {
            this._items.splice(index, 1);
            this._save();
            return true;
        }
        return false;
    }
    
    toggleFavorite(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (item) {
            item.isFavorite = !item.isFavorite;
            this._save();
            return item.isFavorite;
        }
        return false;
    }
    
    clearHistory(keepFavorites = true) {
        if (keepFavorites) {
            this._items = this._items.filter(i => i.isFavorite);
        } else {
            this._items = [];
        }
        this._save();
    }
    
    enforceLimit(maxItems) {
        // Keep favorites regardless of limit
        const favorites = this._items.filter(i => i.isFavorite);
        const nonFavorites = this._items.filter(i => !i.isFavorite);
        
        if (nonFavorites.length > maxItems) {
            this._items = [...favorites, ...nonFavorites.slice(0, maxItems)];
            this._save();
        }
    }
    
    // Lists management
    getLists() {
        return this._lists;
    }
    
    createList(name, color = null) {
        const list = {
            id: this._lists.length > 0 ? Math.max(...this._lists.map(l => l.id)) + 1 : 1,
            name: name,
            color: color,
            created: Date.now()
        };
        this._lists.push(list);
        this._save();
        return list.id;
    }
    
    deleteList(listId) {
        // Remove items from this list
        this._items.forEach(item => {
            if (item.listId === listId) {
                item.listId = null;
            }
        });
        
        this._lists = this._lists.filter(l => l.id !== listId);
        this._save();
    }
    
    addItemToList(itemId, listId) {
        const item = this._items.find(i => i.id === itemId);
        if (item) {
            item.listId = listId;
            this._save();
        }
    }
    
    // Export/Import
    exportData() {
        return JSON.stringify({
            version: 1,
            items: this._items,
            lists: this._lists,
            exported: new Date().toISOString()
        }, null, 2);
    }
    
    importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (data.items) {
                // Merge with existing items
                data.items.forEach(item => {
                    const hash = this._hashContent(item.content);
                    if (!this._items.find(i => i.hash === hash)) {
                        item.id = this._nextId++;
                        this._items.push(item);
                    }
                });
            }
            if (data.lists) {
                data.lists.forEach(list => {
                    if (!this._lists.find(l => l.name === list.name)) {
                        list.id = this._lists.length > 0 ? Math.max(...this._lists.map(l => l.id)) + 1 : 1;
                        this._lists.push(list);
                    }
                });
            }
            this._save();
            return true;
        } catch (e) {
            log(`ClipMaster: Import error: ${e.message}`);
            return false;
        }
    }
    
    getStats() {
        const stats = {
            total: this._items.length,
            favorites: this._items.filter(i => i.isFavorite).length,
            byType: {}
        };
        
        this._items.forEach(item => {
            stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
        });
        
        return stats;
    }
}


// ============================================================================
// Clipboard Monitor - Watches for clipboard changes (Optimized)
// ============================================================================
class ClipboardMonitor {
    constructor(settings, database, onNewItem) {
        this._settings = settings;
        this._database = database;
        this._onNewItem = onNewItem;
        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._lastContent = null;
        this._lastPrimaryContent = null;
        this._lastImageHash = null;
        this._lastPrimaryImageHash = null;
        this._timeoutId = null;
        this._primaryTimeoutId = null;
        this._selectionOwnerChangedId = null;
        this._primarySelectionOwnerChangedId = null;
        this._primarySelectionSettingId = null;
        this._imageCheckProcess = null;
        
        // Grace period for PRIMARY selection on startup (to avoid capturing typing)
        // During this period, we'll only update _lastPrimaryContent but not save to history
        this._primaryGracePeriodEnd = 0; // Will be set when tracking starts
        this._primaryGracePeriodMs = 5000; // 5 seconds grace period
        
        // Cache settings to avoid repeated lookups (MB converted to bytes)
        // Handle both old (bytes) and new (MB) settings keys for compatibility
        let maxItemSize, maxImageSize;
        try {
            maxItemSize = settings.get_int('max-item-size-mb') * 1024 * 1024;
        } catch (e) {
            maxItemSize = 1024 * 1024; // 1MB default
        }
        try {
            maxImageSize = settings.get_int('max-image-size-mb') * 1024 * 1024;
        } catch (e) {
            maxImageSize = 5 * 1024 * 1024; // 5MB default
        }
        
        this._cachedSettings = {
            trackImages: settings.get_boolean('track-images'),
            maxItemSize: maxItemSize,
            maxImageSize: maxImageSize,
            historySize: settings.get_int('history-size')
        };
        
        // Listen for settings changes
        this._settingsChangedId = settings.connect('changed', (settings, key) => {
            this._updateCachedSetting(key);
        });
    }
    
    _updateCachedSetting(key) {
        try {
            switch (key) {
                case 'track-images':
                    this._cachedSettings.trackImages = this._settings.get_boolean('track-images');
                    break;
                case 'max-item-size-mb':
                    this._cachedSettings.maxItemSize = this._settings.get_int('max-item-size-mb') * 1024 * 1024;
                    break;
                case 'max-image-size-mb':
                    this._cachedSettings.maxImageSize = this._settings.get_int('max-image-size-mb') * 1024 * 1024;
                    break;
                case 'history-size':
                    this._cachedSettings.historySize = this._settings.get_int('history-size');
                    break;
            }
        } catch (e) {
            log(`ClipMaster: Error updating setting ${key}: ${e.message}`);
        }
    }
    
    start() {
        // Monitor CLIPBOARD selection changes (Ctrl+C/V)
        this._selectionOwnerChangedId = this._selection.connect(
            'owner-changed',
            this._onSelectionOwnerChanged.bind(this)
        );
        
        // Monitor PRIMARY selection changes (middle mouse button) - only if enabled
        if (this._settings.get_boolean('track-primary-selection')) {
            // Set grace period end time (5 seconds from now)
            this._primaryGracePeriodEnd = Date.now() + this._primaryGracePeriodMs;
            debugLog(`Primary selection tracking enabled. Grace period until: ${new Date(this._primaryGracePeriodEnd).toISOString()}`);
            
            this._primarySelectionOwnerChangedId = this._selection.connect(
                'owner-changed',
                this._onPrimarySelectionOwnerChanged.bind(this)
            );
            // Initial check - but don't save during grace period
            this._checkPrimaryClipboard(true); // true = isInitialCheck
        }
        
        // Listen for settings changes
        this._primarySelectionSettingId = this._settings.connect('changed::track-primary-selection', () => {
            const enabled = this._settings.get_boolean('track-primary-selection');
            if (enabled && !this._primarySelectionOwnerChangedId) {
                // Enable primary selection tracking
                // Set grace period end time (5 seconds from now)
                this._primaryGracePeriodEnd = Date.now() + this._primaryGracePeriodMs;
                debugLog(`Primary selection tracking enabled via settings. Grace period until: ${new Date(this._primaryGracePeriodEnd).toISOString()}`);
                
                this._primarySelectionOwnerChangedId = this._selection.connect(
                    'owner-changed',
                    this._onPrimarySelectionOwnerChanged.bind(this)
                );
                this._checkPrimaryClipboard(true); // true = isInitialCheck
            } else if (!enabled && this._primarySelectionOwnerChangedId) {
                // Disable primary selection tracking
                this._selection.disconnect(this._primarySelectionOwnerChangedId);
                this._primarySelectionOwnerChangedId = null;
            }
        });
        
        // Initial check
        this._checkClipboard();
    }
    
    stop() {
        if (this._selectionOwnerChangedId) {
            this._selection.disconnect(this._selectionOwnerChangedId);
            this._selectionOwnerChangedId = null;
        }
        
        if (this._primarySelectionOwnerChangedId) {
            this._selection.disconnect(this._primarySelectionOwnerChangedId);
            this._primarySelectionOwnerChangedId = null;
        }
        
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        
        if (this._primarySelectionSettingId) {
            this._settings.disconnect(this._primarySelectionSettingId);
            this._primarySelectionSettingId = null;
        }
        
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        
        if (this._primaryTimeoutId) {
            GLib.source_remove(this._primaryTimeoutId);
            this._primaryTimeoutId = null;
        }
        
        this._cancelImageCheck();
    }
    
    _cancelImageCheck() {
        if (this._imageCheckProcess) {
            try {
                this._imageCheckProcess.force_exit();
            } catch (e) {
                // Process may already be finished
            }
            this._imageCheckProcess = null;
        }
    }
    
    _onSelectionOwnerChanged(selection, selectionType, selectionSource) {
        debugLog(`Selection owner changed, type=${selectionType}`);
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
            debugLog(`Clipboard selection changed!`);
            // Delay to let clipboard settle
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
            }
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._checkClipboard();
                this._timeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }
    
    _onPrimarySelectionOwnerChanged(selection, selectionType, selectionSource) {
        debugLog(`Primary selection owner changed, type=${selectionType}`);
        if (selectionType === Meta.SelectionType.SELECTION_PRIMARY) {
            debugLog(`Primary selection changed!`);
            // Delay to let clipboard settle
            if (this._primaryTimeoutId) {
                GLib.source_remove(this._primaryTimeoutId);
            }
            this._primaryTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._checkPrimaryClipboard();
                this._primaryTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }
    
    _checkClipboard() {
        debugLog(`Checking clipboard...`);
        // Check for text
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
            debugLog(`Got text from clipboard: "${text ? text.substring(0, 50) : 'null'}"`);
            debugLog(`Last content was: "${this._lastContent ? this._lastContent.substring(0, 50) : 'null'}"`);
            
            // Check skip-duplicates setting
            let skipDuplicates = true;
            try {
                skipDuplicates = this._settings.get_boolean('skip-duplicates');
            } catch (e) {
                skipDuplicates = true;
            }
            
            if (text && text !== this._lastContent) {
                // New content - always process
                debugLog(`NEW content detected, processing...`);
                this._lastContent = text;
                this._processText(text, 'CLIPBOARD');
            } else if (text && text === this._lastContent && !skipDuplicates) {
                // Same content but skip-duplicates is OFF - process anyway
                debugLog(`Same content but skip-duplicates=OFF, processing anyway...`);
                this._processText(text, 'CLIPBOARD');
            } else if (!text && this._cachedSettings.trackImages) {
                // No text, check for image
                this._checkForImage('CLIPBOARD');
            } else {
                debugLog(`Same content or null, skipping (skipDuplicates=${skipDuplicates})`);
            }
        });
    }
    
    _checkPrimaryClipboard(isInitialCheck = false) {
        debugLog(`Checking primary clipboard... (isInitialCheck=${isInitialCheck})`);
        // Check for text from PRIMARY selection
        this._clipboard.get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
            debugLog(`Got text from primary: "${text ? text.substring(0, 50) : 'null'}"`);
            debugLog(`Last primary content was: "${this._lastPrimaryContent ? this._lastPrimaryContent.substring(0, 50) : 'null'}"`);
            
            // Filter out very short selections (single characters, etc.)
            // PRIMARY selection often changes when user selects text while typing
            // We only want to track meaningful selections (3+ characters)
            if (text) {
                const trimmedText = text.trim();
                // Ignore single characters, very short selections, or only whitespace
                if (trimmedText.length < 3) {
                    debugLog(`Ignoring PRIMARY selection: too short (${trimmedText.length} chars): "${trimmedText}"`);
                    // Update lastPrimaryContent to prevent re-processing, but don't save to history
                    this._lastPrimaryContent = text;
                    return;
                }
            }
            
            // Check if we're in grace period (first 5 seconds after extension start)
            const now = Date.now();
            const inGracePeriod = now < this._primaryGracePeriodEnd;
            
            if (inGracePeriod) {
                debugLog(`In grace period (${Math.round((this._primaryGracePeriodEnd - now) / 1000)}s remaining). Updating lastPrimaryContent but NOT saving to history.`);
                // During grace period, just update _lastPrimaryContent but don't save to history
                // This prevents capturing typing during startup
                if (text) {
                    this._lastPrimaryContent = text;
                }
                return; // Don't process during grace period
            }
            
            // Check skip-duplicates setting
            let skipDuplicates = true;
            try {
                skipDuplicates = this._settings.get_boolean('skip-duplicates');
            } catch (e) {
                skipDuplicates = true;
            }
            
            if (text && text !== this._lastPrimaryContent) {
                // New content - always process
                debugLog(`NEW primary content detected, processing...`);
                this._lastPrimaryContent = text;
                this._processText(text, 'PRIMARY');
            } else if (text && text === this._lastPrimaryContent && !skipDuplicates) {
                // Same content but skip-duplicates is OFF - process anyway
                debugLog(`Same primary content but skip-duplicates=OFF, processing anyway...`);
                this._processText(text, 'PRIMARY');
            } else if (!text && this._cachedSettings.trackImages) {
                // No text, check for image
                this._checkForImage('PRIMARY');
            } else {
                debugLog(`Same primary content or null, skipping (skipDuplicates=${skipDuplicates})`);
            }
        });
    }
    
    _checkForImage(selectionType = 'CLIPBOARD') {
        // Cancel any pending image check
        this._cancelImageCheck();
        
        // Detect Wayland vs X11
        const isWayland = GLib.getenv('XDG_SESSION_TYPE') === 'wayland';
        const clipTool = isWayland ? 'wl-paste' : 'xclip';
        
        // First check if there's an image in clipboard using MIME type check
        let checkCmd, getCmd;
        
        if (isWayland) {
            checkCmd = ['wl-paste', '--list-types'];
            getCmd = ['wl-paste', '--type', 'image/png'];
        } else {
            const selection = selectionType === 'PRIMARY' ? 'primary' : 'clipboard';
            checkCmd = ['xclip', '-selection', selection, '-o', '-t', 'TARGETS'];
            getCmd = ['xclip', '-selection', selection, '-o', '-t', 'image/png'];
        }
        
        try {
            // Check if image type is available
            const checkProc = Gio.Subprocess.new(
                checkCmd,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            
            checkProc.communicate_utf8_async(null, null, (proc, result) => {
                try {
                    const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                    
                    // Check if image MIME type is available
                    if (stdout && (stdout.includes('image/png') || 
                                   stdout.includes('image/jpeg') || 
                                   stdout.includes('image/gif'))) {
                        // Get the actual image data
                        this._fetchImageFromClipboard(isWayland, selectionType);
                    }
                } catch (e) {
                    // Silently fail - clipboard tool might not be available
                }
            });
        } catch (e) {
            log(`ClipMaster: Image check error: ${e.message}`);
        }
    }
    
    _fetchImageFromClipboard(isWayland, selectionType = 'CLIPBOARD') {
        const maxSize = this._cachedSettings.maxImageSize;
        
        // Create temp file for image
        const tempDir = GLib.get_tmp_dir();
        const timestamp = Date.now();
        const tempPath = GLib.build_filenamev([tempDir, `clipmaster_${timestamp}.png`]);
        
        let getCmd;
        if (isWayland) {
            getCmd = ['bash', '-c', `wl-paste --type image/png > "${tempPath}"`];
        } else {
            const selection = selectionType === 'PRIMARY' ? 'primary' : 'clipboard';
            getCmd = ['bash', '-c', `xclip -selection ${selection} -o -t image/png > "${tempPath}"`];
        }
        
        try {
            const proc = Gio.Subprocess.new(
                getCmd,
                Gio.SubprocessFlags.NONE
            );
            
            this._imageCheckProcess = proc;
            
            proc.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                    
                    if (proc.get_successful()) {
                        // Read the image file
                        const file = Gio.File.new_for_path(tempPath);
                        
                        if (file.query_exists(null)) {
                            const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                            const size = info.get_size();
                            
                            if (size > 0 && size <= maxSize) {
                                // Generate hash for deduplication
                                const [success, contents] = file.load_contents(null);
                                if (success) {
                                    const hash = this._hashImageData(contents);
                                    
                                    const isPrimary = selectionType === 'PRIMARY';
                                    const lastHash = isPrimary ? this._lastPrimaryImageHash : this._lastImageHash;
                                    
                                    if (hash !== lastHash) {
                                        if (isPrimary) {
                                            this._lastPrimaryImageHash = hash;
                                        } else {
                                            this._lastImageHash = hash;
                                        }
                                        
                                        // Store image as base64
                                        const base64 = GLib.base64_encode(contents);
                                        
                                        // Save to images directory
                                        const imagesDir = GLib.build_filenamev([
                                            GLib.get_user_data_dir(), 'clipmaster', 'images'
                                        ]);
                                        GLib.mkdir_with_parents(imagesDir, 0o755);
                                        
                                        const imagePath = GLib.build_filenamev([
                                            imagesDir, `${timestamp}.png`
                                        ]);
                                        
                                        // Copy to permanent location
                                        const destFile = Gio.File.new_for_path(imagePath);
                                        file.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                                        
                                        // Add to database
                                        const item = {
                                            type: ItemType.IMAGE,
                                            content: imagePath,
                                            plainText: `[Image ${timestamp}]`,
                                            preview: `Image (${Math.round(size / 1024)}KB)`,
                                            imageFormat: 'png',
                                            metadata: {
                                                size: size,
                                                path: imagePath,
                                                hash: hash
                                            }
                                        };
                                        
                                        const itemId = this._database.addItem(item);
                                        this._database.enforceLimit(this._cachedSettings.historySize);
                                        
                                        if (this._onNewItem) {
                                            this._onNewItem(itemId);
                                        }
                                    }
                                }
                            }
                            
                            // Clean up temp file
                            try {
                                file.delete(null);
                            } catch (e) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                } catch (e) {
                    log(`ClipMaster: Image fetch error: ${e.message}`);
                }
                
                this._imageCheckProcess = null;
            });
        } catch (e) {
            log(`ClipMaster: Image subprocess error: ${e.message}`);
        }
    }
    
    _hashImageData(data) {
        // Simple hash for image deduplication
        let hash = 0;
        const view = new Uint8Array(data);
        const sampleSize = Math.min(view.length, 10000);
        const step = Math.max(1, Math.floor(view.length / sampleSize));
        
        for (let i = 0; i < view.length; i += step) {
            hash = ((hash << 5) - hash) + view[i];
            hash = hash & hash;
        }
        return hash.toString(16);
    }
    
    _processText(text, selectionType = 'CLIPBOARD') {
        if (!text || text.trim() === '') return;
        
        if (text.length > this._cachedSettings.maxItemSize) {
            text = text.substring(0, this._cachedSettings.maxItemSize);
        }
        
        // Detect content type
        let type = ItemType.TEXT;
        const trimmed = text.trim();
        
        if (trimmed.match(/^https?:\/\//i)) {
            type = ItemType.URL;
        } else if (trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)) {
            type = ItemType.COLOR;
        } else if (trimmed.startsWith('<') && trimmed.includes('>')) {
            type = ItemType.HTML;
        } else if (trimmed.startsWith('file://')) {
            type = ItemType.FILE;
        }
        
        const item = {
            type: type,
            content: text,
            plainText: text,
            preview: text.substring(0, 200).replace(/\n/g, ' '),
            sourceApp: selectionType === 'PRIMARY' ? 'PRIMARY' : null
        };
        
        const itemId = this._database.addItem(item);
        
        // Enforce history limit
        this._database.enforceLimit(this._cachedSettings.historySize);
        
        if (this._onNewItem) {
            this._onNewItem(itemId);
        }
    }
    
    copyToClipboard(text, asPlainText = false) {
        if (asPlainText) {
            // Strip any formatting
            text = text.replace(/<[^>]*>/g, '');
        }
        this._lastContent = text; // Prevent re-adding
        // Always copy to CLIPBOARD
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        
        // Also copy to PRIMARY selection if tracking is enabled
        try {
            if (this._settings.get_boolean('track-primary-selection')) {
                this._clipboard.set_text(St.ClipboardType.PRIMARY, text);
                this._lastPrimaryContent = text; // Prevent re-adding to PRIMARY
            }
        } catch (e) {
            log(`ClipMaster: Error copying to PRIMARY selection: ${e.message}`);
        }
    }
    
    copyImageToClipboard(imagePath) {
        // Use wl-copy/xclip to copy image back to clipboard
        const isWayland = GLib.getenv('XDG_SESSION_TYPE') === 'wayland';
        
        try {
            if (isWayland) {
                // wl-copy reads from stdin - copy to CLIPBOARD
                const procClipboard = Gio.Subprocess.new(
                    ['bash', '-c', `cat "${imagePath}" | wl-copy --type image/png`],
                    Gio.SubprocessFlags.NONE
                );
                procClipboard.wait_async(null, null);
                
                // Note: wl-copy doesn't support PRIMARY selection directly
                // PRIMARY selection for images in Wayland is limited
                // We'll copy to CLIPBOARD and user can use Ctrl+V
            } else {
                // X11 - copy to CLIPBOARD
                const procClipboard = Gio.Subprocess.new(
                    ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-i', imagePath],
                    Gio.SubprocessFlags.NONE
                );
                procClipboard.wait_async(null, null);
                
                // Also copy to PRIMARY selection if tracking is enabled
                try {
                    if (this._settings.get_boolean('track-primary-selection')) {
                        const procPrimary = Gio.Subprocess.new(
                            ['xclip', '-selection', 'primary', '-t', 'image/png', '-i', imagePath],
                            Gio.SubprocessFlags.NONE
                        );
                        procPrimary.wait_async(null, null);
                    }
                } catch (e) {
                    log(`ClipMaster: Error copying image to PRIMARY selection: ${e.message}`);
                }
            }
        } catch (e) {
            log(`ClipMaster: Error copying image to clipboard: ${e.message}`);
        }
    }
}


// ============================================================================
// Clipboard Popup - Main UI (With Modal Overlay for Click Outside)
// ============================================================================
const ClipboardPopup = GObject.registerClass(
class ClipboardPopup extends St.BoxLayout {
    _init(extension) {
        super._init({
            style_class: 'clipmaster-popup',
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            visible: false,
            opacity: 0,  // Start fully transparent!
            x: 100,
            y: 100,
            width: 450,
            height: 550
        });
        
        this._extension = extension;
        this._settings = extension._settings;
        this._database = extension._database;
        this._monitor = extension._monitor;
        
        this._selectedIndex = 0;
        this._items = [];
        this._searchQuery = '';
        this._currentListId = null;
        this._plainTextMode = false;
        this._isPinned = false;  // Pin state - keeps popup open on outside click
        this._isShowing = false;  // Track if popup is intentionally shown
        this._showTime = 0;  // Track when popup was shown (for grace period)
        this._pasteFromHover = false;  // Track if paste came from hover (paste-on-select)
        this._customStylesheet = null;  // Track custom theme stylesheet
        
        // Drag state
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPosX = 0;
        this._dragStartPosY = 0;
        
        // Modal overlay for click-outside detection
        this._modalOverlay = null;
        
        // Apply theme
        this._applyTheme();
        
        // Listen for theme changes
        this._themeChangedId = this._settings.connect('changed::dark-theme', () => {
            this._applyTheme();
        });
        this._themeNameChangedId = this._settings.connect('changed::theme', () => {
            this._applyTheme();
        });
        this._customThemeChangedId = this._settings.connect('changed::custom-theme-path', () => {
            this._applyTheme();
        });
        
        this._buildUI();
        this._connectSignals();
    }
    
    _applyTheme() {
        try {
            // Remove all theme classes
            this.remove_style_class_name('light');
            this.remove_style_class_name('theme-catppuccin');
            this.remove_style_class_name('theme-dracula');
            this.remove_style_class_name('theme-nord');
            this.remove_style_class_name('theme-gruvbox');
            this.remove_style_class_name('theme-onedark');
            this.remove_style_class_name('theme-adwaita');
            this.remove_style_class_name('theme-monokai');
            this.remove_style_class_name('theme-solarized');
            this.remove_style_class_name('theme-tokyonight');
            this.remove_style_class_name('theme-rosepine');
            this.remove_style_class_name('theme-material');
            this.remove_style_class_name('theme-ayu');
            
            // Check for custom theme
            const customThemePath = this._settings.get_string('custom-theme-path') || '';
            if (customThemePath) {
                // Load custom theme
                const customFile = Gio.File.new_for_path(customThemePath);
                if (customFile.query_exists(null)) {
                    try {
                        // Unload previous custom theme if any
                        if (this._customStylesheet) {
                            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                            theme.unload_stylesheet(this._customStylesheet);
                        }
                        // Load new custom theme
                        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                        theme.load_stylesheet(customFile);
                        this._customStylesheet = customFile;
                    } catch (e) {
                        log(`ClipMaster: Error loading custom theme: ${e.message}`);
                    }
                }
            } else {
                // Unload custom theme if cleared
                if (this._customStylesheet) {
                    try {
                        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                        theme.unload_stylesheet(this._customStylesheet);
                        this._customStylesheet = null;
                    } catch (e) {
                        log(`ClipMaster: Error unloading custom theme: ${e.message}`);
                    }
                }
            }
            
            // Apply selected theme (only if no custom theme)
            if (!customThemePath) {
                const themeName = this._settings.get_string('theme') || 'gruvbox';
                this.add_style_class_name(`theme-${themeName}`);
            }
            
            // Also apply light/dark based on dark-theme setting (for backward compatibility)
            const isDark = this._settings.get_boolean('dark-theme');
            if (!isDark) {
                this.add_style_class_name('light');
            }
        } catch (e) {
            log(`ClipMaster: Theme error: ${e.message}`);
        }
    }
    
    _buildUI() {
        // Header
        this._header = new St.BoxLayout({
            style_class: 'clipmaster-header',
            x_expand: true,
            reactive: true
        });
        
        // ClipMaster icon (also serves as drag indicator)
        const headerIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                this._extension._extensionPath + '/icons/clipmaster-symbolic.svg'
            ),
            style_class: 'clipmaster-header-icon',
            icon_size: 18
        });
        this._header.add_child(headerIcon);
        
        // Title
        const title = new St.Label({
            text: 'ClipMaster',
            style_class: 'clipmaster-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START
        });
        this._header.add_child(title);
        
        // Plain text button - paste as plain text
        this._plainTextButton = new St.Button({
            style_class: 'clipmaster-toggle-button',
            child: new St.Icon({
                icon_name: 'text-x-generic-symbolic',
                icon_size: 16
            }),
            can_focus: false
        });
        this._plainTextButton.connect('button-press-event', () => {
            this._plainTextMode = !this._plainTextMode;
            if (this._plainTextMode) {
                this._plainTextButton.add_style_pseudo_class('checked');
            } else {
                this._plainTextButton.remove_style_pseudo_class('checked');
            }
            debugLog(`Plain text mode toggled: ${this._plainTextMode}`);
            return Clutter.EVENT_STOP;
        });
        this._header.add_child(this._plainTextButton);
        
        // Pin button - keeps popup open when clicking outside
        this._pinButton = new St.Button({
            style_class: 'clipmaster-toggle-button',
            child: new St.Icon({
                icon_name: 'view-pin-symbolic',
                icon_size: 16
            }),
            can_focus: false
        });
        this._pinButton.connect('button-press-event', () => {
            this._isPinned = !this._isPinned;
            if (this._isPinned) {
                this._pinButton.add_style_pseudo_class('checked');
                debugLog(`Pin ENABLED - popup will stay open`);
            } else {
                this._pinButton.remove_style_pseudo_class('checked');
                debugLog(`Pin DISABLED - popup will close on outside click`);
            }
            debugLog(`Pin toggled: ${this._isPinned}`);
            return Clutter.EVENT_STOP;
        });
        this._header.add_child(this._pinButton);
        
        // Add List button
        this._addListButton = new St.Button({
            style_class: 'clipmaster-toggle-button',
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                icon_size: 16
            }),
            can_focus: false
        });
        this._addListButton.connect('button-press-event', () => {
            debugLog('Add list button pressed');
            this._showCreateListDialog();
            return Clutter.EVENT_STOP;
        });
        this._addListButton.connect('clicked', () => {
            debugLog('Add list button clicked');
            this._showCreateListDialog();
            return Clutter.EVENT_STOP;
        });
        this._header.add_child(this._addListButton);
        
        // Close button - CRITICAL: must stop event propagation
        this._closeButton = new St.Button({
            style_class: 'clipmaster-close-button',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 16
            }),
            can_focus: false  // Prevent focus stealing
        });
        this._closeButton.connect('button-press-event', () => {
            debugLog('Close button pressed');
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;
        });
        this._closeButton.connect('clicked', () => {
            debugLog('Close button clicked');
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;
        });
        this._header.add_child(this._closeButton);
        
        // Header drag - entire header is draggable
        this._header.connect('button-press-event', (actor, event) => {
            debugLog(`Header button-press-event triggered`);
            
            // Don't start drag if clicking on buttons
            try {
                const source = event.get_source();
                debugLog(`Event source: ${source ? source.toString() : 'null'}`);
                
                if (!source) {
                    debugLog(`No source, starting drag anyway`);
                    if (event.get_button() === 1) {
                        this._startDrag(event);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }
                
                const parent = source.get_parent ? source.get_parent() : null;
                
                // Check if clicking on buttons
                if (source === this._closeButton || 
                    source === this._pinButton ||
                    source === this._plainTextButton ||
                    source === this._addListButton ||
                    parent === this._closeButton ||
                    parent === this._pinButton ||
                    parent === this._plainTextButton ||
                    parent === this._addListButton) {
                    debugLog(`Clicked on button, not starting drag`);
                    return Clutter.EVENT_PROPAGATE;
                }
                
                if (event.get_button() === 1) {
                    debugLog(`Left click on header, starting drag`);
                    this._startDrag(event);
                    return Clutter.EVENT_STOP;
                }
            } catch (e) {
                debugLog(`Header drag error: ${e.message}`);
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        this.add_child(this._header);
        
        // Search bar
        this._searchEntry = new St.Entry({
            style_class: 'clipmaster-search',
            hint_text: _('Search... (type to filter)'),
            can_focus: true,
            x_expand: true
        });
        this._searchEntry.clutter_text.connect('text-changed', () => {
            this._searchQuery = this._searchEntry.get_text();
            this._loadItems();
        });
        this.add_child(this._searchEntry);
        
        // Filter bar
        const filterBar = new St.BoxLayout({
            style_class: 'clipmaster-filter-bar',
            x_expand: true
        });
        
        this._allButton = new St.Button({
            style_class: 'clipmaster-filter-button active',
            label: _('All'),
            can_focus: false
        });
        this._allButton.connect('clicked', () => { this._setFilter(null); return Clutter.EVENT_STOP; });
        filterBar.add_child(this._allButton);
        
        this._favButton = new St.Button({
            style_class: 'clipmaster-filter-button',
            child: new St.Icon({ icon_name: 'starred-symbolic', icon_size: 14 }),
            can_focus: false
        });
        this._favButton.connect('clicked', () => { this._setFilter(-1); return Clutter.EVENT_STOP; });
        filterBar.add_child(this._favButton);
        
        this._textButton = new St.Button({
            style_class: 'clipmaster-filter-button',
            label: _('Text'),
            can_focus: false
        });
        this._textButton.connect('clicked', () => { this._setFilter(null, ItemType.TEXT); return Clutter.EVENT_STOP; });
        filterBar.add_child(this._textButton);
        
        this._imageButton = new St.Button({
            style_class: 'clipmaster-filter-button',
            label: _('Images'),
            can_focus: false
        });
        this._imageButton.connect('clicked', () => { this._setFilter(null, ItemType.IMAGE); return Clutter.EVENT_STOP; });
        filterBar.add_child(this._imageButton);
        
        // Lists dropdown
        this._listsButton = new St.Button({
            style_class: 'clipmaster-filter-button',
            label: _('Lists ▾'),
            can_focus: false
        });
        this._listsButton.connect('clicked', () => { this._showListsMenu(); return Clutter.EVENT_STOP; });
        filterBar.add_child(this._listsButton);
        
        this.add_child(filterBar);
        
        // Items scroll view
        this._scrollView = new St.ScrollView({
            style_class: 'clipmaster-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });
        
        this._itemsBox = new St.BoxLayout({
            style_class: 'clipmaster-items',
            vertical: true,
            x_expand: true
        });
        
        this._scrollView.add_child(this._itemsBox);
        this.add_child(this._scrollView);
        
        // Footer
        const footer = new St.BoxLayout({
            style_class: 'clipmaster-footer',
            x_expand: true
        });
        
        const shortcutText = new St.Label({
            text: '↑↓ Nav • Enter Paste • F Fav • T Text • P Pin • Del • Esc',
            style_class: 'clipmaster-footer-text',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER
        });
        footer.add_child(shortcutText);
        
        this.add_child(footer);
    }
    
    _showCreateListDialog() {
        debugLog('_showCreateListDialog called');
        try {
            const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });
            
            const label = new St.Label({
                text: _('Create New List'),
                style_class: 'clipmaster-dialog-title'
            });
            dialog.contentLayout.add_child(label);
            
            const entry = new St.Entry({
                style_class: 'clipmaster-dialog-entry',
                hint_text: _('List name...'),
                can_focus: true
            });
            dialog.contentLayout.add_child(entry);
            
            dialog.addButton({
                label: _('Cancel'),
                action: () => {
                    debugLog('Dialog cancelled');
                    dialog.close();
                },
                key: Clutter.KEY_Escape
            });
            
            dialog.addButton({
                label: _('Create'),
                action: () => {
                    const name = entry.get_text().trim();
                    debugLog(`Creating list with name: ${name}`);
                    if (name) {
                        const listId = this._database.createList(name);
                        debugLog(`List created with ID: ${listId}`);
                        this._loadItems();
                        Main.notify('ClipMaster', _('List created successfully'));
                    } else {
                        debugLog('List name is empty');
                    }
                    dialog.close();
                },
                default: true
            });
            
            debugLog('Opening dialog...');
            dialog.open();
            entry.grab_key_focus();
        } catch (e) {
            log(`ClipMaster: Error showing create list dialog: ${e.message}`);
            debugLog(`Dialog error: ${e.message}`);
            Main.notify('ClipMaster', _('Error creating list dialog'));
        }
    }
    
    _showListsMenu() {
        const lists = this._database.getLists();
        
        if (lists.length === 0) {
            Main.notify('ClipMaster', _('No custom lists. Click + to create one.'));
            return;
        }
        
        // Create a simple menu
        const menu = new PopupMenu.PopupMenu(this._listsButton, 0.0, St.Side.TOP);
        
        lists.forEach(list => {
            // Create a menu item with delete button
            const menuItem = new PopupMenu.PopupMenuItem(list.name);
            menuItem.connect('activate', () => {
                this._setFilter(list.id);
            });
            
            // Add delete button
            const deleteButton = new St.Button({
                style_class: 'clipmaster-list-delete-button',
                child: new St.Icon({
                    icon_name: 'edit-delete-symbolic',
                    icon_size: 14
                }),
                can_focus: false
            });
            deleteButton.connect('clicked', () => {
                debugLog(`Deleting list: ${list.name} (ID: ${list.id})`);
                this._database.deleteList(list.id);
                this._loadItems();
                menu.close();
                Main.notify('ClipMaster', _('List deleted'));
                return Clutter.EVENT_STOP;
            });
            
            menuItem.add_child(deleteButton);
            menu.addMenuItem(menuItem);
        });
        
        Main.uiGroup.add_child(menu.actor);
        menu.open();
        
        menu.connect('open-state-changed', (menu, open) => {
            if (!open) menu.destroy();
        });
    }
    
    _startDrag(event) {
        debugLog(`_startDrag called`);
        try {
            this._dragging = true;
            [this._dragStartX, this._dragStartY] = event.get_coords();
            [this._dragStartPosX, this._dragStartPosY] = this.get_position();
            
            debugLog(`Drag start coords: (${this._dragStartX}, ${this._dragStartY})`);
            debugLog(`Popup position: (${this._dragStartPosX}, ${this._dragStartPosY})`);
            
            if (isNaN(this._dragStartX) || isNaN(this._dragStartY) ||
                isNaN(this._dragStartPosX) || isNaN(this._dragStartPosY)) {
                debugLog(`Invalid drag coords, cancelling`);
                this._dragging = false;
                return;
            }
            
            debugLog(`Connecting motion-event to global.stage`);
            this._dragMotionId = global.stage.connect('motion-event', (actor, motionEvent) => {
                if (!this._dragging) return Clutter.EVENT_PROPAGATE;
                
                try {
                    const [currentX, currentY] = motionEvent.get_coords();
                    if (isNaN(currentX) || isNaN(currentY)) return Clutter.EVENT_PROPAGATE;
                    
                    const newX = Math.round(this._dragStartPosX + (currentX - this._dragStartX));
                    const newY = Math.round(this._dragStartPosY + (currentY - this._dragStartY));
                    
                    if (!isNaN(newX) && !isNaN(newY)) {
                        this.set_position(newX, newY);
                    }
                } catch (e) {
                    debugLog(`Drag motion error: ${e.message}`);
                }
                return Clutter.EVENT_STOP;
            });
            
            this._dragReleaseId = global.stage.connect('button-release-event', () => {
                debugLog(`Drag released`);
                this._stopDrag();
                return Clutter.EVENT_STOP;
            });
            
            debugLog(`Drag setup complete, motionId=${this._dragMotionId}, releaseId=${this._dragReleaseId}`);
        } catch (e) {
            debugLog(`Start drag error: ${e.message}`);
            this._dragging = false;
        }
    }
    
    _stopDrag() {
        this._dragging = false;
        try {
            if (this._dragMotionId) {
                global.stage.disconnect(this._dragMotionId);
                this._dragMotionId = null;
            }
            if (this._dragReleaseId) {
                global.stage.disconnect(this._dragReleaseId);
                this._dragReleaseId = null;
            }
        } catch (e) { /* ignore */ }
    }
    
    _connectSignals() {
        this.connect('key-press-event', this._onKeyPress.bind(this));
    }
    
    _createModalOverlay() {
        // Don't use modal overlay - use simpler click detection
        // that checks if click is inside popup bounds
    }
    
    _removeModalOverlay() {
        this._stopDrag();
        if (this._clickOutsideId) {
            try {
                global.stage.disconnect(this._clickOutsideId);
            } catch (e) { /* ignore */ }
            this._clickOutsideId = null;
        }
    }
    
    _setupClickOutside() {
        // Remove existing handler first
        if (this._clickOutsideId) {
            debugLog('Removing existing click outside handler');
            try {
                global.stage.disconnect(this._clickOutsideId);
            } catch (e) {
                debugLog(`Error removing handler: ${e.message}`);
            }
            this._clickOutsideId = null;
        }
        
        debugLog('Setting up click outside handler');
        this._clickOutsideId = global.stage.connect('button-press-event', (actor, event) => {
            if (!this.visible || !this._isShowing) {
                return Clutter.EVENT_PROPAGATE;
            }
            
            // Grace period: ignore clicks within 1000ms of showing popup (increased)
            const timeSinceShow = Date.now() - this._showTime;
            if (timeSinceShow < 1000) {
                debugLog(`Ignoring click during grace period (${timeSinceShow}ms since show)`);
                return Clutter.EVENT_PROPAGATE;
            }
            
            // If pinned, don't close on outside click
            if (this._isPinned) {
                debugLog(`Popup is pinned, ignoring outside click`);
                return Clutter.EVENT_PROPAGATE;
            }
            
            try {
                const [clickX, clickY] = event.get_coords();
                const [popupX, popupY] = this.get_position();
                const [popupW, popupH] = this.get_size();
                
                debugLog(`Click at (${clickX}, ${clickY}), popup at (${popupX}, ${popupY}), size (${popupW}, ${popupH})`);
                
                // Check if click is INSIDE popup - if so, let it through
                const isInside = clickX >= popupX && clickX <= popupX + popupW &&
                                 clickY >= popupY && clickY <= popupY + popupH;
                
                if (isInside) {
                    debugLog('Click is inside popup, allowing');
                    // Click is inside popup, let it propagate to popup elements
                    return Clutter.EVENT_PROPAGATE;
                } else {
                    debugLog('Click is outside popup, closing');
                    // Click is outside popup, close it
                    this._extension.hidePopup();
                    return Clutter.EVENT_STOP;  // Stop propagation to prevent other handlers
                }
            } catch (e) {
                debugLog(`Click outside error: ${e.message}`);
                return Clutter.EVENT_PROPAGATE;
            }
        });
    }
    
    _setFilter(listId, type = null) {
        this._currentListId = listId;
        this._currentType = type;
        
        // Update button styles
        [this._allButton, this._favButton, this._textButton, this._imageButton, this._listsButton].forEach(b => {
            if (b) b.remove_style_class_name('active');
        });
        
        if (listId === -1) {
            this._favButton.add_style_class_name('active');
        } else if (type === ItemType.TEXT) {
            this._textButton.add_style_class_name('active');
        } else if (type === ItemType.IMAGE) {
            this._imageButton.add_style_class_name('active');
        } else if (listId !== null && listId > 0) {
            this._listsButton.add_style_class_name('active');
        } else {
            this._allButton.add_style_class_name('active');
        }
        
        this._loadItems();
    }
    
    show() {
        // Only show if intentionally triggered
        if (!this._isShowing) {
            return;
        }
        
        this._searchEntry.set_text('');
        this._searchQuery = '';
        this._selectedIndex = 0;
        this._currentListId = null;
        this._currentType = null;
        this._plainTextMode = false;
        // Don't reset pin state - user controls it explicitly
        
        this._loadItems();
        
        // Make popup visible AND opaque
        this.visible = true;
        this.opacity = 255;
        this.reactive = true;
        this._showTime = Date.now();  // Record show time for grace period
        
        debugLog(`Popup shown at ${this._showTime}`);
        
        // Setup click outside handler after popup is visible (longer delay to prevent immediate closing)
        // Use longer delay to ensure popup is fully rendered and user has time to see it
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            if (this._isShowing && this.visible) {
                debugLog('Setting up click outside handler after 800ms delay');
                this._setupClickOutside();
                this.grab_key_focus();
            } else {
                debugLog(`Not setting up click outside - isShowing=${this._isShowing}, visible=${this.visible}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    
    hide() {
        debugLog(`hide() called - _isPinned=${this._isPinned}, _isShowing=${this._isShowing}`);
        
        // If pinned, don't hide
        if (this._isPinned) {
            debugLog('Popup is pinned, not hiding');
            return;
        }
        
        this._isShowing = false;
        this._removeModalOverlay();  // This also removes click outside handler
        this.visible = false;
        this.opacity = 0;  // Make fully transparent
        this.reactive = false;
        debugLog('Popup hidden');
    }
    
    destroy() {
        this._removeModalOverlay();
        this._stopDrag();
        
        if (this._themeChangedId) {
            this._settings.disconnect(this._themeChangedId);
            this._themeChangedId = null;
        }
        if (this._themeNameChangedId) {
            this._settings.disconnect(this._themeNameChangedId);
            this._themeNameChangedId = null;
        }
        if (this._customThemeChangedId) {
            this._settings.disconnect(this._customThemeChangedId);
            this._customThemeChangedId = null;
        }
        
        // Unload custom stylesheet if any
        if (this._customStylesheet) {
            try {
                const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                theme.unload_stylesheet(this._customStylesheet);
                this._customStylesheet = null;
            } catch (e) {
                log(`ClipMaster: Error unloading custom theme on destroy: ${e.message}`);
            }
        }
        
        super.destroy();
    }
    
    _loadItems() {
        // Clear existing items
        this._itemsBox.destroy_all_children();
        
        const limit = this._settings.get_int('items-per-page');
        const options = {
            limit: limit,
            search: this._searchQuery || null,
            listId: this._currentListId,
            type: this._currentType
        };
        
        this._items = this._database.getItems(options);
        
        if (this._items.length === 0) {
            const emptyLabel = new St.Label({
                text: _('No clipboard items'),
                style_class: 'clipmaster-empty',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER
            });
            this._itemsBox.add_child(emptyLabel);
            return;
        }
        
        this._items.forEach((item, index) => {
            const row = this._createItemRow(item, index);
            this._itemsBox.add_child(row);
        });
        
        this._updateSelection();
    }
    
    _createItemRow(item, index) {
        const row = new St.BoxLayout({
            style_class: 'clipmaster-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true
        });
        row._item = item;
        row._index = index;
        
        // Connect click
        row.connect('button-press-event', (actor, event) => {
            debugLog(`Row ${index} button-press-event, button=${event.get_button()}`);
            if (event.get_button() === 1) {
                // Cancel any pending hover paste timeout
                if (row._pasteTimeoutId) {
                    debugLog(`Cancelling paste timeout for item ${index} (user clicked)`);
                    GLib.source_remove(row._pasteTimeoutId);
                    row._pasteTimeoutId = null;
                }
                
                // Single click - select and paste
                this._selectedIndex = index;
                this._updateSelection();
                debugLog(`Single click on row ${index}, selecting and pasting...`);
                // Paste selected item (not from hover, so popup will close if close-on-paste is enabled)
                this._pasteFromHover = false;
                this._pasteSelected();
                return Clutter.EVENT_STOP;
            } else if (event.get_button() === 3) {
                // Right click - show context menu
                this._selectedIndex = index;
                this._updateSelection();
                this._showContextMenu(item, row);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        // Hover - Paste on selection
        row.connect('enter-event', (actor, event) => {
            debugLog(`ENTER EVENT on row ${index}`);
            this._selectedIndex = index;
            this._updateSelection();
            
            // Paste on selection if enabled
            let pasteOnSelect = false;
            try {
                pasteOnSelect = this._settings.get_boolean('paste-on-select');
            } catch (e) {
                debugLog(`Error reading paste-on-select: ${e.message}`);
            }
            
            debugLog(`Hover on item ${index}, paste-on-select=${pasteOnSelect}, visible=${this.visible}, isShowing=${this._isShowing}`);
            
            if (pasteOnSelect) {
                // Store timeout ID to cancel if user moves away
                if (row._pasteTimeoutId) {
                    debugLog(`Cancelling existing paste timeout for row ${index}`);
                    GLib.source_remove(row._pasteTimeoutId);
                    row._pasteTimeoutId = null;
                }
                
                debugLog(`Setting up paste timeout for row ${index} (500ms delay)`);
                // Small delay to prevent accidental pastes while navigating
                row._pasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    debugLog(`Paste timeout fired for row ${index} - checking conditions...`);
                    debugLog(`  selectedIndex=${this._selectedIndex}, index=${index}, visible=${this.visible}, isShowing=${this._isShowing}`);
                    
                    // Only paste if still on the same item and popup is visible
                    if (this._selectedIndex === index && this.visible && this._isShowing) {
                        debugLog(`✓ Conditions met - PASTING item ${index} (from paste-on-select hover)`);
                        // Mark that this is from paste-on-select (not explicit click)
                        this._pasteFromHover = true;
                        // Paste to clipboard
                        this._pasteSelected();
                        // Reset after a short delay
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            this._pasteFromHover = false;
                            return GLib.SOURCE_REMOVE;
                        });
                    } else {
                        debugLog(`✗ Conditions NOT met - NOT pasting`);
                    }
                    row._pasteTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                debugLog(`Paste on select is DISABLED, not setting timeout`);
            }
        });
        
        // Cancel paste timeout if user leaves the row
        row.connect('leave-event', (actor, event) => {
            debugLog(`LEAVE EVENT on row ${index}`);
            if (row._pasteTimeoutId) {
                debugLog(`Cancelling paste timeout for item ${index} (user left row)`);
                GLib.source_remove(row._pasteTimeoutId);
                row._pasteTimeoutId = null;
            }
        });
        
        // Number badge for quick access (1-9)
        if (index < 9) {
            const numLabel = new St.Label({
                text: (index + 1).toString(),
                style_class: 'clipmaster-item-number'
            });
            row.add_child(numLabel);
        } else {
            const spacer = new St.Widget({ width: 24 });
            row.add_child(spacer);
        }
        
        // Type icon or image thumbnail
        if (item.type === ItemType.IMAGE && item.content) {
            // Try to show a small thumbnail for images
            try {
                const file = Gio.File.new_for_path(item.content);
                if (file.query_exists(null)) {
                    // Load image and create thumbnail
                    try {
                        // Use new_from_file for better compatibility (works on GNOME 42-49)
                        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(item.content);
                        
                        if (pixbuf) {
                            // Scale to thumbnail size (32x32 max, maintain aspect ratio)
                            const maxSize = 32;
                            let width = pixbuf.get_width();
                            let height = pixbuf.get_height();
                            let scaledPixbuf = pixbuf;
                            
                            if (width > maxSize || height > maxSize) {
                                const scale = Math.min(maxSize / width, maxSize / height);
                                const newWidth = Math.floor(width * scale);
                                const newHeight = Math.floor(height * scale);
                                scaledPixbuf = pixbuf.scale_simple(
                                    newWidth,
                                    newHeight,
                                    GdkPixbuf.InterpType.BILINEAR
                                );
                            }
                            
                            // Create texture from pixbuf - try multiple methods for compatibility
                            let texture = null;
                            
                            // Method 1: Try St.TextureCache (GNOME 45+)
                            try {
                                const textureCache = St.TextureCache.get_default();
                                if (textureCache && textureCache.load_pixbuf) {
                                    texture = textureCache.load_pixbuf(scaledPixbuf);
                                }
                            } catch (e) {
                                debugLog(`TextureCache method failed: ${e.message}`);
                            }
                            
                            // Method 2: Try Clutter.Image (fallback for older GNOME)
                            if (!texture) {
                                try {
                                    const clutterImage = new Clutter.Image();
                                    const pixels = scaledPixbuf.get_pixels();
                                    clutterImage.set_data(
                                        pixels,
                                        scaledPixbuf.get_colorspace(),
                                        scaledPixbuf.get_width(),
                                        scaledPixbuf.get_height(),
                                        scaledPixbuf.get_rowstride(),
                                        scaledPixbuf.get_bits_per_sample(),
                                        scaledPixbuf.get_n_channels()
                                    );
                                    texture = clutterImage;
                                } catch (e) {
                                    debugLog(`Clutter.Image method failed: ${e.message}`);
                                }
                            }
                            
                            if (texture) {
                                const thumbnail = new St.Bin({
                                    width: maxSize,
                                    height: maxSize,
                                    style_class: 'clipmaster-item-thumbnail',
                                    child: texture
                                });
                                row.add_child(thumbnail);
                                debugLog(`Image thumbnail added for: ${item.content}`);
                            } else {
                                throw new Error('Failed to create texture from pixbuf');
                            }
                        } else {
                            throw new Error('Failed to load pixbuf from file');
                        }
                    } catch (pixbufError) {
                        debugLog(`Pixbuf error: ${pixbufError.message}`);
                        // Fallback to file icon
                        try {
                            const gicon = new Gio.FileIcon({ file: file });
                            const thumbnail = new St.Icon({
                                gicon: gicon,
                                icon_size: 32,
                                style_class: 'clipmaster-item-thumbnail'
                            });
                            row.add_child(thumbnail);
                        } catch (iconError) {
                            debugLog(`Icon error: ${iconError.message}`);
                            // Final fallback to generic icon
                            const icon = new St.Icon({
                                icon_name: 'image-x-generic-symbolic',
                                icon_size: 16,
                                style_class: 'clipmaster-item-icon'
                            });
                            row.add_child(icon);
                        }
                    }
                } else {
                    debugLog(`Image file not found: ${item.content}`);
                    // Fallback to icon
                    const icon = new St.Icon({
                        icon_name: 'image-x-generic-symbolic',
                        icon_size: 16,
                        style_class: 'clipmaster-item-icon'
                    });
                    row.add_child(icon);
                }
            } catch (e) {
                debugLog(`Image thumbnail error: ${e.message}`);
                // Fallback to icon
                const icon = new St.Icon({
                    icon_name: 'image-x-generic-symbolic',
                    icon_size: 16,
                    style_class: 'clipmaster-item-icon'
                });
                row.add_child(icon);
            }
        } else {
            // Regular type icon
            const iconName = this._getTypeIcon(item.type);
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 16,
                style_class: 'clipmaster-item-icon'
            });
            row.add_child(icon);
        }
        
        // Content box
        const contentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'clipmaster-item-content'
        });
        
        // Title if exists
        if (item.title) {
            const titleLabel = new St.Label({
                text: item.title,
                style_class: 'clipmaster-item-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START
            });
            titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            contentBox.add_child(titleLabel);
        }
        
        // Preview
        let previewText = item.preview || item.plainText || item.content || '';
        if (item.type === ItemType.IMAGE) {
            const size = item.metadata?.size ? ` (${Math.round(item.metadata.size / 1024)}KB)` : '';
            previewText = `🖼️ Image${size}`;
        }
        
        const previewLength = this._settings.get_int('preview-length');
        if (previewText.length > previewLength) {
            previewText = previewText.substring(0, previewLength) + '...';
        }
        previewText = previewText.replace(/\n/g, ' ').trim();
        
        const previewLabel = new St.Label({
            text: previewText,
            style_class: item.title ? 'clipmaster-item-preview dim' : 'clipmaster-item-preview',
            x_expand: true,
            x_align: Clutter.ActorAlign.START
        });
        previewLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        contentBox.add_child(previewLabel);
        
        // Date/time display
        if (item.created) {
            const date = new Date(item.created);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            
            let timeText = '';
            if (diffMins < 1) {
                timeText = _('Just now');
            } else if (diffMins < 60) {
                timeText = `${diffMins} ${diffMins === 1 ? _('min') : _('mins')} ago`;
            } else if (diffHours < 24) {
                timeText = `${diffHours} ${diffHours === 1 ? _('hour') : _('hours')} ago`;
            } else if (diffDays < 7) {
                timeText = `${diffDays} ${diffDays === 1 ? _('day') : _('days')} ago`;
            } else {
                // Show date
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                const hours = String(date.getHours()).padStart(2, '0');
                const mins = String(date.getMinutes()).padStart(2, '0');
                timeText = `${day}.${month}.${year} ${hours}:${mins}`;
            }
            
            const timeLabel = new St.Label({
                text: timeText,
                style_class: 'clipmaster-item-time',
                x_expand: true,
                x_align: Clutter.ActorAlign.START
            });
            contentBox.add_child(timeLabel);
        }
        
        row.add_child(contentBox);
        
        // Favorite button (always visible, shows state)
        const favButton = new St.Button({
            style_class: 'clipmaster-fav-button',
            can_focus: false,
            reactive: true,
            track_hover: true
        });
        
        const favIcon = new St.Icon({
            icon_name: item.isFavorite ? 'starred-symbolic' : 'non-starred-symbolic',
            icon_size: 16,
            style_class: item.isFavorite ? 'clipmaster-item-fav' : 'clipmaster-item-fav-inactive'
        });
        favButton.set_child(favIcon);
        
        favButton.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) {
                // Toggle favorite
                const newFavoriteState = this._database.toggleFavorite(item.id);
                // Update icon
                favIcon.icon_name = newFavoriteState ? 'starred-symbolic' : 'non-starred-symbolic';
                favIcon.style_class = newFavoriteState ? 'clipmaster-item-fav' : 'clipmaster-item-fav-inactive';
                // Reload items to reflect changes
                this._loadItems();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        row.add_child(favButton);
        
        return row;
    }
    
    _getTypeIcon(type) {
        const icons = {
            [ItemType.TEXT]: 'text-x-generic-symbolic',
            [ItemType.HTML]: 'text-html-symbolic',
            [ItemType.IMAGE]: 'image-x-generic-symbolic',
            [ItemType.FILE]: 'folder-documents-symbolic',
            [ItemType.URL]: 'web-browser-symbolic',
            [ItemType.COLOR]: 'color-select-symbolic'
        };
        return icons[type] || 'text-x-generic-symbolic';
    }
    
    _updateSelection() {
        const children = this._itemsBox.get_children();
        children.forEach((child, index) => {
            if (child._index !== undefined) {
                if (index === this._selectedIndex) {
                    child.add_style_class_name('selected');
                } else {
                    child.remove_style_class_name('selected');
                }
            }
        });
    }
    
    _pasteSelected() {
        debugLog(`=== _pasteSelected() CALLED ===`);
        debugLog(`Items length: ${this._items.length}, selectedIndex: ${this._selectedIndex}`);
        
        if (this._items.length === 0 || this._selectedIndex >= this._items.length) {
            debugLog(`✗ _pasteSelected: No items or invalid index (${this._selectedIndex}/${this._items.length})`);
            return;
        }
        
        const item = this._items[this._selectedIndex];
        debugLog(`✓ _pasteSelected: Pasting item ${item.id} (type: ${item.type})`);
        debugLog(`  Item preview: ${item.preview ? item.preview.substring(0, 50) : 'no preview'}`);
        
        // Handle image items differently
        if (item.type === ItemType.IMAGE && item.content) {
            debugLog(`Copying image to clipboard: ${item.content}`);
            this._monitor.copyImageToClipboard(item.content);
        } else {
            const content = this._plainTextMode ? item.plainText : item.content;
            debugLog(`Copying text to clipboard (plainText=${this._plainTextMode}): ${content ? content.substring(0, 50) : 'null'}...`);
            this._monitor.copyToClipboard(content, this._plainTextMode);
        }
        
        // Update usage
        this._database.updateItem(item.id, {
            lastUsed: Date.now(),
            useCount: (item.useCount || 1) + 1
        });
        
        let closeOnPaste = false;
        try {
            closeOnPaste = this._settings.get_boolean('close-on-paste');
        } catch (e) {
            debugLog(`Error reading close-on-paste: ${e.message}`);
        }
        
        const isFromHover = this._pasteFromHover || false;
        debugLog(`close-on-paste=${closeOnPaste}, _isPinned=${this._isPinned}, isFromHover=${isFromHover}`);
        
        // Don't close if paste came from hover (paste-on-select)
        // Only close if user explicitly clicked AND close-on-paste is enabled AND popup is not pinned
        if (closeOnPaste && !this._isPinned && !isFromHover) {
            debugLog(`Closing popup after paste (close-on-paste=true, not pinned, explicit click)`);
            this._extension.hidePopup();
        } else {
            debugLog(`NOT closing popup (close-on-paste=${closeOnPaste}, pinned=${this._isPinned}, isFromHover=${isFromHover})`);
        }
        
        debugLog(`=== _pasteSelected() COMPLETED ===`);
    }
    
    _showContextMenu(item, row) {
        // Create a simple popup menu
        const menu = new PopupMenu.PopupMenu(row, 0.0, St.Side.TOP);
        
        // Edit title
        menu.addAction(_('Edit Title...'), () => {
            this._showEditDialog(item, 'title');
        });
        
        // Edit content (for text items)
        if (item.type === ItemType.TEXT || item.type === ItemType.URL) {
            menu.addAction(_('Edit Content...'), () => {
                this._showEditDialog(item, 'content');
            });
        }
        
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Toggle favorite
        const favLabel = item.isFavorite ? _('Remove from Favorites') : _('Add to Favorites');
        menu.addAction(favLabel, () => {
            this._database.toggleFavorite(item.id);
            this._loadItems();
        });
        
        // Add to list submenu
        const lists = this._database.getLists();
        if (lists.length > 0) {
            const listSubmenu = new PopupMenu.PopupSubMenuMenuItem(_('Add to List'));
            lists.forEach(list => {
                listSubmenu.menu.addAction(list.name, () => {
                    this._database.addItemToList(item.id, list.id);
                    this._loadItems();
                });
            });
            menu.addMenuItem(listSubmenu);
        }
        
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Delete
        menu.addAction(_('Delete'), () => {
            this._database.deleteItem(item.id);
            this._loadItems();
        });
        
        Main.uiGroup.add_child(menu.actor);
        menu.open();
        
        menu.connect('open-state-changed', (menu, open) => {
            if (!open) {
                menu.destroy();
            }
        });
    }
    
    _showEditDialog(item, field) {
        const dialog = new ModalDialog.ModalDialog({
            styleClass: 'clipmaster-dialog'
        });
        
        const title = field === 'title' ? _('Edit Title') : _('Edit Content');
        const label = new St.Label({
            text: title,
            style_class: 'clipmaster-dialog-title'
        });
        dialog.contentLayout.add_child(label);
        
        const entry = new St.Entry({
            style_class: 'clipmaster-dialog-entry',
            text: item[field] || '',
            can_focus: true
        });
        dialog.contentLayout.add_child(entry);
        
        dialog.addButton({
            label: _('Cancel'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape
        });
        
        dialog.addButton({
            label: _('Save'),
            action: () => {
                const newValue = entry.get_text();
                const updates = {};
                updates[field] = newValue;
                
                if (field === 'content') {
                    updates.plainText = newValue;
                    updates.preview = newValue.substring(0, 200);
                }
                
                this._database.updateItem(item.id, updates);
                this._loadItems();
                dialog.close();
            },
            default: true
        });
        
        dialog.open();
        entry.grab_key_focus();
    }
    
    _onKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        const searchHasFocus = this._searchEntry.clutter_text.has_key_focus();
        
        // Escape - ALWAYS close
        if (symbol === Clutter.KEY_Escape) {
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;
        }
        
        // Up/Down - ALWAYS navigate (even in search, moves selection)
        if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_KP_Up) {
            if (this._selectedIndex > 0) {
                this._selectedIndex--;
                this._updateSelection();
                this._scrollToSelected();
            }
            return Clutter.EVENT_STOP;
        }
        
        if (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_KP_Down) {
            if (this._selectedIndex < this._items.length - 1) {
                this._selectedIndex++;
                this._updateSelection();
                this._scrollToSelected();
            }
            return Clutter.EVENT_STOP;
        }
        
        // Enter - ALWAYS paste selected
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            this._pasteSelected();
            return Clutter.EVENT_STOP;
        }
        
        // Delete - delete item (works even when search has focus)
        if (symbol === Clutter.KEY_Delete) {
            if (this._items.length > 0 && this._selectedIndex < this._items.length) {
                this._database.deleteItem(this._items[this._selectedIndex].id);
                this._loadItems();
            }
            return Clutter.EVENT_STOP;
        }
        
        // These only work when search doesn't have focus (to allow typing)
        if (!searchHasFocus) {
            // P - toggle pin
            if (symbol === Clutter.KEY_p || symbol === Clutter.KEY_P) {
                this._isPinned = !this._isPinned;
                if (this._isPinned) {
                    this._pinButton.add_style_pseudo_class('checked');
                } else {
                    this._pinButton.remove_style_pseudo_class('checked');
                }
                debugLog(`Pin toggled via keyboard: ${this._isPinned}`);
                return Clutter.EVENT_STOP;
            }
            
            // T - toggle plain text mode
            if (symbol === Clutter.KEY_t || symbol === Clutter.KEY_T) {
                this._plainTextMode = !this._plainTextMode;
                if (this._plainTextMode) {
                    this._plainTextButton.add_style_pseudo_class('checked');
                } else {
                    this._plainTextButton.remove_style_pseudo_class('checked');
                }
                debugLog(`Plain text mode: ${this._plainTextMode}`);
                return Clutter.EVENT_STOP;
            }
            
            // F - toggle favorite
            if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F) {
                if (this._items.length > 0 && this._selectedIndex < this._items.length) {
                    this._database.toggleFavorite(this._items[this._selectedIndex].id);
                    this._loadItems();
                }
                return Clutter.EVENT_STOP;
            }
            
            // 1-9 - quick paste
            if (symbol >= Clutter.KEY_1 && symbol <= Clutter.KEY_9) {
                const index = symbol - Clutter.KEY_1;
                if (index < this._items.length) {
                    this._selectedIndex = index;
                    this._pasteSelected();
                }
                return Clutter.EVENT_STOP;
            }
        }
        
        return Clutter.EVENT_PROPAGATE;
    }
    
    _scrollToSelected() {
        // Scroll to make selected item visible
        const children = this._itemsBox.get_children();
        if (this._selectedIndex >= 0 && this._selectedIndex < children.length) {
            const child = children[this._selectedIndex];
            if (child) {
                const adj = this._scrollView.vscroll.adjustment;
                const [, childY] = child.get_transformed_position();
                const [, scrollY] = this._scrollView.get_transformed_position();
                const relativeY = childY - scrollY;
                const scrollHeight = this._scrollView.height;
                const childHeight = child.height;
                
                if (relativeY < 0) {
                    adj.value += relativeY;
                } else if (relativeY + childHeight > scrollHeight) {
                    adj.value += (relativeY + childHeight - scrollHeight);
                }
            }
        }
    }
});


// ============================================================================
// Panel Indicator (Fixed: proper click handling)
// ============================================================================
const ClipMasterIndicator = GObject.registerClass(
class ClipMasterIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'ClipMaster');
        
        this._extension = extension;
        this._settings = extension._settings;
        
        // Panel icon
        this._icon = new St.Icon({
            icon_name: this._settings.get_string('indicator-icon'),
            style_class: 'system-status-icon'
        });
        this.add_child(this._icon);
        
        this._buildMenu();
    }
    
    // Override vfunc_event to prevent default menu behavior on left click
    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            const button = event.get_button();
            
            if (button === 1) {
                // Left click - toggle popup (NOT menu)
                this._extension.togglePopup();
                return Clutter.EVENT_STOP;
            } else if (button === 3) {
                // Right click - show menu
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
        }
        
        // For other events, call parent
        return super.vfunc_event(event);
    }
    
    _buildMenu() {
        // Recent items section
        this._recentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._recentSection);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Actions
        this.menu.addAction(_('Show Clipboard Manager'), () => {
            this.menu.close();
            this._extension.showPopup();
        });
        
        this.menu.addAction(_('Clear History'), () => {
            this._extension._database.clearHistory(true);
            this._extension._refreshIndicator();
        });
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        this.menu.addAction(_('Preferences'), () => {
            this.menu.close();
            this._extension._openPreferencesWindow();
        });
    }
    
    refresh() {
        // Update recent items in menu
        this._recentSection.removeAll();
        
        const items = this._extension._database.getItems({ limit: 5 });
        
        if (items.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem(_('No clipboard items'), {
                reactive: false
            });
            this._recentSection.addMenuItem(emptyItem);
            return;
        }
        
        items.forEach(item => {
            let preview = item.preview || item.content || '';
            if (item.type === ItemType.IMAGE) {
                preview = `🖼️ ${item.preview || 'Image'}`;
            }
            if (preview.length > 50) {
                preview = preview.substring(0, 50) + '...';
            }
            preview = preview.replace(/\n/g, ' ');
            
            const menuItem = new PopupMenu.PopupMenuItem(preview);
            menuItem.connect('activate', () => {
                if (item.type === ItemType.IMAGE && item.content) {
                    this._extension._monitor.copyImageToClipboard(item.content);
                } else {
                    this._extension._monitor.copyToClipboard(item.content);
                }
            });
            this._recentSection.addMenuItem(menuItem);
        });
    }
});


// ============================================================================
// Main Extension Class
// ============================================================================
export default class ClipMasterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._extensionPath = this.path;  // Store extension path for icon loading
        
        // Setup debug mode from settings
        _debugSettings = this._settings;
        setDebugMode(this._settings.get_boolean('debug-mode'));
        this._debugModeChangedId = this._settings.connect('changed::debug-mode', () => {
            setDebugMode(this._settings.get_boolean('debug-mode'));
        });
        
        // Initialize database with settings for encryption support
        const storagePath = this._settings.get_string('storage-path');
        this._database = new ClipboardDatabase(storagePath || null, this._settings);
        
        // Initialize clipboard monitor
        this._monitor = new ClipboardMonitor(
            this._settings,
            this._database,
            this._onNewItem.bind(this)
        );
        this._monitor.start();
        
        // Create popup - start with fixed safe values to prevent NaN errors
        this._popup = new ClipboardPopup(this);
        this._popup.set_size(450, 550);
        this._popup.set_position(100, 100);
        this._popup.visible = false;
        this._popup.opacity = 0;  // Fully transparent
        this._popup.reactive = false;  // Don't capture events when hidden
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
        
        // Disconnect debug mode listener
        if (this._debugModeChangedId) {
            this._settings.disconnect(this._debugModeChangedId);
            this._debugModeChangedId = null;
        }
        
        _debugSettings = null;
        _debugMode = false;
        
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
        
        // Prevent showing if already showing
        if (this._popup._isShowing) {
            debugLog('showPopup: Already showing, ignoring');
            return;
        }
        
        debugLog('showPopup: Starting to show popup');
        
        try {
            // Remove any existing click outside handler first
            if (this._popup._clickOutsideId) {
                debugLog('showPopup: Removing existing click outside handler');
                try {
                    global.stage.disconnect(this._popup._clickOutsideId);
                } catch (e) {
                    debugLog(`Error removing handler: ${e.message}`);
                }
                this._popup._clickOutsideId = null;
            }
            
            // Mark as intentionally showing
            this._popup._isShowing = true;
            
            // Get popup size from settings with safe defaults
            let popupWidth = 450;
            let popupHeight = 550;
            
            try {
                popupWidth = this._settings.get_int('popup-width');
                popupHeight = this._settings.get_int('popup-height');
            } catch (e) {
                // Use defaults
            }
            
            // Ensure valid numbers
            if (!popupWidth || isNaN(popupWidth) || popupWidth < 300) popupWidth = 450;
            if (!popupHeight || isNaN(popupHeight) || popupHeight < 300) popupHeight = 550;
            
            // Get monitor safely
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor || !monitor.width || !monitor.height) {
                log('ClipMaster: No valid monitor found');
                this._popup._isShowing = false;
                return;
            }
            
            // Default to center
            let posX = Math.round(monitor.x + (monitor.width - popupWidth) / 2);
            let posY = Math.round(monitor.y + (monitor.height - popupHeight) / 2);
            
            // Position popup based on settings
            try {
                if (this._settings.get_boolean('popup-at-cursor')) {
                    const [mouseX, mouseY] = global.get_pointer();
                    
                    // Only use cursor position if valid
                    if (mouseX !== undefined && mouseY !== undefined && 
                        !isNaN(mouseX) && !isNaN(mouseY) &&
                        mouseX >= 0 && mouseY >= 0) {
                        posX = Math.round(mouseX - popupWidth / 2);
                        posY = Math.round(mouseY - 50);
                        
                        // Keep within screen bounds
                        posX = Math.max(monitor.x + 10, Math.min(posX, monitor.x + monitor.width - popupWidth - 10));
                        posY = Math.max(monitor.y + 50, Math.min(posY, monitor.y + monitor.height - popupHeight - 10));
                    }
                }
            } catch (e) {
                // Use center position
            }
            
            // Final safety check
            if (isNaN(posX) || isNaN(posY)) {
                posX = 100;
                posY = 100;
            }
            
            // Set size and position with rounded integers
            this._popup.set_size(Math.round(popupWidth), Math.round(popupHeight));
            this._popup.set_position(Math.round(posX), Math.round(posY));
            
            // Now show
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
            
            // If pinned, don't hide
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
        // Get current clipboard and paste as plain text
        const items = this._database.getItems({ limit: 1 });
        if (items.length > 0) {
            this._monitor.copyToClipboard(items[0].plainText, true);
        }
    }
    
    _openPreferencesWindow() {
        // Use Gio to launch the extension preferences
        try {
            const extensionManager = Main.extensionManager;
            const uuid = this.metadata.uuid;
            
            // Try using gnome-extensions command
            const proc = Gio.Subprocess.new(
                ['gnome-extensions', 'prefs', uuid],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_async(null, null);
        } catch (e) {
            log(`ClipMaster: Error opening preferences: ${e.message}`);
            // Fallback: try using the Extension object's method
            try {
                // Import and use ExtensionUtils if available
                const ExtensionUtils = imports.misc.extensionUtils;
                ExtensionUtils.openPrefs();
            } catch (e2) {
                log(`ClipMaster: Fallback preferences open failed: ${e2.message}`);
            }
        }
    }
}

