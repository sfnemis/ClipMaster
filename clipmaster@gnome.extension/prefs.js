/*
 * ClipMaster Preferences
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * This file runs in its own GTK process and cannot reach anything in GNOME
 * Shell. Where it has to touch the stored history it does so on the file and
 * then asks the running extension to reload, through the `reload-request`
 * setting, so the shell's copy in memory cannot overwrite the change again.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { HistoryObfuscator } from './src/Util/Obfuscation.js';

const THEMES = [
    ['adwaita', 'Adwaita'],
    ['catppuccin', 'Catppuccin'],
    ['dracula', 'Dracula'],
    ['nord', 'Nord'],
    ['gruvbox', 'Gruvbox'],
    ['onedark', 'One Dark'],
    ['monokai', 'Monokai'],
    ['solarized', 'Solarized'],
    ['tokyonight', 'Tokyo Night'],
    ['rosepine', 'Rose Pine'],
    ['material', 'Material'],
    ['ayu', 'Ayu'],
];

// Built when the window is, not at module scope: the gettext helper is only
// usable once the extension context exists, and calling it while the module
// loads makes the preferences window fail to open at all.
function positionChoices() {
    return [
        ['cursor', _('At the pointer')],
        ['center', _('Middle of the screen')],
        ['top-left', _('Top left')],
        ['top-center', _('Top centre')],
        ['top-right', _('Top right')],
        ['left', _('Left edge')],
        ['right', _('Right edge')],
        ['bottom-left', _('Bottom left')],
        ['bottom-center', _('Bottom centre')],
        ['bottom-right', _('Bottom right')],
    ];
}

export default class ClipMasterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(this._buildGeneralPage(settings));
        window.add(this._buildPopupPage(settings));
        window.add(this._buildShortcutsPage(window, settings));
        window.add(this._buildPrivacyPage(window, settings));
        window.add(this._buildStoragePage(window, settings));
        window.add(this._buildAboutPage(settings));
    }

    // ---------------------------------------------------------------- general

    _buildGeneralPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        const historyGroup = new Adw.PreferencesGroup({
            title: _('History'),
            description: _('How much is kept and for how long'),
        });
        page.add(historyGroup);

        historyGroup.add(this._spinRow(settings, 'history-size', {
            title: _('Items to keep'),
            subtitle: _('Favourites and pinned items are always kept, whatever this says'),
            lower: 10, upper: 5000, step: 10,
        }));

        historyGroup.add(this._spinRow(settings, 'items-per-page', {
            title: _('Items shown at once'),
            subtitle: _('How many rows the popup lists'),
            lower: 5, upper: 50, step: 1,
        }));

        historyGroup.add(this._spinRow(settings, 'preview-length', {
            title: _('Preview length'),
            subtitle: _('Characters of each item shown in the list'),
            lower: 20, upper: 500, step: 10,
        }));

        historyGroup.add(this._switchRow(settings, 'skip-duplicates', {
            title: _('Skip duplicates'),
            subtitle: _('Move an item that is already stored to the top instead of adding it twice'),
        }));

        const contentGroup = new Adw.PreferencesGroup({
            title: _('What gets recorded'),
            description: _('Private mode and the excluded applications list override all of this'),
        });
        page.add(contentGroup);

        contentGroup.add(this._switchRow(settings, 'track-images', {
            title: _('Images'),
            subtitle: _('Store images copied to the clipboard'),
        }));

        contentGroup.add(this._switchRow(settings, 'prefer-image-over-text', {
            title: _('Prefer the picture when a copy offers both'),
            subtitle: _('Spreadsheets, note applications and drawing canvases often offer text and a picture of that text at once. ClipMaster keeps the text unless this is on.'),
        }));

        contentGroup.add(this._switchRow(settings, 'track-files', {
            title: _('Copied files'),
            subtitle: _('Store file references copied from a file manager'),
        }));

        contentGroup.add(this._switchRow(settings, 'track-primary-selection', {
            title: _('Selected text'),
            subtitle: _('Also record text that is only selected, which is what middle click pastes. This records a great deal.'),
        }));

        contentGroup.add(this._switchRow(settings, 'strip-whitespace', {
            title: _('Trim whitespace'),
            subtitle: _('Remove spaces and newlines from the start and end of stored text'),
        }));

        return page;
    }

    // ------------------------------------------------------------------ popup

    _buildPopupPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Popup'),
            icon_name: 'preferences-other-symbolic',
        });

        const behaviourGroup = new Adw.PreferencesGroup({ title: _('Behaviour') });
        page.add(behaviourGroup);

        behaviourGroup.add(this._enumRow(settings, 'popup-position', positionChoices(), {
            title: _('Where it opens'),
            subtitle: _('On the monitor the pointer is on'),
        }));

        behaviourGroup.add(this._switchRow(settings, 'paste-on-select', {
            title: _('Copy on hover'),
            subtitle: _('Put an item on the clipboard when the pointer rests on it, without a click'),
        }));

        behaviourGroup.add(this._switchRow(settings, 'close-on-paste', {
            title: _('Close after choosing an item'),
        }));

        const clickOutsideRow = this._switchRow(settings, 'close-on-click-outside', {
            title: _('Close when clicking elsewhere'),
            subtitle: _('Also closes when another window takes the focus'),
        });
        behaviourGroup.add(clickOutsideRow);

        const graceRow = this._spinRow(settings, 'click-outside-grace-ms', {
            title: _('Ignore clicks for'),
            subtitle: _('Milliseconds after opening, so the click that opened the popup cannot close it'),
            lower: 0, upper: 2000, step: 50,
        });
        clickOutsideRow.bind_property(
            'active', graceRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        behaviourGroup.add(graceRow);

        behaviourGroup.add(this._switchRow(settings, 'show-notification', {
            title: _('Notify on every new item'),
            subtitle: _('A notification each time something is added to the history'),
        }));

        const sizeGroup = new Adw.PreferencesGroup({
            title: _('Size'),
            description: _('In logical pixels. On a HiDPI monitor the popup is scaled up from these, so it keeps the same physical size. The popup can also be resized by dragging the handle in its bottom right corner.'),
        });
        page.add(sizeGroup);

        sizeGroup.add(this._spinRow(settings, 'popup-width', {
            title: _('Width'), lower: 280, upper: 2400, step: 10,
        }));
        sizeGroup.add(this._spinRow(settings, 'popup-height', {
            title: _('Height'), lower: 280, upper: 2000, step: 10,
        }));

        const appearanceGroup = new Adw.PreferencesGroup({ title: _('Appearance') });
        page.add(appearanceGroup);

        const followSystemRow = this._switchRow(settings, 'follow-system-theme', {
            title: _('Follow the system theme'),
            subtitle: _('Use light or dark Adwaita to match the desktop'),
        });
        appearanceGroup.add(followSystemRow);

        const themeRow = this._enumRow(settings, 'theme', THEMES, { title: _('Theme') });
        followSystemRow.bind_property('active', themeRow, 'sensitive',
            GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);
        appearanceGroup.add(themeRow);

        const darkThemeRow = this._switchRow(settings, 'dark-theme', {
            title: _('Dark variant'),
            subtitle: _('Used when the system theme is not being followed'),
        });
        followSystemRow.bind_property('active', darkThemeRow, 'sensitive',
            GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);
        appearanceGroup.add(darkThemeRow);

        appearanceGroup.add(this._customThemeRow(settings));

        const indicatorGroup = new Adw.PreferencesGroup({ title: _('Panel') });
        page.add(indicatorGroup);

        indicatorGroup.add(this._switchRow(settings, 'show-indicator', {
            title: _('Show the panel icon'),
        }));

        return page;
    }

    _customThemeRow(settings) {
        const row = new Adw.ActionRow({ title: _('Custom stylesheet') });

        const updateSubtitle = () => {
            const path = settings.get_string('custom-theme-path');
            row.subtitle = path || _('Load a CSS file instead of a built-in theme');
        };
        updateSubtitle();

        const chooseButton = new Gtk.Button({ label: _('Choose'), valign: Gtk.Align.CENTER });
        chooseButton.connect('clicked', () => {
            const fileDialog = new Gtk.FileDialog({ title: _('Select a CSS file') });

            const filter = new Gtk.FileFilter();
            filter.set_name(_('CSS files'));
            filter.add_pattern('*.css');
            fileDialog.set_default_filter(filter);

            fileDialog.open(row.get_root(), null, (dialog, result) => {
                try {
                    const file = dialog.open_finish(result);
                    if (file)
                        settings.set_string('custom-theme-path', file.get_path());
                    updateSubtitle();
                } catch (e) {
                    this._reportDialogError(e, 'custom theme');
                }
            });
        });
        row.add_suffix(chooseButton);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Use the built-in themes again'),
        });
        clearButton.connect('clicked', () => {
            settings.set_string('custom-theme-path', '');
            updateSubtitle();
        });
        row.add_suffix(clearButton);

        return row;
    }

    // -------------------------------------------------------------- shortcuts

    _buildShortcutsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Shortcuts'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Keyboard shortcuts'),
            description: _('ClipMaster ships without any shortcut set, because the GNOME Extensions review guidelines do not allow an extension that reads the clipboard to claim one, and the two that earlier versions used were already taken by GNOME and by every terminal. Choose whatever suits you.'),
        });
        page.add(group);

        group.add(this._shortcutRow(window, settings, 'toggle-popup', _('Show the clipboard history')));
        group.add(this._shortcutRow(window, settings, 'paste-as-plain', _('Paste the last item as plain text')));
        group.add(this._shortcutRow(window, settings, 'toggle-private-mode', _('Turn private mode on or off')));

        return page;
    }

    _shortcutRow(window, settings, key, title) {
        const row = new Adw.ActionRow({ title });

        // A Gtk.ShortcutLabel draws nothing when it has no accelerator, so a row
        // with no shortcut would look like one whose shortcut failed to render.
        // The plain label is what is shown in that case.
        const shortcutLabel = new Gtk.ShortcutLabel({ valign: Gtk.Align.CENTER });
        const emptyLabel = new Gtk.Label({
            label: _('Not set'),
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        });

        const sync = () => {
            const accelerators = settings.get_strv(key);
            const accelerator = accelerators.length > 0 ? accelerators[0] : '';

            shortcutLabel.accelerator = accelerator;
            shortcutLabel.visible = accelerator !== '';
            emptyLabel.visible = accelerator === '';
        };

        row.add_suffix(emptyLabel);
        row.add_suffix(shortcutLabel);
        sync();

        const changedId = settings.connect(`changed::${key}`, sync);
        row.connect('destroy', () => settings.disconnect(changedId));

        const setButton = new Gtk.Button({
            label: _('Set'),
            valign: Gtk.Align.CENTER,
        });
        setButton.connect('clicked', () => this._captureShortcut(window, settings, key, title));
        row.add_suffix(setButton);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Remove this shortcut'),
        });
        clearButton.connect('clicked', () => settings.set_strv(key, []));
        row.add_suffix(clearButton);

        return row;
    }

    /**
     * Reads the next key combination the user presses, rather than asking them
     * to type an accelerator string by hand as earlier versions did.
     */
    _captureShortcut(window, settings, key, title) {
        const dialog = new Adw.AlertDialog({
            heading: _('Press the new shortcut'),
            body: `${title}\n\n${_('Press Escape to cancel or Backspace to remove the shortcut.')}`,
        });
        dialog.add_response('cancel', _('Cancel'));

        const controller = new Gtk.EventControllerKey();
        controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);

        controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;

            if (keyval === Gdk.KEY_Escape && mask === 0) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                settings.set_strv(key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // A bare letter would take that key away from every application.
            if (!this._isValidBinding(mask, keyval))
                return Gdk.EVENT_STOP;

            const accelerator = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
            settings.set_strv(key, [accelerator]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });

        dialog.add_controller(controller);
        dialog.present(window);
    }

    _isValidBinding(mask, keyval) {
        if (mask === 0)
            return false;

        // Shift alone turns a letter into another letter, not a shortcut.
        if (mask === Gdk.ModifierType.SHIFT_MASK) {
            const isFunctionKey = keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F35;
            if (!isFunctionKey)
                return false;
        }

        return Gtk.accelerator_valid(keyval, mask);
    }

    // ---------------------------------------------------------------- privacy

    _buildPrivacyPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Privacy'),
            icon_name: 'security-high-symbolic',
        });

        const modeGroup = new Adw.PreferencesGroup({ title: _('Private mode') });
        page.add(modeGroup);

        modeGroup.add(this._switchRow(settings, 'private-mode', {
            title: _('Stop recording'),
            subtitle: _('Nothing is added to the history while this is on. The panel icon changes so it is obvious.'),
        }));

        const group = new Adw.PreferencesGroup({
            title: _('Excluded applications'),
            description: _('Copies made in these applications are never recorded. An entry matches the application id, its name or its window class, with or without a .desktop suffix, and case does not matter. Run "gnome-extensions info" is not needed: the usual spellings such as org.gnome.seahorse.Application, seahorse or Passwords and Keys all work.'),
        });
        page.add(group);

        const addRow = new Adw.ActionRow({
            title: _('Add an application'),
            subtitle: _('For example a password manager'),
        });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
        });
        addButton.connect('clicked', () => this._showAddAppDialog(window, settings, group));
        addRow.add_suffix(addButton);
        addRow.activatable_widget = addButton;
        group.add(addRow);

        this._excludedRows = [];
        this._reloadExcludedApps(settings, group);

        return page;
    }

    _reloadExcludedApps(settings, group) {
        for (const row of this._excludedRows)
            group.remove(row);
        this._excludedRows = [];

        for (const app of settings.get_strv('excluded-apps')) {
            const row = new Adw.ActionRow({ title: app });

            const removeButton = new Gtk.Button({
                icon_name: 'edit-delete-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            removeButton.connect('clicked', () => {
                settings.set_strv('excluded-apps', settings.get_strv('excluded-apps').filter(a => a !== app));
                this._reloadExcludedApps(settings, group);
            });
            row.add_suffix(removeButton);

            group.add(row);
            this._excludedRows.push(row);
        }
    }

    _showAddAppDialog(window, settings, group) {
        const dialog = new Adw.AlertDialog({
            heading: _('Add an excluded application'),
            body: _('Type the application name, its id or its window class.'),
        });

        const entry = new Gtk.Entry({
            placeholder_text: _('KeePassXC, 1Password, org.gnome.seahorse.Application'),
            margin_top: 12,
            activates_default: true,
        });
        dialog.set_extra_child(entry);

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('add', _('Add'));
        dialog.set_default_response('add');
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', (_dialog, response) => {
            if (response !== 'add')
                return;

            const name = entry.get_text().trim();
            if (!name)
                return;

            const current = settings.get_strv('excluded-apps');
            if (current.includes(name))
                return;

            settings.set_strv('excluded-apps', [...current, name]);
            this._reloadExcludedApps(settings, group);
        });

        dialog.present(window);
    }

    // ---------------------------------------------------------------- storage

    _buildStoragePage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Storage'),
            icon_name: 'drive-harddisk-symbolic',
        });

        const locationGroup = new Adw.PreferencesGroup({ title: _('Where the history is kept') });
        page.add(locationGroup);

        const pathRow = new Adw.ActionRow({
            title: _('History file'),
            subtitle: this._storagePath(settings),
        });

        const browseButton = new Gtk.Button({ label: _('Change'), valign: Gtk.Align.CENTER });
        browseButton.connect('clicked', () => this._browseStorageDirectory(window, settings, pathRow));
        pathRow.add_suffix(browseButton);

        const resetButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Use the default location'),
        });
        resetButton.connect('clicked', () => {
            settings.set_string('storage-path', '');
            pathRow.subtitle = this._storagePath(settings);
        });
        pathRow.add_suffix(resetButton);
        locationGroup.add(pathRow);

        const sizeRow = new Adw.ActionRow({ title: _('File size') });
        const refreshSize = () => {
            sizeRow.subtitle = this._describeFileSize(this._storagePath(settings));
        };
        refreshSize();

        const refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Check again'),
        });
        refreshButton.connect('clicked', refreshSize);
        sizeRow.add_suffix(refreshButton);
        locationGroup.add(sizeRow);

        const limitsGroup = new Adw.PreferencesGroup({ title: _('Limits') });
        page.add(limitsGroup);

        limitsGroup.add(this._spinRow(settings, 'max-item-size-mb', {
            title: _('Largest text item'),
            subtitle: _('Megabytes. Longer text is stored truncated.'),
            lower: 1, upper: 10, step: 1,
        }));
        limitsGroup.add(this._spinRow(settings, 'max-image-size-mb', {
            title: _('Largest image'),
            subtitle: _('Megabytes. Larger images are not stored.'),
            lower: 1, upper: 50, step: 1,
        }));
        limitsGroup.add(this._spinRow(settings, 'max-db-size-mb', {
            title: _('Largest history file'),
            subtitle: _('Megabytes. The oldest items are removed when this is reached.'),
            lower: 1, upper: 500, step: 5,
        }));

        page.add(this._buildObfuscationGroup(settings));
        page.add(this._buildDataGroup(window, settings));

        return page;
    }

    /**
     * Says plainly what this feature is. Up to 1.3.1 this page claimed
     * "AES-256", which the code never did: it is a repeating-key XOR with the
     * key stored beside the data.
     */
    _buildObfuscationGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Stored history'),
            description: _('ClipMaster can scramble its history file so that the text is not readable at a glance, by a search tool, a backup indexer or a file preview. This is obfuscation, not encryption: the key is stored next to the data, so anyone who can read the file can also recover what is in it. For anything that must stay secret, add the application to the excluded list or use private mode instead.'),
        });

        group.add(this._switchRow(settings, 'encrypt-database', {
            title: _('Obfuscate the history file'),
            subtitle: _('Takes effect the next time the extension starts'),
        }));

        const keyRow = new Adw.ActionRow({
            title: _('Key'),
            subtitle: settings.get_string('encryption-key')
                ? _('A key has been generated and is stored beside the history file')
                : _('No key yet. One is generated when obfuscation is first used.'),
        });
        group.add(keyRow);

        return group;
    }

    _buildDataGroup(window, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Data'),
            description: _('Export writes a plain JSON file. Import and clear change the stored history and ask the running extension to reload it.'),
        });

        const exportRow = new Adw.ActionRow({
            title: _('Export the history'),
            subtitle: _('Save everything to a readable JSON file'),
        });
        const exportButton = new Gtk.Button({ label: _('Export'), valign: Gtk.Align.CENTER });
        exportButton.connect('clicked', () => this._exportData(window, settings));
        exportRow.add_suffix(exportButton);
        group.add(exportRow);

        const importRow = new Adw.ActionRow({
            title: _('Import a history file'),
            subtitle: _('Add the items from an exported file'),
        });
        const importButton = new Gtk.Button({ label: _('Import'), valign: Gtk.Align.CENTER });
        importButton.connect('clicked', () => this._importData(window, settings));
        importRow.add_suffix(importButton);
        group.add(importRow);

        const clearRow = new Adw.ActionRow({
            title: _('Clear the history'),
            subtitle: _('Delete everything except favourites and pinned items'),
        });
        const clearButton = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearButton.connect('clicked', () => this._confirmClear(window, settings));
        clearRow.add_suffix(clearButton);
        group.add(clearRow);

        return group;
    }

    // ------------------------------------------------------------------ about

    _buildAboutPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });

        const group = new Adw.PreferencesGroup();
        page.add(group);

        group.add(new Adw.ActionRow({
            title: 'ClipMaster',
            subtitle: _('A clipboard history for GNOME Shell'),
        }));

        group.add(new Adw.ActionRow({
            title: _('Version'),
            subtitle: this.metadata['version-name'] || String(this.metadata.version || ''),
        }));

        const linkRow = new Adw.ActionRow({
            title: _('Report a problem'),
            subtitle: this.metadata.url,
        });
        const linkButton = new Gtk.LinkButton({
            label: _('Open'),
            uri: this.metadata.url,
            valign: Gtk.Align.CENTER,
        });
        linkRow.add_suffix(linkButton);
        group.add(linkRow);

        const debugGroup = new Adw.PreferencesGroup({ title: _('Troubleshooting') });
        page.add(debugGroup);

        debugGroup.add(this._switchRow(settings, 'debug-mode', {
            title: _('Debug logging'),
            subtitle: _('Write extra detail to the journal. Leave this off for everyday use.'),
        }));

        debugGroup.add(new Adw.ActionRow({
            title: _('Read the log with'),
            subtitle: 'journalctl -f -o cat /usr/bin/gnome-shell',
        }));

        return page;
    }

    // ---------------------------------------------------------------- helpers

    _switchRow(settings, key, { title, subtitle }) {
        const row = new Adw.SwitchRow({ title, subtitle: subtitle || '' });
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spinRow(settings, key, { title, subtitle, lower, upper, step }) {
        const row = new Adw.SpinRow({
            title,
            subtitle: subtitle || '',
            adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: step, page_increment: step * 10,
            }),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _enumRow(settings, key, choices, { title, subtitle }) {
        const row = new Adw.ComboRow({ title, subtitle: subtitle || '' });

        const model = new Gtk.StringList();
        for (const [, label] of choices)
            model.append(label);
        row.model = model;

        const values = choices.map(([value]) => value);
        const current = values.indexOf(settings.get_string(key));
        row.selected = current >= 0 ? current : 0;

        row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));

        return row;
    }

    _storagePath(settings) {
        return settings.get_string('storage-path')
            || GLib.build_filenamev([GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json']);
    }

    _describeFileSize(path) {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null))
            return _('The file does not exist yet');

        try {
            const bytes = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            if (bytes > 1024 * 1024)
                return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
            return `${(bytes / 1024).toFixed(1)} KB`;
        } catch {
            return _('The size could not be read');
        }
    }

    _browseStorageDirectory(window, settings, pathRow) {
        const dialog = new Gtk.FileDialog({ title: _('Choose a folder for the history file') });

        dialog.select_folder(window, null, (fileDialog, result) => {
            try {
                const folder = fileDialog.select_folder_finish(result);
                if (!folder)
                    return;

                settings.set_string('storage-path', GLib.build_filenamev([folder.get_path(), 'clipboard.json']));
                pathRow.subtitle = this._storagePath(settings);
            } catch (e) {
                this._reportDialogError(e, 'storage folder');
            }
        });
    }

    _reportDialogError(error, what) {
        if (error.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
            return;
        console.error(`ClipMaster: ${what} dialog failed: ${error.message}`);
    }

    /**
     * Reads the stored history, whichever format it is in. Returns the parsed
     * object, or throws with a message meant for the user.
     */
    _readHistory(settings) {
        const path = this._storagePath(settings);
        const file = Gio.File.new_for_path(path);

        if (!file.query_exists(null))
            throw new Error(_('There is no history file yet.'));

        const [ok, contents] = file.load_contents(null);
        if (!ok)
            throw new Error(_('The history file could not be read.'));

        let text = new TextDecoder().decode(contents);
        if (!text.trim())
            throw new Error(_('The history file is empty.'));

        if (HistoryObfuscator.isObfuscated(text)) {
            const key = settings.get_string('encryption-key');
            if (!key)
                throw new Error(_('The history is obfuscated but its key is missing.'));

            try {
                text = new HistoryObfuscator(key).deobfuscate(text);
            } catch {
                throw new Error(_('The history could not be decoded with the stored key.'));
            }
        }

        try {
            return { path, data: JSON.parse(text) };
        } catch {
            throw new Error(_('The history file is damaged.'));
        }
    }

    /**
     * Writes the history back in the format the extension expects and bumps
     * `reload-request`, which the running extension watches. Without that the
     * shell would still hold the old history in memory and write it back over
     * this one.
     */
    _writeHistory(settings, path, data) {
        let payload = JSON.stringify(data);

        if (settings.get_boolean('encrypt-database')) {
            const key = settings.get_string('encryption-key');
            if (key)
                payload = new HistoryObfuscator(key).obfuscate(payload);
        }

        const file = Gio.File.new_for_path(path);
        file.replace_contents(
            new TextEncoder().encode(payload), null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        settings.set_int('reload-request', settings.get_int('reload-request') + 1);
    }

    _exportData(window, settings) {
        const dialog = new Gtk.FileDialog({
            title: _('Export the clipboard history'),
            initial_name: 'clipmaster-export.json',
        });

        dialog.save(window, null, (fileDialog, result) => {
            try {
                const target = fileDialog.save_finish(result);
                if (!target)
                    return;

                const { data } = this._readHistory(settings);
                const payload = JSON.stringify({
                    version: 2,
                    exported: new Date().toISOString(),
                    items: data.items || [],
                    lists: data.lists || [],
                }, null, 2);

                target.replace_contents(
                    new TextEncoder().encode(payload), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);

                this._showMessage(window, _('Export finished'),
                    _('%d item(s) were written.').replace('%d', String((data.items || []).length)));
            } catch (e) {
                this._reportDialogError(e, 'export');
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this._showMessage(window, _('Export failed'), e.message);
            }
        });
    }

    _importData(window, settings) {
        const dialog = new Gtk.FileDialog({ title: _('Import a clipboard history') });

        dialog.open(window, null, (fileDialog, result) => {
            try {
                const source = fileDialog.open_finish(result);
                if (!source)
                    return;

                const [ok, contents] = source.load_contents(null);
                if (!ok)
                    throw new Error(_('The chosen file could not be read.'));

                const incoming = JSON.parse(new TextDecoder().decode(contents));
                if (!Array.isArray(incoming.items))
                    throw new Error(_('That file does not look like a ClipMaster export.'));

                const { path, data } = this._readHistoryOrEmpty(settings);
                const existing = new Set((data.items || []).map(item => item.contentHash || item.hash));

                let nextId = Math.max(data.nextId || 1, ...(data.items || []).map(item => (item.id || 0) + 1));
                let added = 0;

                for (const item of incoming.items) {
                    const hash = item.contentHash || item.hash;
                    if (hash && existing.has(hash))
                        continue;

                    data.items.push({ ...item, id: nextId++ });
                    if (hash)
                        existing.add(hash);
                    added++;
                }

                data.nextId = nextId;
                this._writeHistory(settings, path, data);

                this._showMessage(window, _('Import finished'),
                    _('%d new item(s) were added.').replace('%d', String(added)));
            } catch (e) {
                this._reportDialogError(e, 'import');
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this._showMessage(window, _('Import failed'), e.message);
            }
        });
    }

    /**
     * Returns an empty history only when there is no file at all. A file that
     * exists but cannot be read is an error, never an empty history: treating
     * it as empty would make an import replace a history that is still there.
     */
    _readHistoryOrEmpty(settings) {
        const path = this._storagePath(settings);

        if (!Gio.File.new_for_path(path).query_exists(null))
            return { path, data: { items: [], lists: [], nextId: 1 } };

        const result = this._readHistory(settings);
        result.data.items = Array.isArray(result.data.items) ? result.data.items : [];
        result.data.lists = Array.isArray(result.data.lists) ? result.data.lists : [];
        return result;
    }

    _confirmClear(window, settings) {
        const dialog = new Adw.AlertDialog({
            heading: _('Clear the clipboard history?'),
            body: _('Everything except favourites and pinned items will be deleted. This cannot be undone.'),
        });

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('clear', _('Clear'));
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);

        dialog.connect('response', (_dialog, response) => {
            if (response !== 'clear')
                return;

            try {
                const { path, data } = this._readHistory(settings);
                const before = (data.items || []).length;

                data.items = (data.items || []).filter(item => item && (item.isFavorite || item.isPinned));
                this._writeHistory(settings, path, data);

                this._showMessage(window, _('History cleared'),
                    _('%d item(s) were removed.').replace('%d', String(before - data.items.length)));
            } catch (e) {
                this._showMessage(window, _('Could not clear the history'), e.message);
            }
        });

        dialog.present(window);
    }

    _showMessage(window, heading, body) {
        const dialog = new Adw.AlertDialog({ heading, body });
        dialog.add_response('ok', _('OK'));
        dialog.present(window);
    }
}
