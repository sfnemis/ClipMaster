/*
 * ClipMaster - Clipboard Monitor
 * License: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Meta from 'gi://Meta';

import { SignalManager, TimeoutManager, SettingsCache, HashUtils, ValidationUtils } from '../Util/Utils.js';
import { ItemType, debugLog } from '../Util/Constants.js';

export class ClipboardMonitor {
    constructor(settings, database, onNewItem) {
        this._settings = settings;
        this._database = database;
        this._onNewItem = onNewItem;
        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._lastContent = null;
        this._lastPrimaryContent = null;
        this._lastImageHash = null;
        this._imageCheckProcess = null;
        this._isStopped = false;
        
        this._signalManager = new SignalManager();
        this._timeoutManager = new TimeoutManager();
        this._settingsCache = new SettingsCache(settings);
        
        this._primaryGracePeriodEnd = 0;
        this._primaryGracePeriodMs = 5000;
        
        const maxItemSize = this._settingsCache.getInt('max-item-size-mb', 1) * 1024 * 1024;
        const maxImageSize = this._settingsCache.getInt('max-image-size-mb', 5) * 1024 * 1024;
        
        this._cachedSettings = {
            trackImages: this._settingsCache.getBoolean('track-images', false),
            maxItemSize: maxItemSize,
            maxImageSize: maxImageSize,
            historySize: this._settingsCache.getInt('history-size', 100)
        };
        
        this._signalManager.connect(
            settings,
            'changed',
            (settings, key) => this._updateCachedSetting(key),
            'settings-changed'
        );
    }
    
    _updateCachedSetting(key) {
        try {
            switch (key) {
                case 'track-images':
                    this._cachedSettings.trackImages = this._settingsCache.getBoolean('track-images', false);
                    break;
                case 'max-item-size-mb':
                    this._cachedSettings.maxItemSize = this._settingsCache.getInt('max-item-size-mb', 1) * 1024 * 1024;
                    break;
                case 'max-image-size-mb':
                    this._cachedSettings.maxImageSize = this._settingsCache.getInt('max-image-size-mb', 5) * 1024 * 1024;
                    break;
                case 'history-size':
                    this._cachedSettings.historySize = this._settingsCache.getInt('history-size', 100);
                    break;
            }
        } catch (e) {
            log(`ClipMaster: Error updating setting ${key}: ${e.message}`);
        }
    }
    
    start() {
        this._signalManager.connect(
            this._selection,
            'owner-changed',
            this._onSelectionOwnerChanged.bind(this),
            'selection-owner-changed'
        );
        
        if (this._settingsCache.getBoolean('track-primary-selection', false)) {
            this._enablePrimaryTracking();
        }
        
        this._signalManager.connect(
            this._settings,
            'changed::track-primary-selection',
            () => {
                const enabled = this._settingsCache.getBoolean('track-primary-selection', false);
                if (enabled) {
                    this._enablePrimaryTracking();
                } else {
                    this._disablePrimaryTracking();
                }
            },
            'primary-selection-setting'
        );
        
        this._checkClipboard();
    }
    
    _enablePrimaryTracking() {
        this._primaryGracePeriodEnd = Date.now() + this._primaryGracePeriodMs;
        debugLog(`Primary selection tracking enabled. Grace period until: ${new Date(this._primaryGracePeriodEnd).toISOString()}`);
        
        this._signalManager.connect(
            this._selection,
            'owner-changed',
            this._onPrimarySelectionOwnerChanged.bind(this),
            'primary-selection-owner-changed'
        );
        
        this._checkPrimaryClipboard(true);
    }
    
    _disablePrimaryTracking() {
        this._signalManager.disconnect('primary-selection-owner-changed');
    }
    
    stop() {
        this._isStopped = true;
        
        this._signalManager.disconnectAll();
        this._timeoutManager.removeAll();
        
        if (this._settingsCache) {
            this._settingsCache.destroy();
            this._settingsCache = null;
        }
        
        this._cancelImageCheck();
    }
    
    _cancelImageCheck() {
        if (this._imageCheckProcess) {
            try {
                this._imageCheckProcess.force_exit();
            } catch (e) {
                // already finished
            }
            this._imageCheckProcess = null;
        }
    }
    
    _createHiddenSubprocess(argv, captureOutput = false) {
        const launcher = new Gio.SubprocessLauncher({
            flags: captureOutput 
                ? Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                : Gio.SubprocessFlags.NONE
        });
        
        // Prevent subprocess from appearing in dock as "unknown application"
        // and suppress wl-clipboard notifications
        launcher.unsetenv('GIO_LAUNCHED_DESKTOP_FILE');
        launcher.unsetenv('DESKTOP_AUTOSTART_ID');
        launcher.setenv('GIO_LAUNCHED_DESKTOP_FILE_PID', '1', true);
        
        // Suppress any portal/notification behavior
        launcher.setenv('GTK_USE_PORTAL', '0', true);
        launcher.setenv('NO_AT_BRIDGE', '1', true);
        
        return launcher.spawnv(argv);
    }
    
    _onSelectionOwnerChanged(selection, selectionType, selectionSource) {
        if (this._isStopped) return;
        
        debugLog(`Selection owner changed, type=${selectionType}`);
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
            debugLog(`Clipboard selection changed!`);
            if (this._timeoutManager) {
                this._timeoutManager.add(
                    GLib.PRIORITY_DEFAULT,
                    100,
                    () => {
                        if (!this._isStopped) {
                            this._checkClipboard();
                        }
                        return GLib.SOURCE_REMOVE;
                    },
                    'clipboard-check'
                );
            }
        }
    }
    
    _onPrimarySelectionOwnerChanged(selection, selectionType, selectionSource) {
        if (this._isStopped) return;
        
        debugLog(`Primary selection owner changed, type=${selectionType}`);
        if (selectionType === Meta.SelectionType.SELECTION_PRIMARY) {
            debugLog(`Primary selection changed!`);
            if (this._timeoutManager) {
                this._timeoutManager.add(
                    GLib.PRIORITY_DEFAULT,
                    100,
                    () => {
                        if (!this._isStopped) {
                            this._checkPrimaryClipboard();
                        }
                        return GLib.SOURCE_REMOVE;
                    },
                    'primary-clipboard-check'
                );
            }
        }
    }
    
    _checkClipboard() {
        if (this._isStopped) return;
        
        debugLog(`Checking clipboard...`);
        debugLog(`Checking for image first (before text check)...`);
        this._checkForImageWithCallback('CLIPBOARD', (imageFound) => {
            debugLog(`Image check callback: imageFound=${imageFound}, trackImages=${this._cachedSettings.trackImages}`);
            if (!imageFound) {
                debugLog(`No image found, proceeding with text check...`);
                this._checkClipboardText();
            } else {
                debugLog(`Image found and processed, skipping text check`);
            }
        });
    }
    
    _checkClipboardText() {
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
            // Safety check - monitor might be stopped during async operation
            if (this._isStopped) {
                debugLog(`Clipboard text callback: Monitor stopped, ignoring`);
                return;
            }
            
            debugLog(`Got text from clipboard: "${text ? text.substring(0, 50) : 'null'}"`);
            debugLog(`Last content was: "${this._lastContent ? this._lastContent.substring(0, 50) : 'null'}"`);
            
            let skipDuplicates = true;
            try {
                if (this._settings) {
                    skipDuplicates = this._settings.get_boolean('skip-duplicates');
                }
            } catch (e) {
                skipDuplicates = true;
            }
            
            if (text && text !== this._lastContent) {
                debugLog(`NEW content detected, processing...`);
                this._lastContent = text;
                this._processText(text, 'CLIPBOARD');
            } else if (text && text === this._lastContent && !skipDuplicates) {
                debugLog(`Same content but skip-duplicates=OFF, processing anyway...`);
                this._processText(text, 'CLIPBOARD');
            } else {
                debugLog(`Same content or null, skipping (skipDuplicates=${skipDuplicates})`);
            }
        });
    }
    
    _checkPrimaryClipboard(isInitialCheck = false) {
        debugLog(`Checking primary clipboard... (isInitialCheck=${isInitialCheck})`);
        this._clipboard.get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
            // Safety check - monitor might be stopped during async operation
            if (this._isStopped) {
                debugLog(`Primary clipboard callback: Monitor stopped, ignoring`);
                return;
            }
            
            debugLog(`Got text from primary: "${text ? text.substring(0, 50) : 'null'}"`);
            debugLog(`Last primary content was: "${this._lastPrimaryContent ? this._lastPrimaryContent.substring(0, 50) : 'null'}"`);
            
            if (text) {
                const trimmedText = text.trim();
                if (trimmedText.length < 3) {
                    debugLog(`Ignoring PRIMARY selection: too short (${trimmedText.length} chars): "${trimmedText}"`);
                    this._lastPrimaryContent = text;
                    return;
                }
            }
            
            const now = Date.now();
            const inGracePeriod = now < this._primaryGracePeriodEnd;
            
            if (inGracePeriod) {
                debugLog(`In grace period (${Math.round((this._primaryGracePeriodEnd - now) / 1000)}s remaining). Updating lastPrimaryContent but NOT saving to history.`);
                if (text) {
                    this._lastPrimaryContent = text;
                }
                return;
            }
            
            let skipDuplicates = true;
            try {
                if (this._settings) {
                    skipDuplicates = this._settings.get_boolean('skip-duplicates');
                }
            } catch (e) {
                skipDuplicates = true;
            }
            
            if (text && text !== this._lastPrimaryContent) {
                debugLog(`NEW primary content detected, processing...`);
                this._lastPrimaryContent = text;
                this._processText(text, 'PRIMARY');
            } else if (text && text === this._lastPrimaryContent && !skipDuplicates) {
                debugLog(`Same primary content but skip-duplicates=OFF, processing anyway...`);
                this._processText(text, 'PRIMARY');
            } else {
                debugLog(`Same primary content or null, skipping (skipDuplicates=${skipDuplicates})`);
            }
        });
    }
    
    _checkForImage(selectionType = 'CLIPBOARD') {
        this._checkForImageWithCallback(selectionType, null);
    }
    
    _checkForImageWithCallback(selectionType = 'CLIPBOARD', callback = null) {
        debugLog(`_checkForImageWithCallback called (selectionType=${selectionType})`);
        
        this._cancelImageCheck();
        
        const isWayland = GLib.getenv('XDG_SESSION_TYPE') === 'wayland';
        const clipTool = isWayland ? 'wl-paste' : 'xclip';
        debugLog(`Using clipboard tool: ${clipTool} (Wayland=${isWayland})`);
        
        let checkCmd, getCmd;
        
        if (isWayland) {
            checkCmd = ['wl-paste', '--list-types'];
            getCmd = ['wl-paste', '--type', 'image/png'];
        } else {
            const selection = selectionType === 'PRIMARY' ? 'primary' : 'clipboard';
            checkCmd = ['xclip', '-selection', selection, '-o', '-t', 'TARGETS'];
            getCmd = ['xclip', '-selection', selection, '-o', '-t', 'image/png'];
        }
        
        debugLog(`Running command to check image types: ${checkCmd.join(' ')}`);
        
        try {
            const checkProc = this._createHiddenSubprocess(checkCmd, true);
            
            checkProc.communicate_utf8_async(null, null, (proc, result) => {
                // Safety check - monitor might be stopped during async operation
                if (this._isStopped) {
                    debugLog(`Image check callback: Monitor stopped, ignoring`);
                    return;
                }
                
                try {
                    const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                    debugLog(`Image type check result - stdout length: ${stdout ? stdout.length : 0}, stderr: ${stderr || 'none'}`);
                    if (stdout) {
                        debugLog(`Available clipboard types: ${stdout.substring(0, 200)}`);
                    }
                    
                    if (stdout && (stdout.includes('image/png') || 
                                   stdout.includes('image/jpeg') || 
                                   stdout.includes('image/gif') ||
                                   stdout.includes('image/jpg'))) {
                        debugLog(`✓ Image MIME type detected in clipboard, fetching image data...`);
                        this._fetchImageFromClipboard(isWayland, selectionType, callback);
                    } else {
                        debugLog(`✗ No image MIME type found in clipboard types`);
                        if (callback) {
                            callback(false);
                        }
                    }
                } catch (e) {
                    debugLog(`Image check error: ${e.message}`);
                    if (callback) {
                        callback(false);
                    }
                }
            });
        } catch (e) {
            log(`ClipMaster: Image check error: ${e.message}`);
            debugLog(`Failed to create image check subprocess: ${e.message}`);
            if (callback) {
                callback(false);
            }
        }
    }
    
    _fetchImageFromClipboard(isWayland, selectionType = 'CLIPBOARD', callback = null) {
        const maxSize = this._cachedSettings.maxImageSize;
        
        const tempDir = GLib.get_tmp_dir();
        const timestamp = Date.now();
        const tempPath = GLib.build_filenamev([tempDir, `clipmaster_${timestamp}.png`]);
        
        let getCmd;
        if (isWayland) {
            getCmd = ['bash', '-c', `wl-paste --type image/png > "${tempPath}" 2>/dev/null`];
        } else {
            const selection = selectionType === 'PRIMARY' ? 'primary' : 'clipboard';
            getCmd = ['bash', '-c', `xclip -selection ${selection} -o -t image/png > "${tempPath}"`];
        }
        
        try {
            const proc = this._createHiddenSubprocess(getCmd, false);
            
            this._imageCheckProcess = proc;
            
            proc.wait_async(null, (proc, result) => {
                let imageSuccessfullyAdded = false;
                
                // Safety check - monitor might be stopped during async operation
                if (this._isStopped) {
                    debugLog(`Image fetch callback: Monitor stopped, ignoring`);
                    // Still cleanup temp file
                    try {
                        const file = Gio.File.new_for_path(tempPath);
                        if (file.query_exists(null)) file.delete(null);
                    } catch (e) {}
                    return;
                }
                
                try {
                    proc.wait_finish(result);
                    
                    if (proc.get_successful()) {
                        const file = Gio.File.new_for_path(tempPath);
                        
                        if (file.query_exists(null)) {
                            const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                            const size = info.get_size();
                            
                            if (size > 0 && size <= maxSize) {
                                const [success, contents] = file.load_contents(null);
                                if (success) {
                                    const hash = HashUtils.hashImageData(contents);
                                    
                                    if (hash !== this._lastImageHash) {
                                        this._lastImageHash = hash;
                                        
                                        if (this._cachedSettings && this._cachedSettings.trackImages) {
                                            const base64 = GLib.base64_encode(contents);
                                            
                                            const item = {
                                                type: ItemType.IMAGE,
                                                content: base64,
                                                plainText: `[Image ${timestamp}]`,
                                                preview: `Image (${Math.round(size / 1024)}KB)`,
                                                imageFormat: 'png',
                                                metadata: {
                                                    size: size,
                                                    hash: hash,
                                                    storedAs: 'base64'
                                                }
                                            };
                                            
                                            // Check again before database operation
                                            if (!this._isStopped && this._database) {
                                                const itemId = this._database.addItem(item);
                                                this._database.enforceLimit(this._cachedSettings.historySize);
                                                
                                                if (this._onNewItem && !this._isStopped) {
                                                    this._onNewItem(itemId);
                                                }
                                            }
                                            
                                            imageSuccessfullyAdded = true;
                                            debugLog(`Image successfully added to history as base64`);
                                        } else {
                                            debugLog(`Image found but trackImages=false, skipping save (but preventing text capture)`);
                                            imageSuccessfullyAdded = true;
                                        }
                                    } else {
                                        debugLog(`Image duplicate detected, skipping`);
                                        imageSuccessfullyAdded = true;
                                    }
                                }
                            } else {
                                debugLog(`Image too large (${size} bytes > ${maxSize} bytes), skipping`);
                            }
                            
                            try {
                                file.delete(null);
                            } catch (e) {
                                // ignore cleanup errors
                            }
                        }
                    } else {
                        debugLog(`Image fetch process failed`);
                    }
                } catch (e) {
                    log(`ClipMaster: Image fetch error: ${e.message}`);
                }
                
                this._imageCheckProcess = null;
                
                if (callback) {
                    callback(imageSuccessfullyAdded);
                }
            });
        } catch (e) {
            log(`ClipMaster: Image subprocess error: ${e.message}`);
            if (callback) {
                callback(false);
            }
        }
    }
    
    _processText(text, selectionType = 'CLIPBOARD') {
        if (this._isStopped || !this._database) return;
        
        debugLog(`_processText called with text: "${text ? text.substring(0, 100) : 'null'}"`);
        
        if (!ValidationUtils.isValidText(text, 1)) {
            debugLog(`_processText: Invalid text, returning`);
            return;
        }
        
        if (text.length > this._cachedSettings.maxItemSize) {
            text = text.substring(0, this._cachedSettings.maxItemSize);
        }
        
        const trimmed = text.trim();
        debugLog(`_processText: trimmed="${trimmed.substring(0, 100)}", trackImages=${this._cachedSettings.trackImages}`);
        
        if (this._cachedSettings.trackImages) {
            debugLog(`trackImages is true, checking if text is image file path...`);
            const isImagePath = this._isImageFilePath(trimmed);
            debugLog(`_isImageFilePath returned: ${isImagePath}`);
            
            if (isImagePath) {
                debugLog(`✓ Text appears to be an image file path: ${trimmed}`);
                this._processImageFile(trimmed, selectionType);
                return;
            } else {
                debugLog(`✗ Text is NOT an image file path, processing as text`);
            }
        } else {
            debugLog(`trackImages is false, skipping image file path check`);
        }
        
        let type = ItemType.TEXT;
        
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
        this._database.enforceLimit(this._cachedSettings.historySize);
        
        // Safety check before callback
        if (this._onNewItem && !this._isStopped) {
            this._onNewItem(itemId);
        }
    }
    
    _isImageFilePath(text) {
        debugLog(`_isImageFilePath called with: "${text}"`);
        
        if (!text || text.length < 3) {
            debugLog(`_isImageFilePath: Text too short or null`);
            return false;
        }
        
        const looksLikePath = text.startsWith('/') || 
                             text.startsWith('~/') || 
                             text.startsWith('./') ||
                             (text.includes('/') && !text.includes('://'));
        
        debugLog(`_isImageFilePath: looksLikePath=${looksLikePath}`);
        
        if (!looksLikePath) {
            debugLog(`_isImageFilePath: Does not look like a file path`);
            return false;
        }
        
        let filePath = text;
        if (text.startsWith('~/')) {
            filePath = GLib.build_filenamev([GLib.get_home_dir(), text.substring(2)]);
        }
        
        const file = Gio.File.new_for_path(filePath);
        if (!file.query_exists(null)) {
            debugLog(`File does not exist: ${filePath}`);
            return false;
        }
        
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff', '.tif'];
        const lowerText = text.toLowerCase();
        const hasImageExtension = imageExtensions.some(ext => lowerText.endsWith(ext));
        
        if (hasImageExtension) {
            debugLog(`File has image extension: ${filePath}`);
            return true;
        }
        
        try {
            const info = file.query_info('standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
            const mimeType = info.get_content_type();
            if (mimeType && mimeType.startsWith('image/')) {
                debugLog(`File has image MIME type: ${mimeType}`);
                return true;
            }
        } catch (e) {
            // ignore MIME check errors
        }
        
        return false;
    }
    
    _processImageFile(filePath, selectionType = 'CLIPBOARD') {
        if (this._isStopped || !this._database) return;
        
        let fullPath = filePath;
        if (filePath.startsWith('~/')) {
            fullPath = GLib.build_filenamev([GLib.get_home_dir(), filePath.substring(2)]);
        }
        
        const file = Gio.File.new_for_path(fullPath);
        if (!file.query_exists(null)) {
            debugLog(`Image file does not exist: ${fullPath}`);
            return;
        }
        
        try {
            const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const size = info.get_size();
            const maxSize = this._cachedSettings.maxImageSize;
            
            if (size > maxSize) {
                debugLog(`Image file too large: ${size} bytes > ${maxSize} bytes`);
                return;
            }
            
            if (size === 0) {
                debugLog(`Image file is empty: ${fullPath}`);
                return;
            }
            
            const [success, contents] = file.load_contents(null);
            if (!success) {
                debugLog(`Failed to read image file: ${fullPath}`);
                return;
            }
            
            const hash = HashUtils.hashImageData(contents);
            
            if (hash === this._lastImageHash) {
                debugLog(`Image duplicate detected (hash match), skipping`);
                return;
            }
            
            this._lastImageHash = hash;
            
            const timestamp = Date.now();
            const base64 = GLib.base64_encode(contents);
            
            const originalExt = fullPath.substring(fullPath.lastIndexOf('.'));
            const ext = originalExt.toLowerCase();
            let imageFormat = 'png';
            if (ext === '.jpg' || ext === '.jpeg') imageFormat = 'jpeg';
            else if (ext === '.gif') imageFormat = 'gif';
            else if (ext === '.webp') imageFormat = 'webp';
            else if (ext === '.bmp') imageFormat = 'bmp';
            else if (ext === '.svg') imageFormat = 'svg';
            
            const item = {
                type: ItemType.IMAGE,
                content: base64,
                plainText: `[Image from ${GLib.path_get_basename(fullPath)}]`,
                preview: `Image (${Math.round(size / 1024)}KB)`,
                imageFormat: imageFormat,
                metadata: {
                    size: size,
                    originalPath: fullPath,
                    hash: hash,
                    storedAs: 'base64'
                }
            };
            
            const itemId = this._database.addItem(item);
            this._database.enforceLimit(this._cachedSettings.historySize);
            
            debugLog(`Image file successfully processed and saved as base64 in JSON`);
            
            // Safety check before callback
            if (this._onNewItem && !this._isStopped) {
                this._onNewItem(itemId);
            }
        } catch (e) {
            log(`ClipMaster: Error processing image file: ${e.message}`);
            debugLog(`Error processing image file ${fullPath}: ${e.message}`);
        }
    }
    
    copyToClipboard(text, asPlainText = false) {
        if (asPlainText) {
            text = text.replace(/<[^>]*>/g, '');
        }
        this._lastContent = text;
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }
    
    copyImageToClipboard(imageContent) {
        const isWayland = GLib.getenv('XDG_SESSION_TYPE') === 'wayland';
        
        try {
            let imageData = null;
            let isBase64 = false;
            
            if (imageContent.includes('/') && !imageContent.startsWith('data:')) {
                const file = Gio.File.new_for_path(imageContent);
                if (file.query_exists(null)) {
                    const [, contents] = file.load_contents(null);
                    imageData = contents;
                } else {
                    log(`ClipMaster: Image file not found: ${imageContent}`);
                    return;
                }
            } else {
                isBase64 = true;
                try {
                    imageData = GLib.base64_decode(imageContent);
                } catch (e) {
                    log(`ClipMaster: Error decoding base64 image: ${e.message}`);
                    return;
                }
            }
            
            const tempDir = GLib.get_tmp_dir();
            const tempPath = GLib.build_filenamev([tempDir, `clipmaster_temp_${Date.now()}.png`]);
            const tempFile = Gio.File.new_for_path(tempPath);
            tempFile.replace_contents(
                imageData,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
            
            const clipCmd = isWayland 
                ? ['bash', '-c', `cat "${tempPath}" | wl-copy --type image/png --once 2>/dev/null`]
                : ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-i', tempPath];
            
            const procClipboard = this._createHiddenSubprocess(clipCmd, false);
            procClipboard.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                } catch (e) {
                    // ignore
                }
                try {
                    tempFile.delete(null);
                } catch (e) {
                    // ignore
                }
            });
        } catch (e) {
            log(`ClipMaster: Error copying image to clipboard: ${e.message}`);
        }
    }
}
