/*
 * ClipMaster - Shared constants and debug logging
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

export const ItemType = {
    TEXT: 'text',
    HTML: 'html',
    IMAGE: 'image',
    FILE: 'file',
    URL: 'url',
    COLOR: 'color',
    CODE: 'code',
};

let debugEnabled = false;

/**
 * Writes to the journal only while the debug setting is on. Clipboard content
 * is never logged, not even in debug mode: lengths and types are, the text is
 * not.
 *
 * `console.log` rather than `console.debug`, because journald drops debug level
 * messages unless it is asked for them, so the command the preferences window
 * gives for reading the log showed nothing at all.
 */
export function debugLog(message) {
    if (debugEnabled)
        console.log(`ClipMaster: ${message}`);
}

export function setDebugMode(enabled) {
    debugEnabled = enabled;
}
