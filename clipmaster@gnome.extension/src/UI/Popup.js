/*
 * ClipMaster - Popup UI
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SignalManager, TimeoutManager, ValidationUtils } from '../Util/Utils.js';
import { ItemType, debugLog, reportError, reportWarning } from '../Util/Constants.js';
import { QrCodeGenerator, QrEcc } from '../Util/QrCodeGenerator.js';

const THEME_NAMES = [
    'adwaita', 'catppuccin', 'dracula', 'nord', 'gruvbox', 'onedark',
    'monokai', 'solarized', 'tokyonight', 'rosepine', 'material', 'ayu',
];

const DRAG_THROTTLE_MS = 16;
const HOVER_PASTE_DELAY_MS = 500;
const CLICK_OUTSIDE_SETUP_MS = 100;
const MIN_POPUP_SIZE = 280;
const QR_PIXEL_SIZE = 220;

/**
 * `St.BoxLayout.vertical` was removed in GNOME 51 and `orientation` does not
 * exist before GNOME 48, so the property is chosen from what the running shell
 * actually has.
 */
const HAS_ORIENTATION = 'orientation' in St.BoxLayout.prototype;

function orientationProps(vertical) {
    if (HAS_ORIENTATION) {
        return {
            orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        };
    }
    return { vertical };
}

export const ClipboardPopup = GObject.registerClass(
class ClipboardPopup extends St.BoxLayout {
    _init(extension) {
        super._init({
            style_class: 'clipmaster-popup',
            reactive: true,
            can_focus: true,
            track_hover: true,
            visible: false,
            opacity: 0,
            ...orientationProps(true),
        });

        this._extension = extension;
        this._settings = extension.settings;
        this._database = extension.database;

        this._selectedIndex = 0;
        this._items = [];
        this._searchQuery = '';
        this._currentListId = null;
        this._currentType = null;
        this._plainTextMode = false;
        this._isPinned = false;
        this._isShowing = false;
        this._showTime = 0;
        this._pasteFromHover = false;
        this._customStylesheet = null;
        this._pinnedListButtons = [];
        this._openMenus = new Set();

        this._dragging = false;
        this._resizing = false;

        this._signalManager = new SignalManager();
        this._timeoutManager = new TimeoutManager();

        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

        this._buildUI();
        this._applyTheme();

        for (const key of ['dark-theme', 'theme', 'custom-theme-path', 'follow-system-theme']) {
            this._signalManager.connect(
                this._settings, `changed::${key}`, () => this._applyTheme(), `theme-${key}`);
        }
        this._signalManager.connect(
            this._interfaceSettings, 'changed::color-scheme', () => this._applyTheme(), 'system-color-scheme');
        this._signalManager.connect(
            this._settings, 'changed::private-mode', () => this._updatePrivateModeBanner(), 'private-mode');

        this.connect('key-press-event', (actor, event) => this._onKeyPress(actor, event));
    }

    get isShowing() {
        return this._isShowing;
    }

    get isPinned() {
        return this._isPinned;
    }

    _applyTheme() {
        this.remove_style_class_name('light');
        for (const name of THEME_NAMES)
            this.remove_style_class_name(`theme-${name}`);

        const followSystem = this._settings.get_boolean('follow-system-theme');
        const customThemePath = this._settings.get_string('custom-theme-path');

        this._unloadCustomStylesheet();

        if (!followSystem && customThemePath) {
            const customFile = Gio.File.new_for_path(customThemePath);
            if (customFile.query_exists(null)) {
                try {
                    St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(customFile);
                    this._customStylesheet = customFile;
                    return;
                } catch (e) {
                    reportError(`could not load the custom theme: ${e.message}`);
                }
            }
        }

        let isDark = this._settings.get_boolean('dark-theme');
        if (followSystem) {
            isDark = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
            this.add_style_class_name('theme-adwaita');
        } else {
            const themeName = this._settings.get_string('theme');
            this.add_style_class_name(`theme-${THEME_NAMES.includes(themeName) ? themeName : 'adwaita'}`);
        }

        if (!isDark)
            this.add_style_class_name('light');
    }

    _unloadCustomStylesheet() {
        if (!this._customStylesheet)
            return;

        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._customStylesheet);
        } catch (e) {
            reportWarning(`could not unload the custom theme: ${e.message}`);
        }
        this._customStylesheet = null;
    }

    _buildUI() {
        this._buildHeader();
        this._buildPrivateModeBanner();
        this._buildSearch();
        this._buildFilterBar();
        this._buildItemList();
        this._buildFooter();
    }

    _buildHeader() {
        this._header = new St.BoxLayout({
            style_class: 'clipmaster-header',
            x_expand: true,
            reactive: true,
            ...orientationProps(false),
        });

        this._header.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extension.path}/assets/icons/clipmaster-symbolic.svg`),
            style_class: 'clipmaster-header-icon',
            icon_size: 18,
        }));

        this._header.add_child(new St.Label({
            text: 'ClipMaster',
            style_class: 'clipmaster-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        }));

        this._tooltip = new St.Label({ style_class: 'clipmaster-tooltip', visible: false });
        Main.uiGroup.add_child(this._tooltip);

        this._plainTextButton = this._addHeaderButton(
            'text-x-generic-symbolic', _('Paste as plain text'), () => this._togglePlainTextMode());
        this._privateButton = this._addHeaderButton(
            'view-conceal-symbolic', _('Private mode: stop recording'), () => this._extension.togglePrivateMode());
        this._pinButton = this._addHeaderButton(
            'view-pin-symbolic', _('Keep the popup open'), () => this._togglePin());
        this._addListButton = this._addHeaderButton(
            'list-add-symbolic', _('Create a new list'), () => this._showCreateListDialog());
        this._closeButton = this._addHeaderButton(
            'window-close-symbolic', _('Close'), () => this._extension.hidePopup(), 'clipmaster-close-button');

        this._header.connect('button-press-event', (actor, event) => this._onHeaderPress(event));
        this.add_child(this._header);
    }

    _addHeaderButton(iconName, tooltip, onClick, styleClass = 'clipmaster-toggle-button') {
        const button = new St.Button({
            style_class: styleClass,
            child: new St.Icon({ icon_name: iconName, icon_size: 16 }),
            can_focus: false,
            track_hover: true,
        });

        button._tooltipText = tooltip;
        button.connect('notify::hover', () => this._onButtonHover(button));
        button.connect('clicked', () => onClick());

        this._header.add_child(button);
        return button;
    }

    _onHeaderPress(event) {
        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        // A press that landed on one of the header buttons belongs to it, not
        // to the window drag.
        for (let actor = event.get_source(); actor && actor !== this._header; actor = actor.get_parent()) {
            if (actor instanceof St.Button)
                return Clutter.EVENT_PROPAGATE;
        }

        this._startDrag(event);
        return Clutter.EVENT_STOP;
    }

    _buildPrivateModeBanner() {
        this._privateBanner = new St.Label({
            text: _('Private mode is on. New copies are not being recorded.'),
            style_class: 'clipmaster-private-banner',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._privateBanner.clutter_text.set_line_wrap(true);
        this.add_child(this._privateBanner);
    }

    _updatePrivateModeBanner() {
        const enabled = this._settings.get_boolean('private-mode');

        this._privateBanner.visible = enabled;
        if (enabled)
            this._privateButton.add_style_pseudo_class('checked');
        else
            this._privateButton.remove_style_pseudo_class('checked');
    }

    _buildSearch() {
        this._searchEntry = new St.Entry({
            style_class: 'clipmaster-search',
            hint_text: _('Search the history'),
            can_focus: true,
            x_expand: true,
        });

        this._searchEntry.clutter_text.connect('text-changed', () => {
            this._searchQuery = this._searchEntry.get_text();
            this._selectedIndex = 0;
            this._loadItems();
        });
        this._searchEntry.clutter_text.connect('activate', () => {
            this._pasteSelected();
            return Clutter.EVENT_STOP;
        });

        this.add_child(this._searchEntry);
    }

    _buildFilterBar() {
        this._filterBar = new St.BoxLayout({
            style_class: 'clipmaster-filter-bar',
            x_expand: true,
            ...orientationProps(false),
        });

        const addFilter = (props, onClick) => {
            const button = new St.Button({ style_class: 'clipmaster-filter-button', can_focus: false, ...props });
            button.connect('clicked', () => onClick());
            this._filterBar.add_child(button);
            return button;
        };

        this._allButton = addFilter({ label: _('All') }, () => this._setFilter(null));
        this._allButton.add_style_class_name('active');

        this._favButton = addFilter({
            child: new St.Icon({ icon_name: 'starred-symbolic', icon_size: 14 }),
        }, () => this._setFilter(-1));

        this._textButton = addFilter({ label: _('Text') }, () => this._setFilter(null, ItemType.TEXT));
        this._imageButton = addFilter({ label: _('Images') }, () => this._setFilter(null, ItemType.IMAGE));
        this._urlButton = addFilter({ label: _('Links') }, () => this._setFilter(null, ItemType.URL));
        this._codeButton = addFilter({ label: _('Code') }, () => this._setFilter(null, ItemType.CODE));
        this._listsButton = addFilter({ label: _('Lists') }, () => this._showListsMenu());

        this.add_child(this._filterBar);

        this._pinnedBar = new St.BoxLayout({
            style_class: 'clipmaster-pinned-bar',
            x_expand: true,
            visible: false,
            ...orientationProps(false),
        });
        this.add_child(this._pinnedBar);
        this._refreshPinnedLists();
    }

    _buildItemList() {
        this._scrollView = new St.ScrollView({
            style_class: 'clipmaster-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });

        this._itemsBox = new St.BoxLayout({
            style_class: 'clipmaster-items',
            x_expand: true,
            ...orientationProps(true),
        });

        this._scrollView.add_child(this._itemsBox);
        this.add_child(this._scrollView);
    }

    _buildFooter() {
        const footer = new St.BoxLayout({
            style_class: 'clipmaster-footer',
            x_expand: true,
            ...orientationProps(false),
        });

        // Short enough to fit the narrowest popup the settings allow, and
        // ellipsized rather than clipped if a theme makes it wider still.
        const hint = new St.Label({
            text: _('Enter paste, Alt+F favourite, Alt+P pin, Alt+D delete, Esc close'),
            style_class: 'clipmaster-footer-text',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        hint.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        footer.add_child(hint);

        // Resize handle, so the popup can be sized by dragging as well as from
        // the preferences. Issue #28 asked for exactly this.
        this._resizeHandle = new St.Button({
            style_class: 'clipmaster-resize-handle',
            child: new St.Icon({ icon_name: 'view-more-horizontal-symbolic', icon_size: 12 }),
            can_focus: false,
            track_hover: true,
        });
        this._resizeHandle._tooltipText = _('Drag to resize');
        this._resizeHandle.connect('notify::hover', () => this._onButtonHover(this._resizeHandle));
        this._resizeHandle.connect('button-press-event', (actor, event) => {
            this._startResize(event);
            return Clutter.EVENT_STOP;
        });
        footer.add_child(this._resizeHandle);

        this.add_child(footer);
    }

    _togglePlainTextMode() {
        this._plainTextMode = !this._plainTextMode;
        if (this._plainTextMode)
            this._plainTextButton.add_style_pseudo_class('checked');
        else
            this._plainTextButton.remove_style_pseudo_class('checked');
    }

    _togglePin() {
        this._isPinned = !this._isPinned;
        if (this._isPinned)
            this._pinButton.add_style_pseudo_class('checked');
        else
            this._pinButton.remove_style_pseudo_class('checked');
    }

    _onButtonHover(button) {
        if (!this._tooltip)
            return;

        if (!button.hover) {
            this._tooltip.visible = false;
            return;
        }

        this._tooltip.set_text(button._tooltipText);
        this._tooltip.visible = true;

        const [x, y] = button.get_transformed_position();
        const [, buttonHeight] = button.get_transformed_size();
        this._tooltip.set_position(Math.round(x), Math.round(y + buttonHeight + 4));
    }

    _startDrag(event) {
        if (!this._isShowing)
            return;

        this._dragging = true;
        [this._dragStartX, this._dragStartY] = event.get_coords();
        [this._dragStartPosX, this._dragStartPosY] = this.get_position();
        this._lastDragUpdate = 0;

        this._signalManager.connect(global.stage, 'motion-event', (actor, motionEvent) => {
            if (!this._dragging)
                return Clutter.EVENT_PROPAGATE;

            const now = GLib.get_monotonic_time() / 1000;
            if (now - this._lastDragUpdate < DRAG_THROTTLE_MS)
                return Clutter.EVENT_PROPAGATE;
            this._lastDragUpdate = now;

            const [currentX, currentY] = motionEvent.get_coords();
            this.set_position(
                Math.round(this._dragStartPosX + (currentX - this._dragStartX)),
                Math.round(this._dragStartPosY + (currentY - this._dragStartY)));

            return Clutter.EVENT_PROPAGATE;
        }, 'drag-motion');

        this._signalManager.connect(global.stage, 'button-release-event', () => {
            this._stopDrag();
            return Clutter.EVENT_PROPAGATE;
        }, 'drag-release');
    }

    _stopDrag() {
        this._dragging = false;
        this._signalManager.disconnect('drag-motion');
        this._signalManager.disconnect('drag-release');
    }

    _startResize(event) {
        if (!this._isShowing)
            return;

        this._resizing = true;
        [this._resizeStartX, this._resizeStartY] = event.get_coords();
        [this._resizeStartWidth, this._resizeStartHeight] = this.get_size();
        this._lastResizeUpdate = 0;

        this._signalManager.connect(global.stage, 'motion-event', (actor, motionEvent) => {
            if (!this._resizing)
                return Clutter.EVENT_PROPAGATE;

            const now = GLib.get_monotonic_time() / 1000;
            if (now - this._lastResizeUpdate < DRAG_THROTTLE_MS)
                return Clutter.EVENT_PROPAGATE;
            this._lastResizeUpdate = now;

            const [currentX, currentY] = motionEvent.get_coords();
            this.set_size(
                Math.max(MIN_POPUP_SIZE, Math.round(this._resizeStartWidth + (currentX - this._resizeStartX))),
                Math.max(MIN_POPUP_SIZE, Math.round(this._resizeStartHeight + (currentY - this._resizeStartY))));

            return Clutter.EVENT_PROPAGATE;
        }, 'resize-motion');

        this._signalManager.connect(global.stage, 'button-release-event', () => {
            this._stopResize();
            return Clutter.EVENT_PROPAGATE;
        }, 'resize-release');
    }

    _stopResize() {
        if (!this._resizing)
            return;

        this._resizing = false;
        this._signalManager.disconnect('resize-motion');
        this._signalManager.disconnect('resize-release');

        // Settings hold logical pixels, which is what the preferences window
        // shows and what the size is scaled back up from on the next open.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const [width, height] = this.get_size();

        this._settings.set_int('popup-width', Math.round(width / scale));
        this._settings.set_int('popup-height', Math.round(height / scale));
    }

    _setupClickOutside() {
        this._signalManager.disconnect('click-outside');
        this._signalManager.disconnect('focus-window');

        if (!this._settings.get_boolean('close-on-click-outside'))
            return;

        const graceMs = ValidationUtils.validateNumber(
            this._settings.get_int('click-outside-grace-ms'), 0, 2000, 250);

        this._signalManager.connect(global.stage, 'button-press-event', (actor, event) => {
            if (!this._isShowing || this._isPinned)
                return Clutter.EVENT_PROPAGATE;

            if (GLib.get_monotonic_time() / 1000 - this._showTime < graceMs)
                return Clutter.EVENT_PROPAGATE;

            const [clickX, clickY] = event.get_coords();
            const [popupX, popupY] = this.get_position();
            const [popupWidth, popupHeight] = this.get_size();

            const inside = clickX >= popupX && clickX <= popupX + popupWidth
                && clickY >= popupY && clickY <= popupY + popupHeight;

            if (!inside)
                this._extension.hidePopup();

            // The click is never swallowed: it still reaches whatever is under it.
            return Clutter.EVENT_PROPAGATE;
        }, 'click-outside');

        this._signalManager.connect(global.display, 'notify::focus-window', () => {
            if (!this._isShowing || this._isPinned)
                return;

            if (GLib.get_monotonic_time() / 1000 - this._showTime < graceMs)
                return;

            if (global.display.focus_window)
                this._extension.hidePopup();
        }, 'focus-window');
    }

    _setFilter(listId, type = null) {
        this._currentListId = listId;
        this._currentType = type;
        this._selectedIndex = 0;

        const buttons = [
            this._allButton, this._favButton, this._textButton, this._imageButton,
            this._urlButton, this._codeButton, this._listsButton, ...this._pinnedListButtons,
        ];
        for (const button of buttons)
            button.remove_style_class_name('active');

        if (listId === -1)
            this._favButton.add_style_class_name('active');
        else if (type === ItemType.TEXT)
            this._textButton.add_style_class_name('active');
        else if (type === ItemType.IMAGE)
            this._imageButton.add_style_class_name('active');
        else if (type === ItemType.URL)
            this._urlButton.add_style_class_name('active');
        else if (type === ItemType.CODE)
            this._codeButton.add_style_class_name('active');
        else if (listId !== null)
            (this._pinnedListButtons.find(b => b._listId === listId) || this._listsButton).add_style_class_name('active');
        else
            this._allButton.add_style_class_name('active');

        this._loadItems();
    }

    open() {
        this._searchEntry.set_text('');
        this._searchQuery = '';
        this._selectedIndex = 0;
        this._plainTextMode = false;
        this._plainTextButton.remove_style_pseudo_class('checked');

        this._isShowing = true;
        this._updatePrivateModeBanner();
        this._refreshPinnedLists();
        this._setFilter(null);

        this.visible = true;
        this.opacity = 255;
        this.reactive = true;
        this._showTime = GLib.get_monotonic_time() / 1000;

        // The outside click watcher starts a moment later, so the very press
        // that opened the popup cannot close it again.
        this._timeoutManager.add(GLib.PRIORITY_DEFAULT, CLICK_OUTSIDE_SETUP_MS, () => {
            if (this._isShowing) {
                this._setupClickOutside();
                this.grab_key_focus();
            }
            return GLib.SOURCE_REMOVE;
        }, 'click-outside-setup');
    }

    close() {
        this._isShowing = false;

        this._cleanupGlobalHandlers();
        this._closeOpenMenus();

        this.visible = false;
        this.opacity = 0;
        this.reactive = false;

        if (this._tooltip)
            this._tooltip.visible = false;

        // Releasing the shell's key focus lets the application underneath take
        // the synthetic paste shortcut.
        if (global.stage.get_key_focus())
            global.stage.set_key_focus(null);
    }

    cancelClickOutside() {
        this._signalManager.disconnect('click-outside');
        this._timeoutManager.remove('click-outside-setup');
    }

    _cleanupGlobalHandlers() {
        this._signalManager.disconnect('click-outside');
        this._signalManager.disconnect('focus-window');
        this._stopDrag();
        this._stopResize();
        this._timeoutManager.remove('click-outside-setup');
    }

    _closeOpenMenus() {
        for (const menu of [...this._openMenus])
            menu.close();
        this._openMenus.clear();
    }

    destroy() {
        this._cleanupGlobalHandlers();
        this._clearItemTimeouts();
        this._closeOpenMenus();

        this._signalManager.disconnectAll();
        this._timeoutManager.removeAll();
        this._unloadCustomStylesheet();

        if (this._tooltip) {
            this._tooltip.destroy();
            this._tooltip = null;
        }

        this._interfaceSettings = null;
        this._extension = null;
        this._settings = null;
        this._database = null;
        this._items = [];
        this._pinnedListButtons = [];

        super.destroy();
    }

    /**
     * Hover timeouts live on the rows, so they must go before the rows do.
     * Destroying the rows first left a timeout that fired against a row that
     * no longer existed and pasted whatever had taken its place in the list.
     */
    _clearItemTimeouts() {
        for (const child of this._itemsBox.get_children()) {
            if (child._pasteTimeoutId) {
                this._timeoutManager.remove(child._pasteTimeoutId);
                child._pasteTimeoutId = null;
            }
            if (child._pasteResetTimeoutId) {
                this._timeoutManager.remove(child._pasteResetTimeoutId);
                child._pasteResetTimeoutId = null;
            }
        }
    }

    _loadItems() {
        this._clearItemTimeouts();
        this._itemsBox.destroy_all_children();

        this._items = this._database.getItems({
            limit: this._settings.get_int('items-per-page'),
            search: this._searchQuery || null,
            listId: this._currentListId,
            type: this._currentType,
        });

        if (this._items.length === 0) {
            this._itemsBox.add_child(new St.Label({
                text: this._searchQuery ? _('Nothing matches that search') : _('No clipboard items yet'),
                style_class: 'clipmaster-empty',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            }));
            return;
        }

        if (this._selectedIndex >= this._items.length)
            this._selectedIndex = this._items.length - 1;

        this._items.forEach((item, index) => this._itemsBox.add_child(this._createItemRow(item, index)));
        this._updateSelection();
    }

    _createItemRow(item, index) {
        const row = new St.BoxLayout({
            style_class: 'clipmaster-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            ...orientationProps(false),
        });

        row._item = item;
        row._index = index;

        row.connect('button-press-event', (actor, event) => this._onRowPress(row, item, index, event));
        row.connect('enter-event', () => this._onRowEnter(row, index));
        row.connect('leave-event', () => this._onRowLeave(row));

        if (index < 9) {
            row.add_child(new St.Label({
                text: `${index + 1}`,
                style_class: 'clipmaster-item-number',
            }));
        } else {
            row.add_child(new St.Widget({ width: 24 }));
        }

        row.add_child(new St.Icon({
            icon_name: ClipboardPopup._typeIcon(item.type),
            icon_size: 16,
            style_class: 'clipmaster-item-icon',
        }));

        row.add_child(this._createItemContent(item));

        if (item.isPinned) {
            row.add_child(new St.Icon({
                icon_name: 'view-pin-symbolic',
                icon_size: 14,
                style_class: 'clipmaster-item-pinned',
            }));
        }

        if (this._canShowQr(item))
            row.add_child(this._createQrButton(item));

        row.add_child(this._createFavButton(item));

        return row;
    }

    _createItemContent(item) {
        const contentBox = new St.BoxLayout({
            x_expand: true,
            style_class: 'clipmaster-item-content',
            ...orientationProps(true),
        });

        if (item.title) {
            const titleLabel = new St.Label({
                text: item.title,
                style_class: 'clipmaster-item-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            contentBox.add_child(titleLabel);
        }

        let previewText = item.preview || item.plainText || item.content || '';

        if (item.type === ItemType.IMAGE) {
            const thumbnail = this._createThumbnail(item);
            if (thumbnail)
                contentBox.add_child(thumbnail);
        }

        const previewLength = this._settings.get_int('preview-length');
        if (previewText.length > previewLength)
            previewText = `${previewText.substring(0, previewLength)}...`;

        const previewLabel = new St.Label({
            text: previewText.replace(/\n/g, ' ').trim(),
            style_class: item.title ? 'clipmaster-item-preview dim' : 'clipmaster-item-preview',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        previewLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        contentBox.add_child(previewLabel);

        if (item.created) {
            contentBox.add_child(new St.Label({
                text: ClipboardPopup._relativeTime(item.created),
                style_class: 'clipmaster-item-time',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            }));
        }

        return contentBox;
    }

    _createThumbnail(item) {
        const base64 = item.thumbnail || (item.metadata?.storedAs === 'base64' ? item.content : null);
        if (!base64)
            return null;

        try {
            const bytes = new GLib.Bytes(GLib.base64_decode(base64));
            return new St.Icon({
                gicon: Gio.BytesIcon.new(bytes),
                icon_size: 48,
                style_class: 'clipmaster-thumbnail',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
        } catch (e) {
            debugLog(`Could not render the thumbnail: ${e.message}`);
            return null;
        }
    }

    _canShowQr(item) {
        return (item.type === ItemType.TEXT || item.type === ItemType.URL)
            && QrCodeGenerator.canEncode(item.content || item.plainText);
    }

    _createQrButton(item) {
        const button = new St.Button({
            style_class: 'clipmaster-qr-button',
            child: new St.Icon({
                icon_name: 'view-grid-symbolic',
                icon_size: 14,
                style_class: 'clipmaster-item-qr',
            }),
            can_focus: false,
            track_hover: true,
        });

        button.connect('clicked', () => this._showQrDialog(item));
        return button;
    }

    _createFavButton(item) {
        const icon = new St.Icon({
            icon_name: item.isFavorite ? 'starred-symbolic' : 'non-starred-symbolic',
            icon_size: 16,
            style_class: item.isFavorite ? 'clipmaster-item-fav' : 'clipmaster-item-fav-inactive',
        });

        const button = new St.Button({
            style_class: 'clipmaster-fav-button',
            child: icon,
            can_focus: false,
            track_hover: true,
        });

        button.connect('clicked', () => {
            this._database.toggleFavorite(item.id);
            this._loadItems();
        });

        return button;
    }

    _onRowPress(row, item, index, event) {
        const button = event.get_button();

        if (button === 1) {
            if (row._pasteTimeoutId) {
                this._timeoutManager.remove(row._pasteTimeoutId);
                row._pasteTimeoutId = null;
            }

            this._selectedIndex = index;
            this._updateSelection();
            this._pasteFromHover = false;
            this._pasteSelected();
            return Clutter.EVENT_STOP;
        }

        if (button === 3) {
            this._selectedIndex = index;
            this._updateSelection();
            this._showContextMenu(item, row);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onRowEnter(row, index) {
        this._selectedIndex = index;
        this._updateSelection();

        if (!this._settings.get_boolean('paste-on-select'))
            return;

        this._onRowLeave(row);

        row._pasteTimeoutId = this._timeoutManager.add(GLib.PRIORITY_DEFAULT, HOVER_PASTE_DELAY_MS, () => {
            row._pasteTimeoutId = null;

            if (this._selectedIndex === index && this._isShowing) {
                this._pasteFromHover = true;
                this._pasteSelected();

                row._pasteResetTimeoutId = this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._pasteFromHover = false;
                    row._pasteResetTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                }, `paste-reset-${index}`);
            }

            return GLib.SOURCE_REMOVE;
        }, `hover-paste-${index}`);
    }

    _onRowLeave(row) {
        if (row._pasteTimeoutId) {
            this._timeoutManager.remove(row._pasteTimeoutId);
            row._pasteTimeoutId = null;
        }
        if (row._pasteResetTimeoutId) {
            this._timeoutManager.remove(row._pasteResetTimeoutId);
            row._pasteResetTimeoutId = null;
        }
    }

    static _typeIcon(type) {
        const icons = {
            [ItemType.TEXT]: 'text-x-generic-symbolic',
            [ItemType.HTML]: 'text-html-symbolic',
            [ItemType.CODE]: 'text-x-script-symbolic',
            [ItemType.IMAGE]: 'image-x-generic-symbolic',
            [ItemType.FILE]: 'folder-documents-symbolic',
            [ItemType.URL]: 'web-browser-symbolic',
            [ItemType.COLOR]: 'color-select-symbolic',
        };
        return icons[type] || 'text-x-generic-symbolic';
    }

    static _relativeTime(created) {
        const minutes = Math.floor((Date.now() - created) / 60000);

        if (minutes < 1)
            return _('Just now');
        if (minutes === 1)
            return _('1 minute ago');
        if (minutes < 60)
            return _('%d minutes ago').replace('%d', String(minutes));

        const hours = Math.floor(minutes / 60);
        if (hours === 1)
            return _('1 hour ago');
        if (hours < 24)
            return _('%d hours ago').replace('%d', String(hours));

        const days = Math.floor(hours / 24);
        if (days === 1)
            return _('Yesterday');
        if (days < 7)
            return _('%d days ago').replace('%d', String(days));

        return new Date(created).toLocaleString();
    }

    _updateSelection() {
        this._itemsBox.get_children().forEach((child, index) => {
            if (child._index === undefined)
                return;

            if (index === this._selectedIndex)
                child.add_style_class_name('selected');
            else
                child.remove_style_class_name('selected');
        });
    }

    async _pasteSelected() {
        const item = this._items[this._selectedIndex];
        if (!item)
            return;

        if (item.type === ItemType.IMAGE && item.content)
            await this._extension.monitor.copyImageToClipboard(item.content);
        else
            this._extension.monitor.copyToClipboard(this._plainTextMode ? item.plainText : item.content, this._plainTextMode);

        this._database.updateItem(item.id, {
            lastUsed: Date.now(),
            useCount: (item.useCount || 1) + 1,
        });

        const closeOnPaste = this._settings.get_boolean('close-on-paste');
        if (closeOnPaste && !this._isPinned && !this._pasteFromHover) {
            this._extension.queueAutoPasteForSelection();
            this._extension.hidePopup();
        }
    }

    _trackMenu(menu) {
        this._openMenus.add(menu);
        Main.uiGroup.add_child(menu.actor);
        menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                return;

            this._openMenus.delete(menu);
            menu.destroy();
        });
        menu.open();
    }

    _showListsMenu() {
        const lists = this._database.getLists();
        if (lists.length === 0) {
            Main.notify('ClipMaster', _('There are no lists yet. Use the plus button to create one.'));
            return;
        }

        const menu = new PopupMenu.PopupMenu(this._listsButton, 0.0, St.Side.TOP);
        const pinnedLists = this._settings.get_strv('pinned-lists');

        for (const list of lists) {
            const menuItem = new PopupMenu.PopupMenuItem(list.name);
            menuItem.connect('activate', () => this._setFilter(list.id));

            menuItem.add_child(this._createListPinButton(list, pinnedLists.includes(String(list.id))));
            menuItem.add_child(this._createListDeleteButton(list, menu));

            menu.addMenuItem(menuItem);
        }

        this._trackMenu(menu);
    }

    _createListPinButton(list, isPinned) {
        const button = new St.Button({
            style_class: 'clipmaster-list-pin-button',
            child: new St.Icon({
                icon_name: isPinned ? 'starred-symbolic' : 'non-starred-symbolic',
                icon_size: 14,
            }),
            can_focus: false,
        });

        button.connect('clicked', () => {
            const current = this._settings.get_strv('pinned-lists');
            const listId = String(list.id);
            const next = current.includes(listId)
                ? current.filter(id => id !== listId)
                : [...current, listId];

            this._settings.set_strv('pinned-lists', next);
            button.child.icon_name = next.includes(listId) ? 'starred-symbolic' : 'non-starred-symbolic';
            this._refreshPinnedLists();
        });

        return button;
    }

    _createListDeleteButton(list, menu) {
        const button = new St.Button({
            style_class: 'clipmaster-list-delete-button',
            child: new St.Icon({ icon_name: 'edit-delete-symbolic', icon_size: 14 }),
            can_focus: false,
        });

        button.connect('clicked', () => {
            menu.close();
            this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._showConfirmDialog(
                    _('Delete the list "%s"?').replace('%s', list.name),
                    _('The items in it are kept, only the list is removed.'),
                    () => {
                        this._settings.set_strv(
                            'pinned-lists',
                            this._settings.get_strv('pinned-lists').filter(id => id !== String(list.id)));
                        this._database.deleteList(list.id);
                        this._refreshPinnedLists();
                        this._loadItems();
                    });
                return GLib.SOURCE_REMOVE;
            }, 'delete-list-confirm');
        });

        return button;
    }

    _refreshPinnedLists() {
        for (const button of this._pinnedListButtons)
            button.destroy();
        this._pinnedListButtons = [];

        const pinnedIds = this._settings.get_strv('pinned-lists');
        const lists = new Map(this._database.getLists().map(list => [String(list.id), list]));

        for (const listId of pinnedIds) {
            const list = lists.get(listId);
            if (!list)
                continue;

            const button = new St.Button({
                style_class: 'clipmaster-filter-button clipmaster-pinned-list',
                label: list.name.length > 12 ? `${list.name.substring(0, 12)}...` : list.name,
                can_focus: false,
            });
            button._listId = list.id;
            button.connect('clicked', () => this._setFilter(list.id));

            this._pinnedListButtons.push(button);
            this._pinnedBar.add_child(button);
        }

        this._pinnedBar.visible = this._pinnedListButtons.length > 0;
    }

    _showContextMenu(item, row) {
        const menu = new PopupMenu.PopupMenu(row, 0.0, St.Side.TOP);

        menu.addAction(_('Edit title'), () => this._showEditDialog(item, 'title'));

        if (item.type === ItemType.TEXT || item.type === ItemType.URL)
            menu.addAction(_('Edit content'), () => this._showEditDialog(item, 'content'));

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        menu.addAction(item.isFavorite ? _('Remove from favourites') : _('Add to favourites'), () => {
            this._database.toggleFavorite(item.id);
            this._loadItems();
        });

        menu.addAction(item.isPinned ? _('Unpin from the top') : _('Pin to the top'), () => {
            this._database.togglePinned(item.id);
            this._loadItems();
        });

        const lists = this._database.getLists();
        if (lists.length > 0) {
            const submenu = new PopupMenu.PopupSubMenuMenuItem(_('Add to a list'));
            for (const list of lists) {
                submenu.menu.addAction(list.name, () => {
                    this._database.addItemToList(item.id, list.id);
                    this._loadItems();
                });
            }
            menu.addMenuItem(submenu);
        }

        if (this._canShowQr(item)) {
            menu.addAction(_('Show as a QR code'), () => {
                menu.close();
                this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._showQrDialog(item);
                    return GLib.SOURCE_REMOVE;
                }, 'qr-dialog-delay');
            });
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        menu.addAction(_('Delete'), () => {
            menu.close();
            this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._confirmDeleteItem(item);
                return GLib.SOURCE_REMOVE;
            }, 'delete-item-confirm');
        });

        this._trackMenu(menu);
    }

    _confirmDeleteItem(item) {
        const preview = item.preview || item.plainText || _('this item');
        const shortPreview = preview.length > 50 ? `${preview.substring(0, 50)}...` : preview;

        this._showConfirmDialog(
            _('Delete this item?'),
            shortPreview,
            () => {
                this._database.deleteItem(item.id);
                this._loadItems();
            });
    }

    _showConfirmDialog(heading, body, onConfirm) {
        const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });

        dialog.contentLayout.add_child(new St.Label({
            text: heading,
            style_class: 'clipmaster-dialog-title',
        }));

        const bodyLabel = new St.Label({ text: body, style_class: 'clipmaster-confirm-dialog-message' });
        bodyLabel.clutter_text.set_line_wrap(true);
        bodyLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        bodyLabel.set_width(400);
        dialog.contentLayout.add_child(bodyLabel);

        dialog.setButtons([
            { label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape },
            {
                label: _('Delete'),
                action: () => {
                    dialog.close();
                    onConfirm();
                },
                default: true,
            },
        ]);

        dialog.open();
    }

    _showCreateListDialog() {
        const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });

        dialog.contentLayout.add_child(new St.Label({
            text: _('Create a new list'),
            style_class: 'clipmaster-dialog-title',
        }));

        const entry = new St.Entry({
            style_class: 'clipmaster-dialog-entry',
            hint_text: _('List name'),
            can_focus: true,
        });
        dialog.contentLayout.add_child(entry);

        dialog.setButtons([
            { label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape },
            {
                label: _('Create'),
                action: () => {
                    const name = entry.get_text().trim();
                    dialog.close();

                    if (!name)
                        return;

                    this._database.createList(name);
                    this._loadItems();
                },
                default: true,
            },
        ]);

        dialog.open();
        entry.grab_key_focus();
    }

    _showEditDialog(item, field) {
        const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });

        dialog.contentLayout.add_child(new St.Label({
            text: field === 'title' ? _('Edit title') : _('Edit content'),
            style_class: 'clipmaster-dialog-title',
        }));

        const entry = new St.Entry({
            style_class: 'clipmaster-dialog-entry',
            text: item[field] || '',
            can_focus: true,
        });
        dialog.contentLayout.add_child(entry);

        dialog.setButtons([
            { label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape },
            {
                label: _('Save'),
                action: () => {
                    const value = entry.get_text();
                    dialog.close();

                    const updates = { [field]: value };
                    if (field === 'content') {
                        updates.plainText = value;
                        updates.preview = value.substring(0, 200);
                    }

                    this._database.updateItem(item.id, updates);
                    this._loadItems();
                },
                default: true,
            },
        ]);

        dialog.open();
        entry.grab_key_focus();
    }

    _showQrDialog(item) {
        const text = item.content || item.plainText || '';
        const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog clipmaster-qr-dialog' });

        dialog.contentLayout.add_child(new St.Label({
            text: _('QR code'),
            style_class: 'clipmaster-dialog-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        try {
            dialog.contentLayout.add_child(this._createQrArea(text));

            dialog.contentLayout.add_child(new St.Label({
                text: text.length > 60 ? `${text.substring(0, 60)}...` : text,
                style_class: 'clipmaster-qr-preview',
                x_align: Clutter.ActorAlign.CENTER,
            }));
        } catch (e) {
            debugLog(`Could not build the QR code: ${e.message}`);
            dialog.contentLayout.add_child(new St.Label({
                text: _('This item cannot be shown as a QR code.'),
                style_class: 'clipmaster-dialog-message',
            }));
        }

        dialog.setButtons([{ label: _('Close'), action: () => dialog.close(), default: true }]);
        dialog.open();
    }

    /**
     * Draws the code in one pass with Cairo. Building it out of one actor per
     * module, as earlier versions did, meant several thousand actors for a long
     * payload.
     */
    _createQrArea(text) {
        const { size, modules } = QrCodeGenerator.generate(text, QrEcc.MEDIUM);
        const quietZone = 2;
        const cells = size + quietZone * 2;
        const cellSize = Math.max(2, Math.floor(QR_PIXEL_SIZE / cells));
        const pixelSize = cellSize * cells;

        const area = new St.DrawingArea({
            style_class: 'clipmaster-qr-container',
            width: pixelSize,
            height: pixelSize,
            x_align: Clutter.ActorAlign.CENTER,
        });

        area.connect('repaint', drawingArea => {
            const context = drawingArea.get_context();

            context.setSourceRGB(1, 1, 1);
            context.rectangle(0, 0, pixelSize, pixelSize);
            context.fill();

            context.setSourceRGB(0, 0, 0);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    if (modules[y][x])
                        context.rectangle((x + quietZone) * cellSize, (y + quietZone) * cellSize, cellSize, cellSize);
                }
            }
            context.fill();

            context.$dispose();
        });

        return area;
    }

    _onKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        const hasAlt = (event.get_state() & Clutter.ModifierType.MOD1_MASK) !== 0;
        const searchHasFocus = this._searchEntry.clutter_text.has_key_focus();

        switch (symbol) {
        case Clutter.KEY_Escape:
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Up:
        case Clutter.KEY_KP_Up:
            this._moveSelection(-1);
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Down:
        case Clutter.KEY_KP_Down:
            this._moveSelection(1);
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Page_Up:
            this._moveSelection(-5);
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Page_Down:
            this._moveSelection(5);
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            this._pasteFromHover = false;
            this._pasteSelected();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_Delete:
            this._withSelectedItem(item => this._confirmDeleteItem(item));
            return Clutter.EVENT_STOP;
        }

        if (hasAlt)
            return this._onAltKeyPress(symbol);

        if (!searchHasFocus)
            return this._onTypeAhead(symbol, event);

        return Clutter.EVENT_PROPAGATE;
    }

    _onAltKeyPress(symbol) {
        switch (symbol) {
        case Clutter.KEY_p:
        case Clutter.KEY_P:
            this._togglePin();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_t:
        case Clutter.KEY_T:
            this._togglePlainTextMode();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_f:
        case Clutter.KEY_F:
            this._withSelectedItem(item => {
                this._database.toggleFavorite(item.id);
                this._loadItems();
            });
            return Clutter.EVENT_STOP;

        case Clutter.KEY_d:
        case Clutter.KEY_D:
            this._withSelectedItem(item => this._confirmDeleteItem(item));
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onTypeAhead(symbol, event) {
        if (symbol >= Clutter.KEY_1 && symbol <= Clutter.KEY_9) {
            const index = symbol - Clutter.KEY_1;
            if (index < this._items.length) {
                this._selectedIndex = index;
                this._pasteFromHover = false;
                this._pasteSelected();
            }
            return Clutter.EVENT_STOP;
        }

        const unicode = event.get_key_unicode();
        if (unicode && unicode.length === 1 && unicode >= ' ') {
            this._searchEntry.grab_key_focus();
            this._searchEntry.set_text(this._searchEntry.get_text() + unicode);
            this._searchEntry.clutter_text.set_cursor_position(-1);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _withSelectedItem(callback) {
        const item = this._items[this._selectedIndex];
        if (item)
            callback(item);
    }

    _moveSelection(delta) {
        if (this._items.length === 0)
            return;

        this._selectedIndex = Math.max(0, Math.min(this._items.length - 1, this._selectedIndex + delta));
        this._updateSelection();
        this._scrollToSelected();
    }

    _scrollToSelected() {
        const children = this._itemsBox.get_children();
        const child = children[this._selectedIndex];
        if (!child)
            return;

        let childY = 0;
        for (let i = 0; i < this._selectedIndex; i++)
            childY += children[i].height;

        const adjustment = this._scrollView.vadjustment;
        if (!adjustment)
            return;

        const childBottom = childY + child.height;
        const pageBottom = adjustment.value + adjustment.page_size;

        if (childY < adjustment.value)
            adjustment.set_value(childY);
        else if (childBottom > pageBottom)
            adjustment.set_value(childBottom - adjustment.page_size);
    }
});
