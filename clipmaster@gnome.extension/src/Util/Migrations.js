/*
 * ClipMaster - Settings migrations
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Runs once per settings version, from `enable()`, so an upgrade does not
 * silently change what the user had configured.
 */

const CURRENT_VERSION = 1;

export function migrateSettings(settings) {
    const version = settings.get_int('settings-version');
    if (version >= CURRENT_VERSION)
        return;

    if (version < 1)
        migrateToVersion1(settings);

    settings.set_int('settings-version', CURRENT_VERSION);
}

/**
 * Version 1 replaces the `popup-at-cursor` switch with the `popup-position`
 * choice, which also covers the fixed screen anchors.
 *
 * It deliberately does not carry the old keyboard shortcuts forward. Up to
 * 1.3.1 the schema shipped `<Shift><Super>v` and `<Ctrl><Shift>v` as defaults,
 * which the review guidelines do not allow for an extension that reads the
 * clipboard, and the second one took the paste shortcut away from every
 * terminal. A user who had chosen their own shortcut has it stored and keeps
 * it; a user who was relying on the shipped default is told once that the
 * shortcut is now theirs to pick.
 */
function migrateToVersion1(settings) {
    if (!settings.get_boolean('popup-at-cursor'))
        settings.set_string('popup-position', 'center');

    const hasOwnShortcut = settings.get_strv('toggle-popup').length > 0;
    settings.set_boolean('show-shortcut-hint', !hasOwnShortcut);
}
