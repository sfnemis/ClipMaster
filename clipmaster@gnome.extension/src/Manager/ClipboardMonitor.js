/*
 * ClipMaster - Clipboard Monitor
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { SignalManager, TimeoutManager, SettingsCache, HashUtils, ValidationUtils, loadContents, queryInfo } from '../Util/Utils.js';
import { ItemType, debugLog } from '../Util/Constants.js';
import { ImageStorage } from '../Util/ImageStorage.js';
import { isCodeSnippet } from '../Util/CodeDetect.js';

const SELECTION_SETTLE_MS = 100;
const PRIMARY_GRACE_MS = 5000;
const PRIMARY_MIN_LENGTH = 3;

// How many blocked fingerprints to keep. One copy produces a handful of
// selection events, so this covers many copies while staying small.
const BLOCKED_HISTORY = 32;

// How long after an excluded copy every capture is refused, which covers the
// burst of follow-up selection events that one copy produces.
const BLOCKED_WINDOW_MS = 2000;

export class ClipboardMonitor {
    constructor(settings, database, onNewItem) {
        this._settings = settings;
        this._database = database;
        this._onNewItem = onNewItem;

        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._windowTracker = Shell.WindowTracker.get_default();

        this._lastContent = null;
        this._lastPrimaryContent = null;
        this._lastImageHash = null;

        // Guards the callbacks of asynchronous reads that have no cancellable
        // of their own, such as `St.Clipboard.get_text()`.
        this._isStopped = false;
        this._cancellable = new Gio.Cancellable();

        this._signalManager = new SignalManager();
        this._timeoutManager = new TimeoutManager();
        this._settingsCache = new SettingsCache(settings);

        this._primaryGracePeriodEnd = 0;
        this._imageStorage = new ImageStorage();

        // What must not be stored, see `_blockSelection`.
        this._blockedHashes = new Set();
        this._blockedUntil = 0;
    }

    _setting(key) {
        return this._settingsCache ? this._settingsCache.getBoolean(key) : false;
    }

    _maxItemSize() {
        const mb = this._settingsCache ? this._settingsCache.getInt('max-item-size-mb') : 1;
        return mb * 1024 * 1024;
    }

    _maxImageSize() {
        const mb = this._settingsCache ? this._settingsCache.getInt('max-image-size-mb') : 5;
        return mb * 1024 * 1024;
    }

    start() {
        this._signalManager.connect(
            this._selection, 'owner-changed',
            this._onSelectionOwnerChanged.bind(this), 'selection-owner-changed');

        if (this._setting('track-primary-selection'))
            this._enablePrimaryTracking();

        this._signalManager.connect(
            this._settings, 'changed::track-primary-selection',
            () => {
                if (this._setting('track-primary-selection'))
                    this._enablePrimaryTracking();
                else
                    this._disablePrimaryTracking();
            },
            'primary-selection-setting');

        // Whatever is on the clipboard at this moment is worth keeping: after a
        // login or a shell restart it would otherwise be the one thing missing
        // from the history. It goes through the same gate as any other copy,
        // because the application it came from may well be an excluded one.
        if (this._setting('private-mode')) {
            this._blockSelection(St.ClipboardType.CLIPBOARD);
            return;
        }

        const source = this._currentSource();
        if (this._isExcludedSource(source)) {
            this._blockSelection(St.ClipboardType.CLIPBOARD);
            return;
        }

        this._checkClipboard(source);
    }

    _enablePrimaryTracking() {
        // Whatever is already selected when tracking is switched on is not a
        // deliberate copy, so it is remembered but not recorded.
        this._primaryGracePeriodEnd = GLib.get_monotonic_time() / 1000 + PRIMARY_GRACE_MS;

        this._signalManager.disconnect('primary-selection-owner-changed');
        this._signalManager.connect(
            this._selection, 'owner-changed',
            this._onPrimarySelectionOwnerChanged.bind(this), 'primary-selection-owner-changed');

        this._checkPrimaryClipboard();
    }

    _disablePrimaryTracking() {
        this._signalManager.disconnect('primary-selection-owner-changed');
        this._timeoutManager.remove('primary-clipboard-check');
    }

    stop() {
        this._isStopped = true;

        this._cancellable.cancel();
        this._signalManager.disconnectAll();
        this._timeoutManager.removeAll();

        this._blockedHashes.clear();
        this._blockedUntil = 0;

        this._settingsCache.destroy();
        this._settingsCache = null;
        this._settings = null;
        this._database = null;
        this._onNewItem = null;
    }

    /**
     * The application the user copied from, as far as the shell can tell: the
     * focused window at the moment the selection owner changed.
     */
    _currentSource() {
        const app = this._windowTracker.focus_app;
        const window = global.display.focus_window;

        return {
            appId: app?.get_id() || '',
            appName: app?.get_name() || '',
            wmClass: window?.get_wm_class() || '',
            wmClassInstance: window?.get_wm_class_instance() || '',
        };
    }

    /**
     * True when the history must not record this selection: either private
     * mode is on, or the source application is on the exclusion list.
     *
     * Matching is deliberately generous because the list is typed by hand. Any
     * of the application id, its display name or its window class counts, with
     * or without a `.desktop` suffix, ignoring case. Issue #25 was reported by
     * a user who had tried four spellings of the same application, all of which
     * were correct and none of which worked, because nothing read the list.
     */
    _isExcludedSource(source) {
        const patterns = this._settingsCache.getStrv('excluded-apps')
            .map(p => p.trim().toLowerCase().replace(/\.desktop$/, ''))
            .filter(p => p.length > 0);

        if (patterns.length === 0)
            return false;

        const candidates = [source.appId, source.appName, source.wmClass, source.wmClassInstance]
            .map(c => String(c).toLowerCase().replace(/\.desktop$/, ''))
            .filter(c => c.length > 0);

        return patterns.some(pattern =>
            candidates.some(candidate => candidate === pattern || candidate.includes(pattern)));
    }

    _onSelectionOwnerChanged(selection, selectionType) {
        if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;

        if (this._setting('private-mode')) {
            debugLog('Private mode is on, ignoring the clipboard');
            this._blockSelection(St.ClipboardType.CLIPBOARD);
            return;
        }

        const source = this._currentSource();
        if (this._isExcludedSource(source)) {
            debugLog(`Source application is excluded: ${source.appId || source.wmClass}`);
            this._blockSelection(St.ClipboardType.CLIPBOARD);
            return;
        }

        this._timeoutManager.add(GLib.PRIORITY_DEFAULT, SELECTION_SETTLE_MS, () => {
            this._checkClipboard(source);
            return GLib.SOURCE_REMOVE;
        }, 'clipboard-check');
    }

    /**
     * Refuses the current clipboard content, and anything that arrives in the
     * next couple of seconds.
     *
     * Deciding by the focused window alone is not enough. One copy produces
     * several selection events, and the ones after the first arrive once the
     * application that made the copy has lost the focus or exited, so they are
     * credited to whatever window is focused by then. On a machine with a
     * second window open, a password copied in an excluded password manager was
     * stored a moment later under the name of that other window.
     *
     * Two things close that door. The short window covers the burst, for text
     * and images alike. The fingerprint covers the same text turning up again
     * much later, which is what happens when the application that owned the
     * selection finally exits and the clipboard is handed over.
     *
     * Only a SHA-256 fingerprint of text is kept, in memory. Images are not
     * read at all here: fetching one would mean writing the excluded image to a
     * temporary file, which is the opposite of what this is for.
     */
    _blockSelection(selectionType) {
        this._blockedUntil = GLib.get_monotonic_time() / 1000 + BLOCKED_WINDOW_MS;

        this._clipboard.get_text(selectionType, (clipboard, text) => {
            if (this._isStopped || !text)
                return;

            this._blockedHashes.add(HashUtils.hashContent(text));

            while (this._blockedHashes.size > BLOCKED_HISTORY)
                this._blockedHashes.delete(this._blockedHashes.values().next().value);
        });
    }

    _isWithinBlockedWindow() {
        return GLib.get_monotonic_time() / 1000 < this._blockedUntil;
    }

    _isBlocked(hash) {
        return hash !== '' && this._blockedHashes.has(hash);
    }

    _onPrimarySelectionOwnerChanged(selection, selectionType) {
        if (selectionType !== Meta.SelectionType.SELECTION_PRIMARY)
            return;

        if (this._setting('private-mode')) {
            this._blockSelection(St.ClipboardType.PRIMARY);
            return;
        }

        const source = this._currentSource();
        if (this._isExcludedSource(source)) {
            this._blockSelection(St.ClipboardType.PRIMARY);
            return;
        }

        this._timeoutManager.add(GLib.PRIORITY_DEFAULT, SELECTION_SETTLE_MS, () => {
            this._checkPrimaryClipboard(source);
            return GLib.SOURCE_REMOVE;
        }, 'primary-clipboard-check');
    }

    _checkClipboard(source = null) {
        this._checkForImage('CLIPBOARD', source, imageFound => {
            if (!imageFound)
                this._checkClipboardText(source);
        });
    }

    _checkClipboardText(source) {
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
            if (this._isStopped || !text)
                return;

            const skipDuplicates = this._settings ? this._settings.get_boolean('skip-duplicates') : true;
            if (text === this._lastContent && skipDuplicates)
                return;

            this._lastContent = text;
            this._processText(text, 'CLIPBOARD', source)
                .catch(e => console.error(`ClipMaster: could not store clipboard text: ${e.message}`));
        });
    }

    _checkPrimaryClipboard(source = null) {
        this._clipboard.get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
            if (this._isStopped || !text)
                return;

            // A selection of one or two characters is almost always a stray
            // drag rather than something the user wants to keep.
            if (text.trim().length < PRIMARY_MIN_LENGTH) {
                this._lastPrimaryContent = text;
                return;
            }

            if (GLib.get_monotonic_time() / 1000 < this._primaryGracePeriodEnd) {
                this._lastPrimaryContent = text;
                return;
            }

            const skipDuplicates = this._settings ? this._settings.get_boolean('skip-duplicates') : true;
            if (text === this._lastPrimaryContent && skipDuplicates)
                return;

            this._lastPrimaryContent = text;
            this._processText(text, 'PRIMARY', source)
                .catch(e => console.error(`ClipMaster: could not store primary selection: ${e.message}`));
        });
    }

    _checkForImage(selectionType, source, callback) {
        const metaSelectionType = selectionType === 'PRIMARY'
            ? Meta.SelectionType.SELECTION_PRIMARY
            : Meta.SelectionType.SELECTION_CLIPBOARD;

        const mimetypes = this._selection.get_mimetypes(metaSelectionType);
        const hasImage = mimetypes?.some(mime => mime.startsWith('image/'));

        if (!hasImage) {
            callback(false);
            return;
        }

        this._fetchImageFromClipboard(metaSelectionType, source, callback);
    }

    _fetchImageFromClipboard(metaSelectionType, source, callback) {
        const maxSize = this._maxImageSize();
        const tempPath = GLib.build_filenamev([
            GLib.get_tmp_dir(), `clipmaster-${GLib.get_monotonic_time()}.png`,
        ]);
        const tempFile = Gio.File.new_for_path(tempPath);

        let outputStream;
        try {
            outputStream = tempFile.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        } catch (e) {
            debugLog(`Could not open a temporary file for the clipboard image: ${e.message}`);
            callback(false);
            return;
        }

        this._selection.transfer_async(
            metaSelectionType, 'image/png', maxSize, outputStream, this._cancellable,
            (selection, result) => {
                this._onImageTransferred(selection, result, tempFile, outputStream, source, callback)
                    .catch(e => {
                        debugLog(`Clipboard image transfer failed: ${e.message}`);
                        callback(false);
                    });
            });
    }

    async _onImageTransferred(selection, result, tempFile, outputStream, source, callback) {
        outputStream.close(null);

        const cleanUp = () => {
            try {
                tempFile.delete(null);
            } catch (e) {
                debugLog(`Could not delete the temporary image: ${e.message}`);
            }
        };

        if (this._isStopped) {
            cleanUp();
            return;
        }

        let handled = false;

        try {
            if (selection.transfer_finish(result)) {
                const info = await queryInfo(tempFile, 'standard::size', this._cancellable);
                const size = info.get_size();

                if (size > 0 && size <= this._maxImageSize())
                    handled = await this._storeImage(await loadContents(tempFile, this._cancellable), source, null);
            }
        } finally {
            cleanUp();
        }

        callback(handled);
    }

    /**
     * Returns true when the image was recognised, whether or not it was stored:
     * a duplicate and an image seen while image tracking is off are both
     * "handled", so the caller does not fall back to storing the text form.
     */
    async _storeImage(contents, source, originalPath) {
        const hash = HashUtils.hashImageData(contents);

        if (this._isWithinBlockedWindow()) {
            debugLog('This image came from an excluded source, not storing it');
            return true;
        }

        if (hash === this._lastImageHash)
            return true;

        this._lastImageHash = hash;

        if (!this._setting('track-images'))
            return true;

        const stored = await this._imageStorage.saveImage(contents, hash);
        if (!stored) {
            debugLog('ImageStorage could not save the clipboard image');
            return false;
        }

        if (this._isStopped || !this._database)
            return false;

        const name = originalPath ? GLib.path_get_basename(originalPath) : null;
        const item = {
            type: ItemType.IMAGE,
            content: stored.imagePath,
            thumbnail: stored.thumbnail,
            plainText: name ? `[Image ${name}]` : '[Image]',
            preview: `Image ${stored.width}x${stored.height} (${Math.round(stored.originalSize / 1024)}KB)`,
            imageFormat: stored.format,
            sourceApp: source?.appId || null,
            metadata: {
                size: stored.originalSize,
                savedSize: stored.savedSize,
                thumbnailSize: stored.thumbnailSize,
                width: stored.width,
                height: stored.height,
                originalPath,
                hash,
                storedAs: 'file',
            },
        };

        this._addItem(item);
        return true;
    }

    _addItem(item) {
        const itemId = this._database.addItem(item);
        this._database.enforceLimit(this._settingsCache.getInt('history-size'));

        if (this._onNewItem)
            this._onNewItem(itemId);
    }

    async _processText(text, selectionType, source) {
        if (this._isStopped || !this._database || !ValidationUtils.isValidText(text, 1))
            return;

        if (this._isWithinBlockedWindow() || this._isBlocked(HashUtils.hashContent(text))) {
            debugLog('This content came from an excluded source, not storing it');
            return;
        }

        if (this._setting('strip-whitespace'))
            text = text.trim();

        const maxItemSize = this._maxItemSize();
        const truncated = text.length > maxItemSize;
        if (truncated)
            text = text.substring(0, maxItemSize);

        const trimmed = text.trim();

        if (this._setting('track-images') && await this._isImageFilePath(trimmed)) {
            await this._processImageFile(trimmed, source);
            return;
        }

        const type = this._classify(trimmed);

        if (type === ItemType.FILE && !this._setting('track-files'))
            return;

        if (this._isStopped || !this._database)
            return;

        this._addItem({
            type,
            content: text,
            plainText: text,
            preview: text.substring(0, 200).replace(/\n/g, ' '),
            sourceApp: source?.appId || null,
            selection: selectionType,
            metadata: truncated ? { truncated: true } : null,
        });
    }

    _classify(trimmed) {
        if (/^https?:\/\//i.test(trimmed))
            return ItemType.URL;
        if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed))
            return ItemType.COLOR;
        if (trimmed.startsWith('file://'))
            return ItemType.FILE;
        if (trimmed.startsWith('<') && trimmed.includes('>'))
            return ItemType.HTML;
        if (isCodeSnippet(trimmed))
            return ItemType.CODE;
        return ItemType.TEXT;
    }

    async _isImageFilePath(text) {
        if (!text || text.length < 3 || text.includes('\n'))
            return false;

        const looksLikePath = text.startsWith('/') || text.startsWith('~/') || text.startsWith('./')
            || (text.includes('/') && !text.includes('://'));

        if (!looksLikePath)
            return false;

        const filePath = text.startsWith('~/')
            ? GLib.build_filenamev([GLib.get_home_dir(), text.substring(2)])
            : text;

        try {
            const info = await queryInfo(Gio.File.new_for_path(filePath), 'standard::content-type', this._cancellable);
            return info.get_content_type()?.startsWith('image/') ?? false;
        } catch {
            // An unreadable or missing path simply is not an image here.
            return false;
        }
    }

    async _processImageFile(filePath, source) {
        const fullPath = filePath.startsWith('~/')
            ? GLib.build_filenamev([GLib.get_home_dir(), filePath.substring(2)])
            : filePath;

        const file = Gio.File.new_for_path(fullPath);

        try {
            const info = await queryInfo(file, 'standard::size', this._cancellable);
            const size = info.get_size();

            if (size === 0 || size > this._maxImageSize())
                return;

            await this._storeImage(await loadContents(file, this._cancellable), source, fullPath);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`ClipMaster: could not store the image file: ${e.message}`);
        }
    }

    copyToClipboard(text, asPlainText = false) {
        const value = asPlainText ? text.replace(/<[^>]*>/g, '') : text;

        // Both buffers are remembered so that pasting from the history does not
        // come straight back in as a new entry.
        this._lastContent = value;
        this._lastPrimaryContent = value;

        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, value);
        this._clipboard.set_text(St.ClipboardType.PRIMARY, value);
    }

    async copyImageToClipboard(imageContent) {
        let imageData = null;

        try {
            if (imageContent.includes('/') && !imageContent.startsWith('data:'))
                imageData = await this._imageStorage.loadImage(imageContent);
            else
                imageData = GLib.base64_decode(imageContent);
        } catch (e) {
            console.error(`ClipMaster: could not read the stored image: ${e.message}`);
            return;
        }

        if (!imageData || imageData.length === 0) {
            console.warn(`ClipMaster: stored image is missing: ${imageContent}`);
            return;
        }

        this._lastImageHash = HashUtils.hashImageData(imageData);
        this._clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', GLib.Bytes.new(imageData));
    }
}
