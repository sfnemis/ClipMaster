/**
 * ClipMaster - Simple XOR Encryption Helper
 * Lightweight encryption for GNOME Shell
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';

export class SimpleEncryption {
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


