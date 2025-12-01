/**
 * ClipMaster Preferences
 * Settings panel for the ClipMaster GNOME Shell Extension
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class ClipMasterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        // General Page
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        window.add(generalPage);
        
        // History Group
        const historyGroup = new Adw.PreferencesGroup({
            title: _('Clipboard History'),
            description: _('Configure clipboard history behavior')
        });
        generalPage.add(historyGroup);
        
        // History size
        const historySizeRow = new Adw.SpinRow({
            title: _('History Size'),
            subtitle: _('Maximum number of items to keep'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 5000,
                step_increment: 10,
                page_increment: 100
            })
        });
        settings.bind('history-size', historySizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(historySizeRow);
        
        // Preview length
        const previewLengthRow = new Adw.SpinRow({
            title: _('Preview Length'),
            subtitle: _('Maximum characters to show in preview'),
            adjustment: new Gtk.Adjustment({
                lower: 20,
                upper: 500,
                step_increment: 10,
                page_increment: 50
            })
        });
        settings.bind('preview-length', previewLengthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(previewLengthRow);
        
        // Items per page
        const itemsPerPageRow = new Adw.SpinRow({
            title: _('Items Per Page'),
            subtitle: _('Number of items to show in popup'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 50,
                step_increment: 1,
                page_increment: 5
            })
        });
        settings.bind('items-per-page', itemsPerPageRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(itemsPerPageRow);
        
        // Skip duplicates
        const skipDuplicatesRow = new Adw.SwitchRow({
            title: _('Skip Duplicate Items'),
            subtitle: _('Don\'t add same content to history again')
        });
        settings.bind('skip-duplicates', skipDuplicatesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        historyGroup.add(skipDuplicatesRow);
        
        // Content Types Group
        const contentGroup = new Adw.PreferencesGroup({
            title: _('Content Types'),
            description: _('What to track in clipboard')
        });
        generalPage.add(contentGroup);
        
        // Track images
        const trackImagesRow = new Adw.SwitchRow({
            title: _('Track Images'),
            subtitle: _('Store images in clipboard history')
        });
        settings.bind('track-images', trackImagesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        contentGroup.add(trackImagesRow);
        
        // Track files
        const trackFilesRow = new Adw.SwitchRow({
            title: _('Track Files'),
            subtitle: _('Store file copies in clipboard history')
        });
        settings.bind('track-files', trackFilesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        contentGroup.add(trackFilesRow);
        
        // Track primary selection
        const trackPrimaryRow = new Adw.SwitchRow({
            title: _('Track Primary Selection'),
            subtitle: _('Track PRIMARY selection (middle mouse button). When enabled, tracks both CLIPBOARD and PRIMARY. When disabled, only tracks CLIPBOARD (Ctrl+C/V).')
        });
        settings.bind('track-primary-selection', trackPrimaryRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        contentGroup.add(trackPrimaryRow);
        
        // Strip whitespace
        const stripWhitespaceRow = new Adw.SwitchRow({
            title: _('Strip Whitespace'),
            subtitle: _('Remove leading/trailing whitespace from text')
        });
        settings.bind('strip-whitespace', stripWhitespaceRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        contentGroup.add(stripWhitespaceRow);
        
        // Behavior Page
        const behaviorPage = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'preferences-other-symbolic'
        });
        window.add(behaviorPage);
        
        // Popup Behavior Group
        const popupGroup = new Adw.PreferencesGroup({
            title: _('Popup Window'),
            description: _('Configure popup behavior')
        });
        behaviorPage.add(popupGroup);
        
        // Popup at cursor
        const popupAtCursorRow = new Adw.SwitchRow({
            title: _('Show at Cursor Position'),
            subtitle: _('Open popup where the mouse is')
        });
        settings.bind('popup-at-cursor', popupAtCursorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        popupGroup.add(popupAtCursorRow);
        
        // Paste on select
        const pasteOnSelectRow = new Adw.SwitchRow({
            title: _('Paste on Selection'),
            subtitle: _('Automatically paste when selecting an item')
        });
        settings.bind('paste-on-select', pasteOnSelectRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        popupGroup.add(pasteOnSelectRow);
        
        // Close on paste
        const closeOnPasteRow = new Adw.SwitchRow({
            title: _('Close After Paste'),
            subtitle: _('Close popup after pasting an item')
        });
        settings.bind('close-on-paste', closeOnPasteRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        popupGroup.add(closeOnPasteRow);
        
        // Notifications
        const notificationRow = new Adw.SwitchRow({
            title: _('Show Notifications'),
            subtitle: _('Notify when new items are copied')
        });
        settings.bind('show-notification', notificationRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        popupGroup.add(notificationRow);
        
        // Popup Size Group
        const sizeGroup = new Adw.PreferencesGroup({
            title: _('Popup Size'),
            description: _('Customize popup window dimensions')
        });
        behaviorPage.add(sizeGroup);
        
        // Popup width
        const popupWidthRow = new Adw.SpinRow({
            title: _('Popup Width'),
            subtitle: _('Width in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 300,
                upper: 800,
                step_increment: 10,
                page_increment: 50
            })
        });
        settings.bind('popup-width', popupWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        sizeGroup.add(popupWidthRow);
        
        // Popup height
        const popupHeightRow = new Adw.SpinRow({
            title: _('Popup Height'),
            subtitle: _('Height in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 300,
                upper: 900,
                step_increment: 10,
                page_increment: 50
            })
        });
        settings.bind('popup-height', popupHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        sizeGroup.add(popupHeightRow);
        
        // Appearance Group
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Visual settings')
        });
        behaviorPage.add(appearanceGroup);
        
        // Theme selection
        const themeRow = new Adw.ComboRow({
            title: _('Theme'),
            subtitle: _('Choose a visual theme for the popup')
        });
        const themeModel = new Gtk.StringList();
        themeModel.append('Catppuccin');
        themeModel.append('Dracula');
        themeModel.append('Nord');
        themeModel.append('Gruvbox');
        themeModel.append('One Dark');
        themeModel.append('Adwaita');
        themeModel.append('Monokai');
        themeModel.append('Solarized Dark');
        themeModel.append('Tokyo Night');
        themeModel.append('Rose Pine');
        themeModel.append('Material Dark');
        themeModel.append('Ayu');
        themeRow.model = themeModel;
        
        // Bind theme setting (convert between display name and internal name)
        const themeMap = {
            'catppuccin': 0,
            'dracula': 1,
            'nord': 2,
            'gruvbox': 3,
            'onedark': 4,
            'adwaita': 5,
            'monokai': 6,
            'solarized': 7,
            'tokyonight': 8,
            'rosepine': 9,
            'material': 10,
            'ayu': 11
        };
        const reverseThemeMap = ['catppuccin', 'dracula', 'nord', 'gruvbox', 'onedark', 'adwaita', 'monokai', 'solarized', 'tokyonight', 'rosepine', 'material', 'ayu'];
        
        // Set initial selection
        const currentTheme = settings.get_string('theme') || 'gruvbox';
        themeRow.selected = themeMap[currentTheme] !== undefined ? themeMap[currentTheme] : themeMap['gruvbox'];
        
        // Connect change handler
        themeRow.connect('notify::selected', () => {
            const selectedIndex = themeRow.selected;
            const themeValue = reverseThemeMap[selectedIndex] || 'gruvbox';
            settings.set_string('theme', themeValue);
        });
        
        appearanceGroup.add(themeRow);
        
        // Custom theme file selector
        const customThemeRow = new Adw.ActionRow({
            title: _('Custom Theme'),
            subtitle: _('Load a custom CSS theme file')
        });
        
        const customThemeButton = new Gtk.Button({
            label: _('Select CSS File'),
            valign: Gtk.Align.CENTER
        });
        
        const currentCustomTheme = settings.get_string('custom-theme-path') || '';
        if (currentCustomTheme) {
            customThemeRow.subtitle = currentCustomTheme;
        }
        
        customThemeButton.connect('clicked', () => {
            const fileDialog = new Gtk.FileDialog();
            fileDialog.set_title(_('Select Custom Theme CSS File'));
            
            // Create filter for CSS files
            const filter = new Gtk.FileFilter();
            filter.set_name(_('CSS Files'));
            filter.add_pattern('*.css');
            fileDialog.set_default_filter(filter);
            
            fileDialog.open(null, null, (dialog, result) => {
                try {
                    const file = dialog.open_finish(result);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('custom-theme-path', path);
                        customThemeRow.subtitle = path;
                    }
                } catch (e) {
                    // User cancelled
                }
            });
        });
        
        customThemeRow.add_suffix(customThemeButton);
        customThemeRow.activatable_widget = customThemeButton;
        appearanceGroup.add(customThemeRow);
        
        // Clear custom theme button
        if (currentCustomTheme) {
            const clearThemeButton = new Gtk.Button({
                label: _('Clear Custom Theme'),
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action']
            });
            
            clearThemeButton.connect('clicked', () => {
                settings.set_string('custom-theme-path', '');
                customThemeRow.subtitle = _('Load a custom CSS theme file');
            });
            
            const clearThemeRow = new Adw.ActionRow({
                title: _('Clear Custom Theme'),
                subtitle: _('Remove custom theme and use built-in theme')
            });
            clearThemeRow.add_suffix(clearThemeButton);
            clearThemeRow.activatable_widget = clearThemeButton;
            appearanceGroup.add(clearThemeRow);
        }
        
        // Dark theme toggle (for backward compatibility)
        const darkThemeRow = new Adw.SwitchRow({
            title: _('Dark Theme'),
            subtitle: _('Use dark theme (disable for light theme)')
        });
        settings.bind('dark-theme', darkThemeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(darkThemeRow);
        
        // Panel Indicator Group
        const indicatorGroup = new Adw.PreferencesGroup({
            title: _('Panel Indicator'),
            description: _('Configure the panel indicator')
        });
        behaviorPage.add(indicatorGroup);
        
        // Show indicator
        const showIndicatorRow = new Adw.SwitchRow({
            title: _('Show Panel Indicator'),
            subtitle: _('Display ClipMaster icon in the panel')
        });
        settings.bind('show-indicator', showIndicatorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        indicatorGroup.add(showIndicatorRow);
        
        // Shortcuts Page
        const shortcutsPage = new Adw.PreferencesPage({
            title: _('Shortcuts'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'
        });
        window.add(shortcutsPage);
        
        // Keyboard Shortcuts Group
        const shortcutsGroup = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcuts'),
            description: _('Configure global keyboard shortcuts')
        });
        shortcutsPage.add(shortcutsGroup);
        
        // Toggle popup shortcut
        const togglePopupRow = this._createShortcutRow(
            settings,
            'toggle-popup',
            _('Show/Hide Popup'),
            _('Keyboard shortcut to toggle clipboard popup')
        );
        shortcutsGroup.add(togglePopupRow);
        
        // Paste as plain shortcut
        const pastePlainRow = this._createShortcutRow(
            settings,
            'paste-as-plain',
            _('Paste as Plain Text'),
            _('Paste clipboard content without formatting')
        );
        shortcutsGroup.add(pastePlainRow);
        
        // Storage Page
        const storagePage = new Adw.PreferencesPage({
            title: _('Storage'),
            icon_name: 'drive-harddisk-symbolic'
        });
        window.add(storagePage);
        
        // Storage Group
        const storageGroup = new Adw.PreferencesGroup({
            title: _('Database Location'),
            description: _('Where to store clipboard data')
        });
        storagePage.add(storageGroup);
        
        // Use custom storage switch
        const currentPath = settings.get_string('storage-path');
        const useCustomRow = new Adw.SwitchRow({
            title: _('Use Custom Storage Location'),
            subtitle: _('Store clipboard data in a custom directory'),
            active: currentPath !== ''
        });
        storageGroup.add(useCustomRow);
        
        // Custom storage path with browse button
        const storagePathRow = new Adw.ActionRow({
            title: _('Custom Storage Directory'),
            subtitle: currentPath || _('Click Browse to select a directory')
        });
        
        const browseButton = new Gtk.Button({
            label: _('Browse'),
            valign: Gtk.Align.CENTER
        });
        browseButton.connect('clicked', () => {
            this._browseStorageDirectory(window, settings, storagePathRow, useCustomRow);
        });
        storagePathRow.add_suffix(browseButton);
        
        const clearPathButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Clear custom path')
        });
        clearPathButton.connect('clicked', () => {
            settings.set_string('storage-path', '');
            storagePathRow.subtitle = _('Click Browse to select a directory');
            useCustomRow.active = false;
        });
        storagePathRow.add_suffix(clearPathButton);
        
        storageGroup.add(storagePathRow);
        
        // Update sensitivity based on toggle
        storagePathRow.sensitive = useCustomRow.active;
        useCustomRow.connect('notify::active', () => {
            storagePathRow.sensitive = useCustomRow.active;
            if (!useCustomRow.active) {
                settings.set_string('storage-path', '');
                storagePathRow.subtitle = _('Click Browse to select a directory');
            }
        });
        
        // Default path info
        const defaultPath = GLib.build_filenamev([
            GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json'
        ]);
        const defaultPathRow = new Adw.ActionRow({
            title: _('Default Location'),
            subtitle: defaultPath
        });
        const defaultBadge = new Gtk.Label({
            label: currentPath === '' ? '✓ Active' : '',
            css_classes: ['success'],
            valign: Gtk.Align.CENTER
        });
        defaultPathRow.add_suffix(defaultBadge);
        storageGroup.add(defaultPathRow);
        
        // Update default badge when custom path changes
        useCustomRow.connect('notify::active', () => {
            defaultBadge.label = useCustomRow.active ? '' : '✓ Active';
        });
        
        // Security Group
        const securityGroup = new Adw.PreferencesGroup({
            title: _('Security'),
            description: _('Protect your clipboard data')
        });
        storagePage.add(securityGroup);
        
        // Encrypt database
        const encryptRow = new Adw.SwitchRow({
            title: _('Encrypt Database'),
            subtitle: _('Encrypt clipboard history for security (AES-256)')
        });
        settings.bind('encrypt-database', encryptRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        securityGroup.add(encryptRow);
        
        // Encryption status
        const encryptionKey = settings.get_string('encryption-key');
        const encryptStatusRow = new Adw.ActionRow({
            title: _('Encryption Status'),
            subtitle: encryptionKey ? _('🔒 Encrypted with unique key') : _('🔓 Not encrypted')
        });
        securityGroup.add(encryptStatusRow);
        
        // Update status when encryption changes
        encryptRow.connect('notify::active', () => {
            if (encryptRow.active) {
                encryptStatusRow.subtitle = _('🔒 Encryption will be enabled on next restart');
            } else {
                encryptStatusRow.subtitle = _('🔓 Not encrypted');
            }
        });
        
        // Size Limits Group
        const limitsGroup = new Adw.PreferencesGroup({
            title: _('Size Limits'),
            description: _('Maximum sizes for clipboard items')
        });
        storagePage.add(limitsGroup);
        
        // Max item size (MB)
        const maxItemSizeRow = new Adw.SpinRow({
            title: _('Maximum Item Size (MB)'),
            subtitle: _('Maximum size of a single text item'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
                page_increment: 1
            })
        });
        settings.bind('max-item-size-mb', maxItemSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        limitsGroup.add(maxItemSizeRow);
        
        // Max image size (MB)
        const maxImageSizeRow = new Adw.SpinRow({
            title: _('Maximum Image Size (MB)'),
            subtitle: _('Maximum size of images to store'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 50,
                step_increment: 1,
                page_increment: 5
            })
        });
        settings.bind('max-image-size-mb', maxImageSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        limitsGroup.add(maxImageSizeRow);
        
        // Max total database size (MB) - clipboard.json max size
        const maxDbSizeRow = new Adw.SpinRow({
            title: _('Maximum Database Size (MB)'),
            subtitle: _('Maximum total size of clipboard.json file'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 500,
                step_increment: 10,
                page_increment: 50
            })
        });
        settings.bind('max-db-size-mb', maxDbSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        limitsGroup.add(maxDbSizeRow);
        
        // Data Management Group
        const dataGroup = new Adw.PreferencesGroup({
            title: _('Data Management'),
            description: _('Export, import, or clear clipboard data')
        });
        storagePage.add(dataGroup);
        
        // Export button
        const exportRow = new Adw.ActionRow({
            title: _('Export Data'),
            subtitle: _('Save clipboard history to a file')
        });
        const exportButton = new Gtk.Button({
            label: _('Export'),
            valign: Gtk.Align.CENTER
        });
        exportButton.connect('clicked', () => {
            this._exportData(window, settings);
        });
        exportRow.add_suffix(exportButton);
        dataGroup.add(exportRow);
        
        // Import button
        const importRow = new Adw.ActionRow({
            title: _('Import Data'),
            subtitle: _('Load clipboard history from a file')
        });
        const importButton = new Gtk.Button({
            label: _('Import'),
            valign: Gtk.Align.CENTER
        });
        importButton.connect('clicked', () => {
            this._importData(window, settings);
        });
        importRow.add_suffix(importButton);
        dataGroup.add(importRow);
        
        // Clear history button
        const clearRow = new Adw.ActionRow({
            title: _('Clear History'),
            subtitle: _('Delete all non-favorite items')
        });
        const clearButton = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });
        clearButton.connect('clicked', () => {
            this._confirmClear(window, settings);
        });
        clearRow.add_suffix(clearButton);
        dataGroup.add(clearRow);
        
        // Excluded Apps Page
        const excludedPage = new Adw.PreferencesPage({
            title: _('Excluded Apps'),
            icon_name: 'action-unavailable-symbolic'
        });
        window.add(excludedPage);
        
        // Excluded Apps Group
        const excludedGroup = new Adw.PreferencesGroup({
            title: _('Excluded Applications'),
            description: _('Applications to ignore when copying')
        });
        excludedPage.add(excludedGroup);
        
        // Add app button
        const addAppRow = new Adw.ActionRow({
            title: _('Add Application'),
            subtitle: _('Add an app to the exclusion list')
        });
        const addAppButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER
        });
        addAppButton.connect('clicked', () => {
            this._showAddAppDialog(window, settings, excludedGroup);
        });
        addAppRow.add_suffix(addAppButton);
        excludedGroup.add(addAppRow);
        
        // Load existing excluded apps
        this._loadExcludedApps(settings, excludedGroup);
        
        // About Page
        const aboutPage = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic'
        });
        window.add(aboutPage);
        
        // About Group
        const aboutGroup = new Adw.PreferencesGroup();
        aboutPage.add(aboutGroup);
        
        const aboutRow = new Adw.ActionRow({
            title: 'ClipMaster',
            subtitle: _('A powerful clipboard manager for GNOME\nInspired by Copy \'Em for Mac')
        });
        aboutGroup.add(aboutRow);
        
        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: '1.1.0'
        });
        aboutGroup.add(versionRow);
        
        const featuresRow = new Adw.ActionRow({
            title: _('Features'),
            subtitle: _('✓ Encryption ✓ Image Support ✓ Custom Themes ✓ Adjustable Size')
        });
        aboutGroup.add(featuresRow);
        
        // Debug Group
        const debugGroup = new Adw.PreferencesGroup({
            title: _('Troubleshooting'),
            description: _('Debug options for troubleshooting issues')
        });
        aboutPage.add(debugGroup);
        
        const debugModeRow = new Adw.SwitchRow({
            title: _('Debug Mode'),
            subtitle: _('Enable debug logging. View logs with:\njournalctl -f /usr/bin/gnome-shell | grep ClipMaster')
        });
        settings.bind('debug-mode', debugModeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        debugGroup.add(debugModeRow);
        
        const logInfoRow = new Adw.ActionRow({
            title: _('Log Location'),
            subtitle: _('journalctl -f /usr/bin/gnome-shell')
        });
        debugGroup.add(logInfoRow);
    }
    
    _browseStorageDirectory(window, settings, pathRow, useCustomRow) {
        const dialog = new Gtk.FileDialog({
            title: _('Select Storage Directory')
        });
        
        dialog.select_folder(window, null, (dialog, result) => {
            try {
                const folder = dialog.select_folder_finish(result);
                if (folder) {
                    const path = folder.get_path();
                    // Store directory path - extension will create clipboard.json inside
                    const fullPath = GLib.build_filenamev([path, 'clipboard.json']);
                    settings.set_string('storage-path', fullPath);
                    pathRow.subtitle = path;
                    useCustomRow.active = true;
                }
            } catch (e) {
                // User cancelled or error
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                    log(`ClipMaster: Browse error: ${e.message}`);
                }
            }
        });
    }
    
    _createShortcutRow(settings, key, title, subtitle) {
        const row = new Adw.ActionRow({
            title: title,
            subtitle: subtitle
        });
        
        const shortcuts = settings.get_strv(key);
        const label = new Gtk.Label({
            label: shortcuts.length > 0 ? shortcuts[0] : _('Disabled'),
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER
        });
        row.add_suffix(label);
        
        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER
        });
        editButton.connect('clicked', () => {
            // Simple dialog to change shortcut
            const dialog = new Gtk.MessageDialog({
                transient_for: row.get_root(),
                modal: true,
                message_type: Gtk.MessageType.QUESTION,
                buttons: Gtk.ButtonsType.OK_CANCEL,
                text: _('Enter new shortcut'),
                secondary_text: _('Example: <Super>v, <Ctrl><Shift>v')
            });
            
            const entry = new Gtk.Entry({
                text: shortcuts.length > 0 ? shortcuts[0] : '',
                margin_top: 10,
                margin_bottom: 10,
                margin_start: 10,
                margin_end: 10
            });
            dialog.get_content_area().append(entry);
            
            dialog.connect('response', (dialog, response) => {
                if (response === Gtk.ResponseType.OK) {
                    const newShortcut = entry.get_text();
                    if (newShortcut) {
                        settings.set_strv(key, [newShortcut]);
                        label.set_label(newShortcut);
                    }
                }
                dialog.destroy();
            });
            
            dialog.show();
        });
        row.add_suffix(editButton);
        
        return row;
    }
    
    _exportData(window, settings) {
        const dialog = new Gtk.FileDialog({
            title: _('Export Clipboard Data'),
            initial_name: 'clipmaster_export.json'
        });
        
        dialog.save(window, null, (dialog, result) => {
            try {
                const file = dialog.save_finish(result);
                if (file) {
                    // Read and export database
                    const storagePath = settings.get_string('storage-path') || 
                        GLib.build_filenamev([GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json']);
                    
                    const sourceFile = Gio.File.new_for_path(storagePath);
                    if (sourceFile.query_exists(null)) {
                        sourceFile.copy(file, Gio.FileCopyFlags.OVERWRITE, null, null);
                    }
                }
            } catch (e) {
                log(`ClipMaster: Export error: ${e.message}`);
            }
        });
    }
    
    _importData(window, settings) {
        const dialog = new Gtk.FileDialog({
            title: _('Import Clipboard Data')
        });
        
        const filter = new Gtk.FileFilter();
        filter.set_name(_('JSON files'));
        filter.add_pattern('*.json');
        
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        dialog.set_filters(filters);
        
        dialog.open(window, null, (dialog, result) => {
            try {
                const file = dialog.open_finish(result);
                if (file) {
                    // Import to database
                    const storagePath = settings.get_string('storage-path') || 
                        GLib.build_filenamev([GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json']);
                    
                    const destFile = Gio.File.new_for_path(storagePath);
                    const dir = GLib.path_get_dirname(storagePath);
                    GLib.mkdir_with_parents(dir, 0o755);
                    
                    file.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                }
            } catch (e) {
                log(`ClipMaster: Import error: ${e.message}`);
            }
        });
    }
    
    _confirmClear(window, settings) {
        const dialog = new Adw.AlertDialog({
            heading: _('Clear Clipboard History?'),
            body: _('This will delete all non-favorite items. This action cannot be undone.')
        });
        
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('clear', _('Clear'));
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        
        dialog.connect('response', (dialog, response) => {
            if (response === 'clear') {
                try {
                    // Direct file manipulation (prefs window runs in separate process)
                    const storagePath = settings.get_string('storage-path') || 
                        GLib.build_filenamev([GLib.get_user_data_dir(), 'clipmaster', 'clipboard.json']);
                    
                    const file = Gio.File.new_for_path(storagePath);
                    if (!file.query_exists(null)) {
                        throw new Error(_('Database file not found'));
                    }
                    
                    const [success, contents] = file.load_contents(null);
                    if (!success) {
                        throw new Error(_('Failed to read database file'));
                    }
                    
                    // Check if file is empty or invalid
                    const contentStr = new TextDecoder().decode(contents);
                    if (!contentStr || contentStr.trim() === '') {
                        throw new Error(_('Database file is empty'));
                    }
                    
                    let data;
                    try {
                        data = JSON.parse(contentStr);
                    } catch (parseError) {
                        log(`ClipMaster: JSON parse error: ${parseError.message}, content: ${contentStr.substring(0, 100)}`);
                        throw new Error(_('Invalid JSON in database file. File may be corrupted.'));
                    }
                    
                    // Ensure data structure exists
                    if (!data || typeof data !== 'object') {
                        data = { items: [] };
                    }
                    if (!Array.isArray(data.items)) {
                        data.items = [];
                    }
                    
                    const beforeCount = data.items.length;
                    data.items = data.items.filter(i => i && i.isFavorite);
                    const afterCount = data.items.length;
                    const removedCount = beforeCount - afterCount;
                    
                    const encoder = new TextEncoder();
                    const jsonStr = JSON.stringify(data, null, 2);
                    file.replace_contents(
                        encoder.encode(jsonStr),
                        null, false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION,
                        null
                    );
                    
                    // Show success message
                    const successDialog = new Adw.MessageDialog({
                        heading: _('History Cleared'),
                        body: _(`Removed ${removedCount} item(s). Please reload the extension (disable and enable) for changes to take effect.`),
                        transient_for: window
                    });
                    successDialog.add_response('ok', _('OK'));
                    successDialog.present(window);
                } catch (e) {
                    log(`ClipMaster: Clear error: ${e.message}`);
                    const errorDialog = new Adw.MessageDialog({
                        heading: _('Error'),
                        body: _('Error clearing history: ') + e.message,
                        transient_for: window
                    });
                    errorDialog.add_response('ok', _('OK'));
                    errorDialog.present(window);
                }
            }
        });
        
        dialog.present(window);
    }
    
    _loadExcludedApps(settings, group) {
        const apps = settings.get_strv('excluded-apps');
        
        apps.forEach(app => {
            const row = new Adw.ActionRow({
                title: app
            });
            
            const removeButton = new Gtk.Button({
                icon_name: 'edit-delete-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat']
            });
            removeButton.connect('clicked', () => {
                const current = settings.get_strv('excluded-apps');
                const updated = current.filter(a => a !== app);
                settings.set_strv('excluded-apps', updated);
                group.remove(row);
            });
            row.add_suffix(removeButton);
            
            group.add(row);
        });
    }
    
    _showAddAppDialog(window, settings, group) {
        const dialog = new Adw.AlertDialog({
            heading: _('Add Excluded Application'),
            body: _('Enter the application name to exclude')
        });
        
        const entry = new Gtk.Entry({
            placeholder_text: _('e.g., 1Password, KeePassXC'),
            margin_top: 10
        });
        dialog.set_extra_child(entry);
        
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('add', _('Add'));
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
        
        dialog.connect('response', (dialog, response) => {
            if (response === 'add') {
                const appName = entry.get_text().trim();
                if (appName) {
                    const current = settings.get_strv('excluded-apps');
                    if (!current.includes(appName)) {
                        current.push(appName);
                        settings.set_strv('excluded-apps', current);
                        
                        // Add row to UI
                        const row = new Adw.ActionRow({
                            title: appName
                        });
                        
                        const removeButton = new Gtk.Button({
                            icon_name: 'edit-delete-symbolic',
                            valign: Gtk.Align.CENTER,
                            css_classes: ['flat']
                        });
                        removeButton.connect('clicked', () => {
                            const apps = settings.get_strv('excluded-apps');
                            const updated = apps.filter(a => a !== appName);
                            settings.set_strv('excluded-apps', updated);
                            group.remove(row);
                        });
                        row.add_suffix(removeButton);
                        
                        group.add(row);
                    }
                }
            }
        });
        
        dialog.present(window);
    }
}
