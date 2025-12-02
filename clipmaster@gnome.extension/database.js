/**
 * ClipMaster - Clipboard Database
 * JSON file storage with debounced save and encryption
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TimeoutManager, FileUtils, HashUtils } from './utils.js';
import { ItemType, debugLog } from './constants.js';
import { SimpleEncryption } from './encryption.js';

export class ClipboardDatabase {
    constructor(storagePath, settings, onNotification = null) {
        this._storagePath = storagePath || GLib.build_filenamev([
            GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json'
        ]);
        this._settings = settings;
        this._onNotification = onNotification;
        
        this._items = [];
        this._lists = [];
        this._nextId = 1;
        this._isDirty = false;
        
        this._lastWarningTime = 0;
        this._warningCooldownMs = 60000;
        this._isCleaning = false;
        
        this._timeoutManager = new TimeoutManager();
        this._saveDebounceMs = 500;
        
        this._encryption = null;
        this._setupEncryption();
        
        FileUtils.ensureDirectory(this._storagePath);
        this._load();
    }
    
    _setupEncryption() {
        if (this._settings && this._settings.get_boolean('encrypt-database')) {
            let key = this._settings.get_string('encryption-key');
            
            if (!key) {
                this._encryption = new SimpleEncryption();
                key = this._encryption.getKey();
                this._settings.set_string('encryption-key', key);
            } else {
                this._encryption = new SimpleEncryption(key);
            }
        }
    }
    
    _load() {
        try {
            const jsonStr = FileUtils.loadTextFile(this._storagePath);
            if (jsonStr) {
                let decodedStr = jsonStr;
                
                if (this._encryption && decodedStr.startsWith('ENC:')) {
                    decodedStr = this._encryption.decrypt(decodedStr.substring(4));
                }
                
                const data = JSON.parse(decodedStr);
                this._items = data.items || [];
                this._lists = data.lists || [];
                this._nextId = data.nextId || 1;
            }
        } catch (e) {
            log(`ClipMaster: Error loading database: ${e.message}`);
            this._items = [];
            this._lists = [];
        }
    }
    
    _save() {
        this._isDirty = true;
        
        this._timeoutManager.add(
            GLib.PRIORITY_DEFAULT,
            this._saveDebounceMs,
            () => {
                this._doSave();
                return GLib.SOURCE_REMOVE;
            },
            'database-save'
        );
    }
    
    _saveImmediate() {
        this._timeoutManager.remove('database-save');
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
            
            if (this._encryption) {
                jsonStr = 'ENC:' + this._encryption.encrypt(jsonStr);
            }
            
            if (FileUtils.saveTextFile(this._storagePath, jsonStr)) {
                this._isDirty = false;
                this._checkDatabaseSize();
            }
        } catch (e) {
            log(`ClipMaster: Error saving database: ${e.message}`);
        }
    }
    
    getFileSize() {
        try {
            const file = Gio.File.new_for_path(this._storagePath);
            if (!file.query_exists(null)) {
                return 0;
            }
            
            const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            return info.get_size();
        } catch (e) {
            log(`ClipMaster: Error getting file size: ${e.message}`);
            return 0;
        }
    }
    
    _checkDatabaseSize() {
        if (!this._settings || this._isCleaning) return;
        
        try {
            const maxSizeMB = this._settings.get_int('max-db-size-mb');
            if (maxSizeMB <= 0) return;
            
            const maxSizeBytes = maxSizeMB * 1024 * 1024;
            const currentSizeBytes = this.getFileSize();
            
            if (currentSizeBytes <= 0) return;
            
            const usagePercent = (currentSizeBytes / maxSizeBytes) * 100;
            
            if (currentSizeBytes >= maxSizeBytes) {
                this._isCleaning = true;
                try {
                    const cleaned = this._enforceDatabaseSizeLimit(maxSizeBytes);
                    if (cleaned > 0 && this._onNotification) {
                        this._onNotification(
                            _('Database Size Limit Reached'),
                            _(`Database reached ${maxSizeMB}MB. Removed ${cleaned} oldest item(s) to free space.`)
                        );
                    }
                } finally {
                    this._isCleaning = false;
                }
            } else if (usagePercent >= 90) {
                const now = Date.now();
                if (now - this._lastWarningTime > this._warningCooldownMs) {
                    this._lastWarningTime = now;
                    if (this._onNotification) {
                        const remainingMB = ((maxSizeBytes - currentSizeBytes) / (1024 * 1024)).toFixed(1);
                        this._onNotification(
                            _('Database Size Warning'),
                            _(`Database is ${usagePercent.toFixed(0)}% full (${remainingMB}MB remaining). Old items will be automatically removed when limit is reached.`)
                        );
                    }
                }
            }
        } catch (e) {
            log(`ClipMaster: Error checking database size: ${e.message}`);
            this._isCleaning = false;
        }
    }
    
    _enforceDatabaseSizeLimit(maxSizeBytes) {
        let removedCount = 0;
        
        const favorites = this._items.filter(i => i.isFavorite);
        let nonFavorites = this._items.filter(i => !i.isFavorite);
        
        nonFavorites.sort((a, b) => (a.created || 0) - (b.created || 0));
        
        while (nonFavorites.length > 0) {
            const testItems = [...favorites, ...nonFavorites];
            const testData = {
                items: testItems,
                lists: this._lists,
                nextId: this._nextId
            };
            
            let testJsonStr = JSON.stringify(testData, null, 2);
            if (this._encryption) {
                testJsonStr = 'ENC:' + this._encryption.encrypt(testJsonStr);
            }
            
            const testSize = new TextEncoder().encode(testJsonStr).length;
            
            if (testSize < maxSizeBytes * 0.95) {
                break;
            }
            
            nonFavorites.shift();
            removedCount++;
            
            if (removedCount > 1000) {
                log('ClipMaster: Safety limit reached while cleaning database');
                break;
            }
        }
        
        this._items = [...favorites, ...nonFavorites];
        
        if (removedCount > 0) {
            this._saveImmediate();
        }
        
        return removedCount;
    }
    
    destroy() {
        this._saveImmediate();
        this._timeoutManager.removeAll();
        this._timeoutManager = null;
    }
    
    addItem(item) {
        const contentHash = HashUtils.hashContent(item.content);
        const existing = this._items.find(i => i.contentHash === contentHash || i.hash === contentHash);
        
        let skipDuplicates = true;
        try {
            if (this._settings) {
                skipDuplicates = this._settings.get_boolean('skip-duplicates');
                debugLog(`skip-duplicates setting = ${skipDuplicates}`);
            }
        } catch (e) {
            debugLog(`Error reading skip-duplicates: ${e.message}`);
            skipDuplicates = true;
        }
        
        debugLog(`existing=${!!existing}, skipDuplicates=${skipDuplicates}`);
        
        if (existing && skipDuplicates) {
            debugLog(`Skipping duplicate, updating existing item`);
            existing.lastUsed = Date.now();
            existing.useCount = (existing.useCount || 1) + 1;
            this._moveToTop(existing.id);
            this._save();
            return existing.id;
        }
        
        debugLog(`Adding new item (existing=${!!existing}, skipDuplicates=${skipDuplicates})`);
        
        const uniqueHash = skipDuplicates ? contentHash : `${contentHash}_${Date.now()}`;
        
        const newItem = {
            id: this._nextId++,
            type: item.type || ItemType.TEXT,
            content: item.content,
            plainText: item.plainText || item.content,
            preview: item.preview || (item.content || '').substring(0, 200),
            title: item.title || null,
            hash: uniqueHash,
            contentHash: contentHash,
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
    
    _moveToTop(itemId) {
        const index = this._items.findIndex(i => i.id === itemId);
        if (index > 0) {
            const item = this._items.splice(index, 1)[0];
            this._items.unshift(item);
        }
    }
    
    getItems(options = {}) {
        let items = [...this._items];
        
        if (options.type) {
            items = items.filter(i => i.type === options.type);
        }
        
        if (options.listId !== undefined) {
            if (options.listId === -1) {
                items = items.filter(i => i.isFavorite);
            } else if (options.listId !== null) {
                items = items.filter(i => i.listId === options.listId);
            }
        }
        
        if (options.search) {
            const query = options.search.toLowerCase();
            items = items.filter(i => 
                (i.content && i.content.toLowerCase().includes(query)) ||
                (i.plainText && i.plainText.toLowerCase().includes(query)) ||
                (i.title && i.title.toLowerCase().includes(query))
            );
        }
        
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
        const favorites = this._items.filter(i => i.isFavorite);
        const nonFavorites = this._items.filter(i => !i.isFavorite);
        
        if (nonFavorites.length > maxItems) {
            this._items = [...favorites, ...nonFavorites.slice(0, maxItems)];
            this._save();
        }
    }
    
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
                data.items.forEach(item => {
                    const hash = HashUtils.hashContent(item.content);
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




