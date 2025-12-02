/*
 * ClipMaster - Utility Classes
 * License: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export class SignalManager {
    constructor() {
        this._connections = new Map();
    }

    connect(object, signal, callback, id) {
        if (!object || !signal || !callback) {
            throw new Error('SignalManager.connect: Invalid parameters');
        }

        const handlerId = object.connect(signal, callback);
        
        if (id) {
            if (!this._connections.has(id)) {
                this._connections.set(id, []);
            }
            this._connections.get(id).push({ object, handlerId });
        }

        return handlerId;
    }

    disconnect(id) {
        const connections = this._connections.get(id);
        if (!connections) return;

        connections.forEach(({ object, handlerId }) => {
            try {
                if (object && object.handler_is_connected && object.handler_is_connected(handlerId)) {
                    object.disconnect(handlerId);
                }
            } catch (e) {
                // already disconnected
            }
        });

        this._connections.delete(id);
    }

    disconnectAll() {
        for (const id of this._connections.keys()) {
            this.disconnect(id);
        }
    }

    clear() {
        this._connections.clear();
    }
}

export class TimeoutManager {
    constructor() {
        this._timeouts = new Map();
    }

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

    remove(id) {
        const timeoutId = this._timeouts.get(id);
        if (timeoutId) {
            GLib.source_remove(timeoutId);
            this._timeouts.delete(id);
        }
    }

    removeAll() {
        for (const timeoutId of this._timeouts.values()) {
            GLib.source_remove(timeoutId);
        }
        this._timeouts.clear();
    }
}

export class FileUtils {
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

    static fileExists(path) {
        try {
            const file = Gio.File.new_for_path(path);
            return file.query_exists(null);
        } catch (e) {
            return false;
        }
    }
}

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
        this._cache.delete(key);
    }

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

    clear() {
        this._cache.clear();
    }

    destroy() {
        if (this._connectionId && this._settings) {
            this._settings.disconnect(this._connectionId);
            this._connectionId = null;
        }
        this.clear();
        this._settings = null;
    }
}

export class HashUtils {
    static hashContent(content) {
        if (!content) return '';

        let hash = 0;
        const str = String(content);
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        return Math.abs(hash).toString(36);
    }

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

export class ValidationUtils {
    static validateNumber(value, min, max, defaultValue) {
        if (typeof value !== 'number' || isNaN(value)) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }

    static isValidText(text, minLength = 1) {
        return text && typeof text === 'string' && text.trim().length >= minLength;
    }
}
