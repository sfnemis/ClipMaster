/*
 * ClipMaster - Database Manager
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TimeoutManager, FileUtils, HashUtils, queryInfo } from '../Util/Utils.js';
import { ItemType, debugLog, reportError, reportWarning } from '../Util/Constants.js';
import { HistoryObfuscator } from '../Util/Obfuscation.js';
import { ImageStorage } from '../Util/ImageStorage.js';

const SAVE_DEBOUNCE_MS = 500;
const SIZE_WARNING_COOLDOWN_MS = 60000;

export class ClipboardDatabase {
    constructor(storagePath, settings, onNotification = null) {
        this._storagePath = storagePath || GLib.build_filenamev([
            GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json',
        ]);
        this._settings = settings;
        this._onNotification = onNotification;

        this._items = [];
        this._lists = [];
        this._nextId = 1;
        this._isDirty = false;

        this._isLoaded = false;
        this._pendingItems = [];

        // Set when the stored file exists but cannot be read back. While it is
        // set the extension never writes, because overwriting an unreadable
        // database is how a whole history gets lost.
        this._loadFailed = false;
        this._backupWritten = false;

        this._lastWarningTime = 0;
        this._isCleaning = false;

        this._timeoutManager = new TimeoutManager();
        this._obfuscator = null;
        this._imageStorage = new ImageStorage();
    }

    get storagePath() {
        return this._storagePath;
    }

    get loadFailed() {
        return this._loadFailed;
    }

    async init() {
        FileUtils.ensureDirectory(this._storagePath);
        await this._setupObfuscation();
        await this._load();
    }

    get _keyFilePath() {
        return this._storagePath.replace(/\.json$/, '.key');
    }

    /**
     * Builds the obfuscator whenever a key is available, even when the setting
     * is switched off. The setting decides whether new writes are obfuscated;
     * reading an existing obfuscated file must keep working either way, or
     * turning the switch off would make the whole history unreadable.
     */
    async _setupObfuscation() {
        const wanted = this._settings.get_boolean('encrypt-database');
        let key = null;

        try {
            const keyFromFile = await FileUtils.loadTextFile(this._keyFilePath);
            if (keyFromFile && keyFromFile.trim().length >= 16)
                key = keyFromFile.trim();
        } catch (e) {
            debugLog(`Key file unreadable: ${e.message}`);
        }

        if (!key) {
            const stored = this._settings.get_string('encryption-key');
            if (stored && stored.length >= 16)
                key = stored;
        }

        if (!key && !wanted)
            return;

        this._obfuscator = new HistoryObfuscator(key);

        if (key)
            return;

        // A freshly generated key is written to both places: the file survives
        // a GSettings reset, GSettings survives a storage path change.
        try {
            await FileUtils.saveTextFileAtomic(this._keyFilePath, this._obfuscator.key);
        } catch (e) {
            reportError(`could not save key file: ${e.message}`);
        }
        this._settings.set_string('encryption-key', this._obfuscator.key);
    }

    async _load() {
        let raw = null;

        try {
            raw = await FileUtils.loadTextFile(this._storagePath);
        } catch (e) {
            this._failLoad(_('The clipboard history file could not be read.'), e.message);
            return;
        }

        if (raw === null || raw.trim() === '') {
            this._finishLoad([], [], 1);
            return;
        }

        let text = raw;

        if (HistoryObfuscator.isObfuscated(raw)) {
            if (!this._obfuscator) {
                this._failLoad(
                    _('The clipboard history is obfuscated but its key is missing.'),
                    'no key available');
                return;
            }

            try {
                text = this._obfuscator.deobfuscate(raw);
            } catch (e) {
                this._failLoad(
                    _('The clipboard history could not be decoded with the stored key.'),
                    e.message);
                return;
            }
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            this._failLoad(_('The clipboard history file is damaged.'), e.message);
            return;
        }

        if (!data || !Array.isArray(data.items)) {
            this._failLoad(_('The clipboard history file has an unexpected format.'), 'items is not an array');
            return;
        }

        this._finishLoad(data.items, Array.isArray(data.lists) ? data.lists : [], data.nextId || 1);
    }

    _finishLoad(items, lists, nextId) {
        this._items = items;
        this._lists = lists;
        this._nextId = Math.max(nextId, 1, ...items.map(item => (item.id || 0) + 1));
        this._isLoaded = true;

        this._mergePendingItems();

        this._pruneOrphanedImages();

        if (this._isDirty)
            this._save();
    }

    /**
     * Deletes stored image files that no item refers to any more. Until version
     * 2 clearing the history dropped the records but left every image file on
     * disk, so an upgrade has a backlog to clear.
     */
    _pruneOrphanedImages() {
        const used = new Set(this._items
            .filter(item => item.type === ItemType.IMAGE && item.metadata?.storedAs === 'file')
            .map(item => item.content));

        const removed = this._imageStorage.cleanupOrphans(used);
        if (removed > 0)
            debugLog(`Removed ${removed} image file(s) that no item refers to`);
    }

    /**
     * Adds anything that was copied while the file was still being read.
     *
     * Identifiers are handed out here rather than when the item was queued:
     * the next free identifier is only known once the stored items have been
     * read, and assigning one before that produced two items with the same id,
     * which made deleting one of them remove the wrong row. Duplicates are also
     * resolved here, because the item they duplicate was not loaded yet when
     * they were queued.
     */
    _mergePendingItems() {
        const pending = this._pendingItems;
        this._pendingItems = [];

        if (pending.length === 0)
            return;

        const skipDuplicates = this._settings ? this._settings.get_boolean('skip-duplicates') : true;

        for (const item of pending) {
            const existing = this._items.find(i => i.contentHash === item.contentHash);

            if (existing && skipDuplicates) {
                existing.lastUsed = item.lastUsed;
                existing.useCount = (existing.useCount || 1) + 1;
                this._moveToTop(existing.id);
                continue;
            }

            item.id = this._nextId++;
            this._items.unshift(item);
        }

        this._isDirty = true;
    }

    /**
     * Keeps the unreadable file exactly where it is, copies it aside with a
     * timestamp so the user still has it, and blocks every write for the rest
     * of the session. The notification is the only way the user would learn
     * that their history is not gone but also not being added to.
     */
    _failLoad(userMessage, detail) {
        reportError(`refusing to use the clipboard history: ${detail}`);

        this._loadFailed = true;
        this._isLoaded = true;
        this._items = [];
        this._pendingItems = [];
        this._lists = [];

        let copyPath = null;
        try {
            const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
            copyPath = `${this._storagePath}.unreadable-${stamp}`;
            Gio.File.new_for_path(this._storagePath).copy(
                Gio.File.new_for_path(copyPath), Gio.FileCopyFlags.NONE, null, null);
        } catch (e) {
            copyPath = null;
            reportError(`could not copy the unreadable history aside: ${e.message}`);
        }

        if (this._onNotification) {
            const where = copyPath ? `${userMessage} ${_('A copy was kept at')} ${copyPath}.` : userMessage;
            this._onNotification(
                _('ClipMaster could not open its history'),
                `${where} ${_('Nothing new will be saved until this is resolved, so no data is overwritten.')}`);
        }
    }

    /**
     * Throws away everything held in memory and reads the file again. Called
     * when the preferences window reports that it changed the file.
     */
    async reload() {
        this._timeoutManager.remove('database-save');

        this._loadFailed = false;
        this._backupWritten = false;
        this._isLoaded = false;
        this._isDirty = false;
        this._items = [];
        this._lists = [];
        this._pendingItems = [];

        await this._setupObfuscation();
        await this._load();
    }

    _save() {
        if (this._loadFailed || !this._timeoutManager)
            return;

        this._isDirty = true;

        this._timeoutManager.add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
            this._doSave().catch(e => reportError(`save failed: ${e.message}`));
            return GLib.SOURCE_REMOVE;
        }, 'database-save');
    }

    _serialize() {
        const json = JSON.stringify({
            items: this._items,
            lists: this._lists,
            nextId: this._nextId,
        });

        if (this._obfuscator && this._settings?.get_boolean('encrypt-database'))
            return this._obfuscator.obfuscate(json);

        return json;
    }

    async _doSave() {
        if (!this._isDirty || this._loadFailed || !this._isLoaded)
            return;

        await this._writeBackupOnce();

        const payload = this._serialize();
        await FileUtils.saveTextFileAtomic(this._storagePath, payload);
        this._isDirty = false;

        await this._checkDatabaseSize();
    }

    /**
     * Keeps one generation of the file that was loaded successfully, written
     * just before the first save of the session. It is the only copy a user has
     * if something goes wrong between two runs.
     */
    async _writeBackupOnce() {
        if (this._backupWritten)
            return;

        this._backupWritten = true;

        try {
            const source = Gio.File.new_for_path(this._storagePath);
            if (source.query_exists(null)) {
                source.copy(
                    Gio.File.new_for_path(`${this._storagePath}.bak`),
                    Gio.FileCopyFlags.OVERWRITE, null, null);
            }
        } catch (e) {
            reportWarning(`could not write the history backup: ${e.message}`);
        }
    }

    /**
     * Writes synchronously. Called from `disable()`, where an async write is
     * abandoned when GNOME Shell tears the extension down, which loses whatever
     * was copied in the last moments of the session.
     */
    flushSync() {
        if (!this._isDirty || this._loadFailed || !this._isLoaded)
            return;

        try {
            FileUtils.saveTextFileAtomicSync(this._storagePath, this._serialize());
            this._isDirty = false;
        } catch (e) {
            reportError(`final save failed: ${e.message}`);
        }
    }

    async getFileSize() {
        try {
            const info = await queryInfo(Gio.File.new_for_path(this._storagePath), 'standard::size');
            return info.get_size();
        } catch {
            // The file may not exist yet, which counts as no size.
            return 0;
        }
    }

    async _checkDatabaseSize() {
        if (!this._settings || this._isCleaning)
            return;

        const maxSizeMB = this._settings.get_int('max-db-size-mb');
        if (maxSizeMB <= 0)
            return;

        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        const currentSizeBytes = await this.getFileSize();
        if (currentSizeBytes <= 0)
            return;

        if (currentSizeBytes >= maxSizeBytes) {
            this._isCleaning = true;
            try {
                const cleaned = this._enforceDatabaseSizeLimit(maxSizeBytes);
                if (cleaned > 0 && this._onNotification) {
                    this._onNotification(
                        _('Database size limit reached'),
                        _('ClipMaster removed %d old items to stay under %s MB.')
                            .replace('%d', String(cleaned)).replace('%s', String(maxSizeMB)));
                }
            } finally {
                this._isCleaning = false;
            }
            return;
        }

        const usagePercent = (currentSizeBytes / maxSizeBytes) * 100;
        if (usagePercent < 90)
            return;

        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastWarningTime <= SIZE_WARNING_COOLDOWN_MS)
            return;

        this._lastWarningTime = now;
        if (this._onNotification) {
            this._onNotification(
                _('Database size warning'),
                _('The clipboard history is %d%% of its %s MB limit. The oldest items will be removed when it is full.')
                    .replace('%d', String(Math.round(usagePercent))).replace('%s', String(maxSizeMB)));
        }
    }

    /**
     * Drops the oldest non-favourite items until the estimated serialized size
     * is under the limit.
     *
     * The size is estimated from each item's own JSON length rather than by
     * re-serializing the whole database once per removed item. That earlier
     * approach ran on the compositor thread and froze the desktop for seconds
     * on a large history.
     */
    _enforceDatabaseSizeLimit(maxSizeBytes) {
        const target = maxSizeBytes * 0.9;
        const sizeOf = item => JSON.stringify(item).length + 1;

        const favorites = this._items.filter(i => i.isFavorite);
        const nonFavorites = this._items.filter(i => !i.isFavorite);
        nonFavorites.sort((a, b) => (a.created || 0) - (b.created || 0));

        const overhead = JSON.stringify({ items: [], lists: this._lists, nextId: this._nextId }).length;
        let total = overhead + favorites.reduce((sum, i) => sum + sizeOf(i), 0)
            + nonFavorites.reduce((sum, i) => sum + sizeOf(i), 0);

        let removedCount = 0;
        while (total > target && nonFavorites.length > 0) {
            const item = nonFavorites.shift();
            total -= sizeOf(item);
            this._deleteItemFiles(item);
            removedCount++;
        }

        if (removedCount === 0)
            return 0;

        this._items = [...favorites, ...nonFavorites];
        this._items.sort((a, b) => (b.lastUsed || b.created || 0) - (a.lastUsed || a.created || 0));
        this._save();

        return removedCount;
    }

    _deleteItemFiles(item) {
        if (item.type !== ItemType.IMAGE || item.metadata?.storedAs !== 'file' || !item.content)
            return;

        try {
            this._imageStorage.deleteImage(item.content);
        } catch (e) {
            // The sweep on the next load clears whatever is left behind.
            debugLog(`could not delete image file ${item.content}: ${e.message}`);
        }
    }

    destroy() {
        this._timeoutManager.remove('database-save');
        this.flushSync();
        this._timeoutManager.removeAll();
        this._timeoutManager = null;
        this._settings = null;
        this._onNotification = null;
        this._obfuscator = null;
    }

    addItem(item) {
        const contentHash = HashUtils.hashContent(item.content);

        const existing = this._items.find(i => i.contentHash === contentHash)
            || this._pendingItems.find(i => i.contentHash === contentHash);

        const skipDuplicates = this._settings ? this._settings.get_boolean('skip-duplicates') : true;

        if (existing && skipDuplicates) {
            existing.lastUsed = Date.now();
            existing.useCount = (existing.useCount || 1) + 1;

            if (this._items.includes(existing))
                this._moveToTop(existing.id);

            this._save();
            return existing.id;
        }

        const newItem = {
            // Queued items get their identifier in `_mergePendingItems()`,
            // once the stored items say which ones are free.
            id: this._isLoaded ? this._nextId++ : null,
            type: item.type || ItemType.TEXT,
            content: item.content,
            thumbnail: item.thumbnail || null,
            plainText: item.plainText || item.content,
            preview: item.preview || (item.content || '').substring(0, 200),
            title: item.title || null,
            contentHash,
            isFavorite: false,
            isPinned: false,
            listId: null,
            sourceApp: item.sourceApp || null,
            selection: item.selection || null,
            created: Date.now(),
            lastUsed: Date.now(),
            useCount: 1,
            imageFormat: item.imageFormat || null,
            metadata: item.metadata || null,
        };

        if (this._isLoaded)
            this._items.unshift(newItem);
        else
            this._pendingItems.push(newItem);

        this._save();
        return newItem.id;
    }

    _moveToTop(itemId) {
        const index = this._items.findIndex(i => i.id === itemId);
        if (index > 0)
            this._items.unshift(this._items.splice(index, 1)[0]);
    }

    getItems(options = {}) {
        let items = [...this._items];

        if (options.type) {
            // The code filter also covers HTML, which is the same thing to a user.
            if (options.type === ItemType.CODE)
                items = items.filter(i => i.type === ItemType.CODE || i.type === ItemType.HTML);
            else
                items = items.filter(i => i.type === options.type);
        }

        if (options.listId === -1)
            items = items.filter(i => i.isFavorite);
        else if (options.listId !== null && options.listId !== undefined)
            items = items.filter(i => i.listId === options.listId);

        if (options.search) {
            const query = options.search.toLowerCase();
            items = items.filter(i =>
                i.content?.toLowerCase().includes(query)
                || i.plainText?.toLowerCase().includes(query)
                || i.title?.toLowerCase().includes(query));
        }

        // Pinned items stay at the top of whatever the current view is.
        items.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

        if (options.limit)
            items = items.slice(0, options.limit);

        return items;
    }

    getItem(itemId) {
        return this._items.find(i => i.id === itemId) || this._pendingItems.find(i => i.id === itemId) || null;
    }

    updateItem(itemId, updates) {
        const item = this.getItem(itemId);
        if (!item)
            return false;

        Object.assign(item, updates);
        this._save();
        return true;
    }

    deleteItem(itemId) {
        const index = this._items.findIndex(i => i.id === itemId);
        if (index >= 0) {
            this._deleteItemFiles(this._items[index]);
            this._items.splice(index, 1);
            this._save();
            return true;
        }

        const pendingIndex = this._pendingItems.findIndex(i => i.id === itemId);
        if (pendingIndex >= 0) {
            this._pendingItems.splice(pendingIndex, 1);
            return true;
        }

        return false;
    }

    /**
     * Keeps favourites, pinned items and at most `maxItems` other items.
     */
    enforceLimit(maxItems) {
        if (!maxItems || maxItems <= 0)
            return;

        const kept = this._items.filter(i => i.isFavorite || i.isPinned);
        const rest = this._items.filter(i => !i.isFavorite && !i.isPinned);

        if (rest.length <= maxItems)
            return;

        rest.sort((a, b) => (b.created || 0) - (a.created || 0));

        for (const item of rest.slice(maxItems))
            this._deleteItemFiles(item);

        this._items = [...kept, ...rest.slice(0, maxItems)];
        this._items.sort((a, b) => (b.lastUsed || b.created || 0) - (a.lastUsed || a.created || 0));
        this._save();
    }

    toggleFavorite(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (!item)
            return false;

        item.isFavorite = !item.isFavorite;
        this._save();
        return item.isFavorite;
    }

    togglePinned(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (!item)
            return false;

        item.isPinned = !item.isPinned;
        this._save();
        return item.isPinned;
    }

    clearHistory(keepFavorites = true) {
        const removed = keepFavorites ? this._items.filter(i => !i.isFavorite) : this._items;
        for (const item of removed)
            this._deleteItemFiles(item);

        this._items = keepFavorites ? this._items.filter(i => i.isFavorite) : [];
        this._pendingItems = [];
        this._save();
        return removed.length;
    }

    getLists() {
        return this._lists;
    }

    createList(name, color = null) {
        const list = {
            id: this._lists.length > 0 ? Math.max(...this._lists.map(l => l.id)) + 1 : 1,
            name,
            color,
            created: Date.now(),
        };
        this._lists.push(list);
        this._save();
        return list.id;
    }

    deleteList(listId) {
        for (const item of this._items) {
            if (item.listId === listId)
                item.listId = null;
        }

        this._lists = this._lists.filter(l => l.id !== listId);
        this._save();
    }

    addItemToList(itemId, listId) {
        const item = this._items.find(i => i.id === itemId);
        if (!item)
            return;

        item.listId = listId;
        this._save();
    }

    getStats() {
        const stats = {
            total: this._items.length,
            favorites: this._items.filter(i => i.isFavorite).length,
            byType: {},
        };

        for (const item of this._items)
            stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;

        return stats;
    }
}
