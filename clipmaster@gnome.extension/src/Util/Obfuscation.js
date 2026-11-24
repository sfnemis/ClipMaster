/*
 * ClipMaster - Stored history obfuscation
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * This is OBFUSCATION, NOT ENCRYPTION, and the difference matters to anyone
 * deciding whether to trust it:
 *
 *   - The transform is a repeating-key XOR over the UTF-8 bytes of the data.
 *   - The key is stored in the clear, next to the database and in GSettings,
 *     because the extension has to read the history back without asking the
 *     user for anything.
 *   - There is no integrity tag, so a modified file is not detected.
 *
 * Anyone who can read the database file can also read the key and recover the
 * plaintext. What it does buy is that the history is not sitting in a plain
 * text file that any grep, backup indexer or file preview will show. Treat it
 * as that and nothing more. Versions up to 1.3.1 described this feature as
 * "AES-256" in the preferences window, which was wrong.
 *
 * GJS has no cipher available in the libraries GNOME Shell already links, and
 * the review guidelines discourage spawning helper processes, so real
 * encryption is not something this extension can offer honestly today.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const KEY_LENGTH = 32;

// Written by 1.3.1 and earlier: the XOR ran over UTF-16 code units, which
// turns a lone surrogate into U+FFFD and corrupts any emoji in the history.
// Still read so existing databases survive the upgrade.
const LEGACY_PREFIX = 'ENC:';

// Current format: the XOR runs over UTF-8 bytes, which round-trips any text.
const PREFIX = 'CMOB1:';

export class HistoryObfuscator {
    constructor(key) {
        this._key = key || HistoryObfuscator.generateKey();
        this._keyBytes = new TextEncoder().encode(this._key);
    }

    /**
     * Draws the key from the system random source. `Math.random()`, which
     * earlier versions used, is not a random source for anything a user would
     * rather keep to themselves.
     */
    static generateKey() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let key = '';

        // Exactly KEY_LENGTH bytes are read from a stream. Reading the whole
        // of /dev/urandom never ends, because the device has no end.
        let stream = null;
        try {
            stream = Gio.File.new_for_path('/dev/urandom').read(null);
            const bytes = stream.read_bytes(KEY_LENGTH, null).get_data();

            if (bytes.length === KEY_LENGTH) {
                for (let i = 0; i < KEY_LENGTH; i++)
                    key += chars.charAt(bytes[i] % chars.length);
                return key;
            }
        } catch (e) {
            console.warn(`ClipMaster: could not read the system random source, falling back to a weaker key: ${e.message}`);
        } finally {
            stream?.close(null);
        }

        const seed = `${GLib.get_monotonic_time()}-${GLib.get_real_time()}-${GLib.random_int()}`;
        const digest = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, seed, -1);
        for (let i = 0; i < KEY_LENGTH; i++)
            key += chars.charAt(parseInt(digest.substr(i * 2, 2), 16) % chars.length);
        return key;
    }

    get key() {
        return this._key;
    }

    static isObfuscated(text) {
        return typeof text === 'string' && (text.startsWith(PREFIX) || text.startsWith(LEGACY_PREFIX));
    }

    obfuscate(plainText) {
        if (!plainText)
            return '';

        const data = new TextEncoder().encode(plainText);
        for (let i = 0; i < data.length; i++)
            data[i] ^= this._keyBytes[i % this._keyBytes.length];

        return PREFIX + GLib.base64_encode(data);
    }

    /**
     * Accepts either format and throws on anything it cannot read, so the
     * caller can tell a damaged file apart from an empty one. Returning an
     * empty string here is what used to let a failed read become a write that
     * replaced the whole history.
     */
    deobfuscate(text) {
        if (!text)
            return '';

        if (text.startsWith(PREFIX))
            return this._deobfuscateBytes(text.substring(PREFIX.length));

        if (text.startsWith(LEGACY_PREFIX))
            return this._deobfuscateLegacy(text.substring(LEGACY_PREFIX.length));

        throw new Error('Not an obfuscated ClipMaster database');
    }

    _deobfuscateBytes(encoded) {
        const data = GLib.base64_decode(encoded);
        if (!data || data.length === 0)
            throw new Error('Obfuscated payload is empty');

        const out = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++)
            out[i] = data[i] ^ this._keyBytes[i % this._keyBytes.length];

        return new TextDecoder('utf-8', { fatal: true }).decode(out);
    }

    _deobfuscateLegacy(encoded) {
        const decoded = GLib.base64_decode(encoded);
        if (!decoded || decoded.length === 0)
            throw new Error('Legacy payload is empty');

        const text = new TextDecoder().decode(decoded);
        let result = '';
        for (let i = 0; i < text.length; i++)
            result += String.fromCharCode(text.charCodeAt(i) ^ this._key.charCodeAt(i % this._key.length));

        return result;
    }
}
