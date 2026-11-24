/*
 * ClipMaster - Utility Classes
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { reportWarning } from './Constants.js';

/**
 * Tracks signal handlers so they can all be disconnected again.
 *
 * Handlers are grouped under a caller supplied name, so a group that is set up
 * and torn down repeatedly (a drag, a popup) can be released on its own while
 * the rest stay connected.
 */
export class SignalManager {
    constructor() {
        this._connections = new Map();
    }

    connect(object, signal, callback, id) {
        const handlerId = object.connect(signal, callback);

        if (id) {
            if (!this._connections.has(id))
                this._connections.set(id, []);
            this._connections.get(id).push({ object, handlerId });
        }

        return handlerId;
    }

    disconnect(id) {
        const connections = this._connections.get(id);
        if (!connections)
            return;

        this._connections.delete(id);

        for (const { object, handlerId } of connections) {
            // A handler whose object was already finalized throws rather than
            // returning an error, and one dead object must not keep the rest
            // of the group connected.
            try {
                object.disconnect(handlerId);
            } catch (e) {
                reportWarning(`could not disconnect handler ${handlerId} of group "${id}": ${e.message}`);
            }
        }
    }

    disconnectAll() {
        for (const id of [...this._connections.keys()])
            this.disconnect(id);
    }

    get size() {
        return this._connections.size;
    }
}

/**
 * Tracks GLib main loop sources so every one of them can be removed again.
 *
 * Adding a source under a name that is already in use removes the earlier one
 * first, so a repeated trigger cannot stack up timeouts.
 */
export class TimeoutManager {
    constructor() {
        this._timeouts = new Map();
        this._counter = 0;
    }

    add(priority, interval, callback, id) {
        const trackingId = id || `anonymous-${++this._counter}`;
        this.remove(trackingId);

        const timeoutId = GLib.timeout_add(priority, interval, () => {
            const result = callback();
            if (result === GLib.SOURCE_REMOVE)
                this._timeouts.delete(trackingId);
            return result;
        });

        this._timeouts.set(trackingId, timeoutId);
        return trackingId;
    }

    remove(id) {
        const timeoutId = this._timeouts.get(id);
        if (timeoutId === undefined)
            return;

        this._timeouts.delete(id);
        GLib.source_remove(timeoutId);
    }

    removeAll() {
        const ids = [...this._timeouts.values()];
        this._timeouts.clear();
        for (const timeoutId of ids)
            GLib.source_remove(timeoutId);
    }

    get size() {
        return this._timeouts.size;
    }
}

/**
 * Wrappers around the asynchronous Gio calls this extension uses.
 *
 * GNOME Shell promisifies a list of these for its own code, but a plain GJS
 * process does not, and the list is not part of any API an extension should
 * lean on. Wrapping them here means the same code runs inside the shell and
 * under `gjs` in the test suite.
 */
export function loadContents(file, cancellable = null) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (source, result) => {
            try {
                const [, contents] = source.load_contents_finish(result);
                resolve(contents);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function queryInfo(file, attributes, cancellable = null) {
    return new Promise((resolve, reject) => {
        file.query_info_async(
            attributes, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
            (source, result) => {
                try {
                    resolve(source.query_info_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export class FileUtils {
    static ensureDirectory(path) {
        const dir = GLib.path_get_dirname(path);
        return GLib.mkdir_with_parents(dir, 0o700) === 0;
    }

    static async loadTextFile(path) {
        try {
            return new TextDecoder().decode(await loadContents(Gio.File.new_for_path(path)));
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return null;
            throw e;
        }
    }

    /**
     * Writes `content` through a temporary file and renames it into place, so a
     * write that is interrupted leaves the previous file intact instead of a
     * truncated one. The file is created with owner-only permissions.
     */
    static async saveTextFileAtomic(path, content) {
        FileUtils.ensureDirectory(path);

        const tmpPath = `${path}.tmp`;
        const tmpFile = Gio.File.new_for_path(tmpPath);
        const bytes = new GLib.Bytes(new TextEncoder().encode(content));

        // `replace_contents_bytes_async` finishes with `replace_contents_finish`,
        // a name GJS cannot pair up on its own, so it is wrapped by hand rather
        // than awaited directly.
        await new Promise((resolve, reject) => {
            tmpFile.replace_contents_bytes_async(
                bytes, null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null,
                (file, result) => {
                    try {
                        file.replace_contents_finish(result);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });

        const info = new Gio.FileInfo();
        info.set_attribute_uint32('unix::mode', 0o600);
        try {
            tmpFile.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            // A filesystem without unix permissions is not a reason to lose the write.
            reportWarning(`could not set permissions on ${tmpPath}: ${e.message}`);
        }

        tmpFile.move(Gio.File.new_for_path(path), Gio.FileCopyFlags.OVERWRITE, null, null);
        return true;
    }

    /**
     * Synchronous variant for the one place that needs it: the final save while
     * GNOME Shell is already tearing the extension down, where an async write
     * would be abandoned before it reaches the disk.
     */
    static saveTextFileAtomicSync(path, content) {
        FileUtils.ensureDirectory(path);

        const tmpPath = `${path}.tmp`;
        const tmpFile = Gio.File.new_for_path(tmpPath);
        const bytes = new GLib.Bytes(new TextEncoder().encode(content));

        tmpFile.replace_contents(
            bytes.get_data(), null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        const info = new Gio.FileInfo();
        info.set_attribute_uint32('unix::mode', 0o600);
        try {
            tmpFile.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            reportWarning(`could not set permissions on ${tmpPath}: ${e.message}`);
        }

        tmpFile.move(Gio.File.new_for_path(path), Gio.FileCopyFlags.OVERWRITE, null, null);
        return true;
    }

    static fileExists(path) {
        return Gio.File.new_for_path(path).query_exists(null);
    }
}

/**
 * Reads settings through a cache that is invalidated by the `changed` signal.
 *
 * `destroy()` disconnects first and only then drops the settings object, so a
 * late emission can never reach a half torn down cache.
 */
export class SettingsCache {
    constructor(settings) {
        this._settings = settings;
        this._cache = new Map();
        this._changedId = settings.connect('changed', (_settings, key) => this._cache.delete(key));
    }

    _get(key, getter) {
        if (this._cache.has(key))
            return this._cache.get(key);

        if (!this._settings)
            throw new Error(`ClipMaster: settings cache read for "${key}" after destroy`);

        const value = this._settings[getter](key);
        this._cache.set(key, value);
        return value;
    }

    getBoolean(key) {
        return this._get(key, 'get_boolean');
    }

    getInt(key) {
        return this._get(key, 'get_int');
    }

    getString(key) {
        return this._get(key, 'get_string');
    }

    getStrv(key) {
        return this._get(key, 'get_strv');
    }

    destroy() {
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = null;
        }
        this._cache.clear();
        this._settings = null;
    }
}

export class HashUtils {
    /**
     * Content hashes decide whether a clipboard entry is a duplicate, so a
     * collision silently discards a distinct entry. SHA-256 makes that
     * outcome impossible in practice; the earlier 32 bit hash did not.
     */
    static hashContent(content) {
        if (!content)
            return '';

        return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, String(content), -1);
    }

    static hashImageData(data) {
        if (!data || data.length === 0)
            return '';

        const bytes = data instanceof GLib.Bytes ? data : new GLib.Bytes(data);
        return GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
    }
}

export class ValidationUtils {
    static validateNumber(value, min, max, defaultValue) {
        if (typeof value !== 'number' || Number.isNaN(value))
            return defaultValue;
        return Math.max(min, Math.min(max, value));
    }

    static isValidText(text, minLength = 1) {
        return typeof text === 'string' && text.trim().length >= minLength;
    }
}
