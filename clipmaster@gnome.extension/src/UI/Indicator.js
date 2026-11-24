/*
 * ClipMaster - Panel Indicator
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ItemType, debugLog, reportError } from '../Util/Constants.js';
import { SignalManager } from '../Util/Utils.js';

const RECENT_ITEM_COUNT = 5;
const PREVIEW_LENGTH = 50;

export const ClipMasterIndicator = GObject.registerClass(
class ClipMasterIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'ClipMaster');

        this._extension = extension;
        this._settings = extension.settings;
        this._signalManager = new SignalManager();

        this._icon = new St.Icon({ style_class: 'system-status-icon' });
        this.add_child(this._icon);
        this.refreshIcon();

        this._signalManager.connect(
            this._settings, 'changed::indicator-icon', () => this.refreshIcon(), 'indicator-icon');
        this._signalManager.connect(
            this._settings, 'changed::private-mode', () => this.refreshIcon(), 'private-mode');

        this._buildMenu();
    }

    refreshIcon() {
        const privateMode = this._settings.get_boolean('private-mode');

        this._icon.icon_name = privateMode ? 'view-conceal-symbolic' : this._settings.get_string('indicator-icon');

        if (privateMode)
            this.add_style_class_name('clipmaster-indicator-private');
        else
            this.remove_style_class_name('clipmaster-indicator-private');
    }

    /**
     * A left click opens the ClipMaster popup rather than this menu. The menu
     * is opened invisibly first because panel extensions such as Dash to Panel
     * use the open menu as the signal not to auto hide the panel, which is what
     * issue #18 was about.
     */
    vfunc_event(event) {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return super.vfunc_event(event);

        if (event.get_button() === 1) {
            this.menu.open();
            this.menu.actor.visible = false;
            this._extension.togglePopup();
            return Clutter.EVENT_STOP;
        }

        if (event.get_button() === 3) {
            this.menu.actor.visible = true;
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_event(event);
    }

    _buildMenu() {
        this._recentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._recentSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction(_('Show the clipboard history'), () => {
            this.menu.close();
            this._extension.showPopup();
        });

        this._privateModeItem = new PopupMenu.PopupSwitchMenuItem(
            _('Private mode'), this._settings.get_boolean('private-mode'));
        this._privateModeItem.connect('toggled', (item, state) => {
            this._settings.set_boolean('private-mode', state);
            this.refreshIcon();
        });
        this.menu.addMenuItem(this._privateModeItem);

        this._signalManager.connect(this._settings, 'changed::private-mode', () => {
            this._privateModeItem.setToggleState(this._settings.get_boolean('private-mode'));
        }, 'private-mode-item');

        this.menu.addAction(_('Clear the history'), () => {
            this.menu.close();
            this._confirmClearHistory();
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction(_('Preferences'), () => {
            this.menu.close();
            this._extension.openPreferences();
        });
    }

    /**
     * Clearing the history used to happen on the first click of this menu item.
     * Nothing that removes what a user collected acts without asking.
     */
    _confirmClearHistory() {
        const stats = this._extension.database.getStats();
        const removable = stats.total - stats.favorites;

        if (removable === 0) {
            Main.notify('ClipMaster', _('There is nothing to clear.'));
            return;
        }

        const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });

        dialog.contentLayout.add_child(new St.Label({
            text: _('Clear the clipboard history?'),
            style_class: 'clipmaster-dialog-title',
        }));

        const body = new St.Label({
            text: removable === 1
                ? _('One item will be deleted. Favourites and pinned items are kept. This cannot be undone.')
                : _('%d items will be deleted. Favourites and pinned items are kept. This cannot be undone.')
                    .replace('%d', String(removable)),
            style_class: 'clipmaster-confirm-dialog-message',
        });
        body.clutter_text.set_line_wrap(true);
        body.set_width(380);
        dialog.contentLayout.add_child(body);

        dialog.setButtons([
            { label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape },
            {
                label: _('Clear'),
                action: () => {
                    dialog.close();
                    const removed = this._extension.database.clearHistory(true);
                    this.refresh();
                    Main.notify('ClipMaster', removed === 1
                        ? _('One item removed.')
                        : _('%d items removed.').replace('%d', String(removed)));
                },
                default: true,
            },
        ]);

        dialog.open();
    }

    refresh() {
        this._recentSection.removeAll();

        const items = this._extension.database.getItems({ limit: RECENT_ITEM_COUNT });

        if (items.length === 0) {
            this._recentSection.addMenuItem(
                new PopupMenu.PopupMenuItem(_('No clipboard items yet'), { reactive: false }));
            return;
        }

        for (const item of items)
            this._recentSection.addMenuItem(this._createRecentItem(item));
    }

    _createRecentItem(item) {
        const menuItem = new PopupMenu.PopupBaseMenuItem();

        if (item.type === ItemType.IMAGE)
            menuItem.add_child(this._createThumbnail(item));

        let preview = item.preview || item.content || '';
        if (preview.length > PREVIEW_LENGTH)
            preview = `${preview.substring(0, PREVIEW_LENGTH)}...`;

        menuItem.add_child(new St.Label({ text: preview.replace(/\n/g, ' '), x_expand: true }));

        menuItem.connect('activate', () => {
            if (item.type === ItemType.IMAGE && item.content) {
                this._extension.monitor.copyImageToClipboard(item.content)
                    .catch(e => reportError(`could not copy the image: ${e.message}`));
            } else {
                this._extension.monitor.copyToClipboard(item.content);
            }
        });

        return menuItem;
    }

    _createThumbnail(item) {
        if (item.thumbnail) {
            try {
                const bytes = new GLib.Bytes(GLib.base64_decode(item.thumbnail));
                return new St.Icon({
                    gicon: Gio.BytesIcon.new(bytes),
                    icon_size: 24,
                    style_class: 'clipmaster-indicator-thumbnail',
                });
            } catch (e) {
                debugLog(`Could not render the menu thumbnail: ${e.message}`);
            }
        }

        return new St.Icon({
            icon_name: 'image-x-generic-symbolic',
            icon_size: 16,
            style_class: 'popup-menu-icon',
        });
    }

    destroy() {
        this._signalManager.disconnectAll();
        this._signalManager = null;
        this._extension = null;
        this._settings = null;

        super.destroy();
    }
});
