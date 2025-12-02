/**
 * ClipMaster - Constants and Enums
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

// Clipboard Item Types
export const ItemType = {
    TEXT: 'text',
    HTML: 'html',
    IMAGE: 'image',
    FILE: 'file',
    URL: 'url',
    COLOR: 'color'
};

// Debug Logger - controlled by settings
let _debugMode = false;

export function debugLog(message) {
    if (_debugMode) {
        log(`ClipMaster DEBUG: ${message}`);
    }
}

export function setDebugMode(enabled) {
    _debugMode = enabled;
    if (enabled) {
        log('ClipMaster: Debug mode ENABLED');
    }
}

export function isDebugMode() {
    return _debugMode;
}



