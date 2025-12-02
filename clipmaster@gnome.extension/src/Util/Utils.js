/**
 * ClipMaster - Utility Functions
 * Common utilities following GJS best practices and DRY principle
 * 
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/**
 * Signal Connection Manager
 * Manages signal connections with automatic cleanup
 */
export class SignalManager {
    constructor() {
        this._connections = new Map();
    }

    /**
     * Connect a signal and track it for cleanup
     * @param {GObject.Object} object - Object to connect to
     * @param {string} signal - Signal name
     * @param {Function} callback - Callback function
     * @param {string} id - Unique identifier for this connection
     * @returns {number} Connection ID
     */
    connect(object, signal, callback, id) {
        if (!object || !signal || !callback) {
            throw new Error('SignalManager.connect: Invalid parameters');
        }

        const handlerId = object.connect(signal, callback);
        
        if (id) {
            // Store for later cleanup
            if (!this._connections.has(id)) {
                this._connections.set(id, []);
            }
            this._connections.get(id).push({ object, handlerId });
        }

        return handlerId;
    }

    /**
     * Disconnect a specific connection by ID
     * @param {string} id - Connection identifier
     */
    disconnect(id) {
        const connections = this._connections.get(id);
        if (!connections) return;

        connections.forEach(({ object, handlerId }) => {
            try {
                if (object && object.handler_is_connected && object.handler_is_connected(handlerId)) {
                    object.disconnect(handlerId);
                }
            } catch (e) {
                // Connection may already be disconnected
            }
        });

        this._connections.delete(id);
    }

    /**
     * Disconnect all tracked connections
     */
    disconnectAll() {
        for (const id of this._connections.keys()) {
            this.disconnect(id);
        }
    }

    /**
     * Clear all connections without disconnecting (for cleanup)
     */
    clear() {
        this._connections.clear();
    }
}

/**
 * Timeout Manager
 * Manages timeouts with automatic cleanup
 */
export class TimeoutManager {
    constructor() {
        this._timeouts = new Map();
    }

    /**
     * Add a timeout and track it
     * @param {number} priority - GLib priority
     * @param {number} interval - Interval in milliseconds
     * @param {Function} callback - Callback function
     * @param {string} id - Unique identifier
     * @returns {number} Timeout ID
     */
    add(priority, interval, callback, id) {
        if (this._timeouts.has(id)) {
            this.remove(id);
        }

        const timeoutId = GLib.timeout_add(priority, interval, () => {
            const result = callback();
            if (id) {
                this._timeouts.delete(id);
            }
            return result;
        });

        if (id) {
            this._timeouts.set(id, timeoutId);
        }

        return timeoutId;
    }

    /**
     * Remove a timeout by ID
     * @param {string} id - Timeout identifier
     */
    remove(id) {
        const timeoutId = this._timeouts.get(id);
        if (timeoutId) {
            GLib.source_remove(timeoutId);
            this._timeouts.delete(id);
        }
    }

    /**
     * Remove all tracked timeouts
     */
    removeAll() {
        for (const timeoutId of this._timeouts.values()) {
            GLib.source_remove(timeoutId);
        }
        this._timeouts.clear();
    }
}

/**
 * File Operations Utility
 * Safe file operations with proper error handling
 */
export class FileUtils {
    /**
     * Ensure directory exists
     * @param {string} path - Directory path
     * @returns {boolean} Success
     */
    static ensureDirectory(path) {
        try {
            const dir = GLib.path_get_dirname(path);
            GLib.mkdir_with_parents(dir, 0o755);
            return true;
        } catch (e) {
            log(`FileUtils.ensureDirectory error: ${e.message}`);
            return false;
        }
    }

    /**
     * Load file contents as string
     * @param {string} path - File path
     * @returns {string|null} File contents or null on error
     */
    static loadTextFile(path) {
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null)) {
                return null;
            }

            const [success, contents] = file.load_contents(null);
            if (!success) {
                return null;
            }

            return new TextDecoder().decode(contents);
        } catch (e) {
            log(`FileUtils.loadTextFile error: ${e.message}`);
            return null;
        }
    }

    /**
     * Save text to file
     * @param {string} path - File path
     * @param {string} content - Content to save
     * @returns {boolean} Success
     */
    static saveTextFile(path, content) {
        try {
            FileUtils.ensureDirectory(path);
            const file = Gio.File.new_for_path(path);
            
            const encoder = new TextEncoder();
            file.replace_contents(
                encoder.encode(content),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
            
            return true;
        } catch (e) {
            log(`FileUtils.saveTextFile error: ${e.message}`);
            return false;
        }
    }

    /**
     * Check if file exists
     * @param {string} path - File path
     * @returns {boolean} Exists
     */
    static fileExists(path) {
        try {
            const file = Gio.File.new_for_path(path);
            return file.query_exists(null);
        } catch (e) {
            return false;
        }
    }
}

/**
 * Settings Cache Manager
 * Caches settings values to reduce GSettings lookups
 */
export class SettingsCache {
    constructor(settings) {
        this._settings = settings;
        this._cache = new Map();
        this._connectionId = null;
        
        if (settings) {
            this._connectionId = settings.connect('changed', this._onSettingChanged.bind(this));
        }
    }

    _onSettingChanged(settings, key) {
        // Clear cache for changed key
        this._cache.delete(key);
    }

    /**
     * Get boolean setting with cache
     * @param {string} key - Setting key
     * @param {boolean} defaultValue - Default value
     * @returns {boolean} Setting value
     */
    getBoolean(key, defaultValue = false) {
        if (this._cache.has(key)) {
            return this._cache.get(key);
        }

        try {
            const value = this._settings.get_boolean(key);
            this._cache.set(key, value);
            return value;
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Get integer setting with cache
     * @param {string} key - Setting key
     * @param {number} defaultValue - Default value
     * @returns {number} Setting value
     */
    getInt(key, defaultValue = 0) {
        if (this._cache.has(key)) {
            return this._cache.get(key);
        }

        try {
            const value = this._settings.get_int(key);
            this._cache.set(key, value);
            return value;
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Get string setting with cache
     * @param {string} key - Setting key
     * @param {string} defaultValue - Default value
     * @returns {string} Setting value
     */
    getString(key, defaultValue = '') {
        if (this._cache.has(key)) {
            return this._cache.get(key);
        }

        try {
            const value = this._settings.get_string(key);
            this._cache.set(key, value);
            return value;
        } catch (e) {
            return defaultValue;
        }
    }

    /**
     * Clear cache
     */
    clear() {
        this._cache.clear();
    }

    /**
     * Disconnect and cleanup
     */
    destroy() {
        if (this._connectionId && this._settings) {
            this._settings.disconnect(this._connectionId);
            this._connectionId = null;
        }
        this.clear();
        this._settings = null;
    }
}

/**
 * Content Hash Utility
 * Simple hash function for content deduplication
 */
export class HashUtils {
    /**
     * Hash a string content
     * @param {string} content - Content to hash
     * @returns {string} Hash string
     */
    static hashContent(content) {
        if (!content) return '';

        let hash = 0;
        const str = String(content);
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        return Math.abs(hash).toString(36);
    }

    /**
     * Hash image data
     * @param {Uint8Array|Array} data - Image data
     * @returns {string} Hash string
     */
    static hashImageData(data) {
        if (!data || data.length === 0) return '';

        let hash = 0;
        const view = new Uint8Array(data);
        const sampleSize = Math.min(view.length, 10000);
        const step = Math.max(1, Math.floor(view.length / sampleSize));

        for (let i = 0; i < view.length; i += step) {
            hash = ((hash << 5) - hash) + view[i];
            hash = hash & hash;
        }

        return Math.abs(hash).toString(36);
    }
}

/**
 * Validation Utilities
 */
export class ValidationUtils {
    /**
     * Validate and sanitize number
     * @param {number} value - Value to validate
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {number} defaultValue - Default if invalid
     * @returns {number} Validated value
     */
    static validateNumber(value, min, max, defaultValue) {
        if (typeof value !== 'number' || isNaN(value)) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Validate text length
     * @param {string} text - Text to validate
     * @param {number} minLength - Minimum length
     * @returns {boolean} Is valid
     */
    static isValidText(text, minLength = 1) {
        return text && typeof text === 'string' && text.trim().length >= minLength;
    }
}





























