/*
 * ClipMaster - Popup UI
 * License: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';


import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SignalManager, TimeoutManager } from '../Util/Utils.js';
import { ItemType, debugLog } from '../Util/Constants.js';
import { QrCodeGenerator, QrEcc } from '../Util/QrCodeGenerator.js';

export const ClipboardPopup = GObject.registerClass(
    class ClipboardPopup extends St.BoxLayout {
        _init(extension) {
            super._init({
                style_class: 'clipmaster-popup',
                vertical: true,
                reactive: true,
                can_focus: true,
                track_hover: true,
                visible: false,
                opacity: 0,
                x: 100,
                y: 100,
                width: 450,
                height: 550
            });

            this._extension = extension;
            this._settings = extension._settings;
            this._database = extension._database;
            this._monitor = extension._monitor;

            this._selectedIndex = 0;
            this._items = [];
            this._searchQuery = '';
            this._currentListId = null;
            this._plainTextMode = false;
            this._isPinned = false;
            this._isShowing = false;
            this._showTime = 0;
            this._pasteFromHover = false;
            this._customStylesheet = null;

            this._dragging = false;
            this._dragStartX = 0;
            this._dragStartY = 0;
            this._dragStartPosX = 0;
            this._dragStartPosY = 0;

            this._modalOverlay = null;


            this._signalManager = new SignalManager();
            this._timeoutManager = new TimeoutManager();

            // Connect to GNOME interface settings for system theme detection
            this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });

            this._applyTheme();

            this._signalManager.connect(
                this._settings,
                'changed::dark-theme',
                () => this._applyTheme(),
                'theme-dark-changed'
            );
            this._signalManager.connect(
                this._settings,
                'changed::theme',
                () => this._applyTheme(),
                'theme-name-changed'
            );
            this._signalManager.connect(
                this._settings,
                'changed::custom-theme-path',
                () => this._applyTheme(),
                'theme-custom-changed'
            );
            this._signalManager.connect(
                this._settings,
                'changed::follow-system-theme',
                () => this._applyTheme(),
                'follow-system-changed'
            );
            this._signalManager.connect(
                this._interfaceSettings,
                'changed::color-scheme',
                () => this._applyTheme(),
                'system-theme-changed'
            );

            this._buildUI();
            this._connectSignals();
        }

        _applyTheme() {
            // Safety check for disposed object
            if (!this._itemsBox) return;

            // Remove all theme classes first
            this.remove_style_class_name('light');
            this.remove_style_class_name('theme-adwaita');
            this.remove_style_class_name('theme-catppuccin');
            this.remove_style_class_name('theme-dracula');
            this.remove_style_class_name('theme-nord');
            this.remove_style_class_name('theme-gruvbox');
            this.remove_style_class_name('theme-onedark');
            this.remove_style_class_name('theme-monokai');
            this.remove_style_class_name('theme-solarized');
            this.remove_style_class_name('theme-tokyonight');
            this.remove_style_class_name('theme-rosepine');
            this.remove_style_class_name('theme-material');
            this.remove_style_class_name('theme-ayu');

            const followSystem = this._settings.get_boolean('follow-system-theme');
            const customThemePath = this._settings.get_string('custom-theme-path') || '';

            // Handle custom theme file
            if (customThemePath && !followSystem) {
                const customFile = Gio.File.new_for_path(customThemePath);
                if (customFile.query_exists(null)) {
                    try {
                        if (this._customStylesheet) {
                            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                            theme.unload_stylesheet(this._customStylesheet);
                        }
                        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                        theme.load_stylesheet(customFile);
                        this._customStylesheet = customFile;
                        return; // Custom theme takes precedence
                    } catch (e) {
                        console.error(`ClipMaster: Error loading custom theme: ${e.message}`);
                    }
                }
            } else if (this._customStylesheet) {
                try {
                    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                    theme.unload_stylesheet(this._customStylesheet);
                    this._customStylesheet = null;
                } catch (e) {
                    console.error(`ClipMaster: Error unloading custom theme: ${e.message}`);
                }
            }

            // Detect system dark/light mode
            let isDark = this._settings.get_boolean('dark-theme');
            if (followSystem) {
                const colorScheme = this._interfaceSettings.get_string('color-scheme');
                isDark = colorScheme === 'prefer-dark';
                this.add_style_class_name('theme-adwaita');
            } else {
                const themeName = this._settings.get_string('theme') || 'adwaita';
                this.add_style_class_name(`theme-${themeName}`);
            }

            if (!isDark) {
                this.add_style_class_name('light');
            }
        }

        _buildUI() {
            this._header = new St.BoxLayout({
                style_class: 'clipmaster-header',
                x_expand: true,
                reactive: true
            });

            const headerIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(
                    this._extension._extensionPath + '/assets/icons/clipmaster-symbolic.svg'
                ),
                style_class: 'clipmaster-header-icon',
                icon_size: 18
            });
            this._header.add_child(headerIcon);

            const title = new St.Label({
                text: 'ClipMaster',
                style_class: 'clipmaster-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START
            });
            this._header.add_child(title);

            // Simple tooltip label (shared by all buttons)
            this._tooltip = new St.Label({
                style_class: 'clipmaster-tooltip',
                visible: false
            });
            Main.uiGroup.add_child(this._tooltip);

            this._plainTextButton = new St.Button({
                style_class: 'clipmaster-toggle-button',
                child: new St.Icon({
                    icon_name: 'text-x-generic-symbolic',
                    icon_size: 16
                }),
                can_focus: false,
                track_hover: true
            });
            this._plainTextButton._tooltipText = _('Paste as plain text');
            this._plainTextButton.connect('notify::hover', (btn) => this._onButtonHover(btn));
            this._plainTextButton.connect('button-press-event', () => {
                this._plainTextMode = !this._plainTextMode;
                if (this._plainTextMode) {
                    this._plainTextButton.add_style_pseudo_class('checked');
                } else {
                    this._plainTextButton.remove_style_pseudo_class('checked');
                }
                debugLog(`Plain text mode toggled: ${this._plainTextMode}`);
                return Clutter.EVENT_STOP;
            });
            this._header.add_child(this._plainTextButton);

            this._pinButton = new St.Button({
                style_class: 'clipmaster-toggle-button',
                child: new St.Icon({
                    icon_name: 'view-pin-symbolic',
                    icon_size: 16
                }),
                can_focus: false,
                track_hover: true
            });
            this._pinButton._tooltipText = _('Pin popup (keep open)');
            this._pinButton.connect('notify::hover', (btn) => this._onButtonHover(btn));
            this._pinButton.connect('button-press-event', () => {
                this._isPinned = !this._isPinned;
                if (this._isPinned) {
                    this._pinButton.add_style_pseudo_class('checked');
                    debugLog(`Pin ENABLED - popup will stay open`);
                } else {
                    this._pinButton.remove_style_pseudo_class('checked');
                    debugLog(`Pin DISABLED - popup will close on outside click`);
                }
                debugLog(`Pin toggled: ${this._isPinned}`);
                return Clutter.EVENT_STOP;
            });
            this._header.add_child(this._pinButton);

            this._addListButton = new St.Button({
                style_class: 'clipmaster-toggle-button',
                child: new St.Icon({
                    icon_name: 'list-add-symbolic',
                    icon_size: 16
                }),
                can_focus: false,
                track_hover: true
            });
            this._addListButton._tooltipText = _('Create new list');
            this._addListButton.connect('notify::hover', (btn) => this._onButtonHover(btn));
            this._addListButton.connect('button-press-event', () => {
                debugLog('Add list button pressed');
                this._showCreateListDialog();
                return Clutter.EVENT_STOP;
            });
            this._header.add_child(this._addListButton);

            this._closeButton = new St.Button({
                style_class: 'clipmaster-close-button',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 16
                }),
                can_focus: false,
                track_hover: true
            });
            this._closeButton._tooltipText = _('Close');
            this._closeButton.connect('notify::hover', (btn) => this._onButtonHover(btn));
            this._closeButton.connect('button-press-event', () => {
                debugLog('Close button pressed');
                this._extension.hidePopup();
                return Clutter.EVENT_STOP;
            });
            this._header.add_child(this._closeButton);

            this._header.connect('button-press-event', (actor, event) => {
                debugLog(`Header button-press-event triggered`);

                const source = event.get_source();
                debugLog(`Event source: ${source ? source.toString() : 'null'}`);

                if (!source) {
                    debugLog(`No source, starting drag anyway`);
                    if (event.get_button() === 1) {
                        this._startDrag(event);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }

                const parent = source.get_parent ? source.get_parent() : null;

                if (source === this._closeButton ||
                    source === this._pinButton ||
                    source === this._plainTextButton ||
                    source === this._addListButton ||
                    parent === this._closeButton ||
                    parent === this._pinButton ||
                    parent === this._plainTextButton ||
                    parent === this._addListButton) {
                    debugLog(`Clicked on button, not starting drag`);
                    return Clutter.EVENT_PROPAGATE;
                }

                if (event.get_button() === 1) {
                    debugLog(`Left click on header, starting drag`);
                    this._startDrag(event);
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });

            this.add_child(this._header);

            this._searchEntry = new St.Entry({
                style_class: 'clipmaster-search',
                hint_text: _('Search... (type to filter)'),
                can_focus: true,
                x_expand: true
            });
            this._searchEntry.clutter_text.connect('text-changed', () => {
                this._searchQuery = this._searchEntry.get_text();
                this._loadItems();
            });
            this._searchEntry.clutter_text.connect('activate', () => {
                debugLog('Search entry activated (Enter pressed)');
                this._pasteSelected();
                return Clutter.EVENT_STOP;
            });

            this.add_child(this._searchEntry);

            const filterBar = new St.BoxLayout({
                style_class: 'clipmaster-filter-bar',
                x_expand: true
            });

            this._allButton = new St.Button({
                style_class: 'clipmaster-filter-button active',
                label: _('All'),
                can_focus: false
            });
            this._allButton.connect('clicked', () => { this._setFilter(null); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._allButton);

            this._favButton = new St.Button({
                style_class: 'clipmaster-filter-button',
                child: new St.Icon({ icon_name: 'starred-symbolic', icon_size: 14 }),
                can_focus: false
            });
            this._favButton.connect('clicked', () => { this._setFilter(-1); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._favButton);

            this._textButton = new St.Button({
                style_class: 'clipmaster-filter-button',
                label: _('Text'),
                can_focus: false
            });
            this._textButton.connect('clicked', () => { this._setFilter(null, ItemType.TEXT); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._textButton);

            this._imageButton = new St.Button({
                style_class: 'clipmaster-filter-button',
                label: _('Images'),
                can_focus: false
            });
            this._imageButton.connect('clicked', () => { this._setFilter(null, ItemType.IMAGE); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._imageButton);

            this._urlButton = new St.Button({
                style_class: 'clipmaster-filter-button',
                label: _('URLs'),
                can_focus: false
            });
            this._urlButton.connect('clicked', () => { this._setFilter(null, ItemType.URL); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._urlButton);

            this._codeButton = new St.Button({
                style_class: 'clipmaster-filter-button',
                label: '</>',
                can_focus: false
            });
            this._codeButton.connect('clicked', () => { this._setFilter(null, ItemType.CODE); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._codeButton);

            // Pinned list buttons container (separate row)
            this._pinnedListButtons = [];
            this._pinnedBar = new St.BoxLayout({
                style_class: 'clipmaster-pinned-bar',
                x_expand: true,
                visible: false  // Hidden initially, shown when there are pinned lists
            });

            this._listsButton = new St.Button({
                style_class: 'clipmaster-filter-button',
                label: _('Lists ▾'),
                can_focus: false
            });
            this._listsButton.connect('clicked', () => { this._showListsMenu(); return Clutter.EVENT_STOP; });
            filterBar.add_child(this._listsButton);

            // Store filterBar reference for later updates
            this._filterBar = filterBar;

            this.add_child(filterBar);
            this.add_child(this._pinnedBar);

            // Initial refresh of pinned lists
            this._refreshPinnedLists();

            this._scrollView = new St.ScrollView({
                style_class: 'clipmaster-scroll',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true
            });

            this._itemsBox = new St.BoxLayout({
                style_class: 'clipmaster-items',
                vertical: true,
                x_expand: true
            });

            this._scrollView.add_child(this._itemsBox);
            this.add_child(this._scrollView);

            const footer = new St.BoxLayout({
                style_class: 'clipmaster-footer',
                x_expand: true
            });

            const shortcutText = new St.Label({
                text: '↑↓ Nav • Enter Paste • Alt+F Fav • Alt+T Text • Alt+P Pin • Alt+D Del • Esc',
                style_class: 'clipmaster-footer-text',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER
            });
            footer.add_child(shortcutText);

            this.add_child(footer);
        }

        _showCreateListDialog() {
            debugLog('_showCreateListDialog called');
            const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });

            const label = new St.Label({
                text: _('Create New List'),
                style_class: 'clipmaster-dialog-title'
            });
            dialog.contentLayout.add_child(label);

            const entry = new St.Entry({
                style_class: 'clipmaster-dialog-entry',
                hint_text: _('List name...'),
                can_focus: true
            });
            dialog.contentLayout.add_child(entry);

            dialog.addButton({
                label: _('Cancel'),
                action: () => {
                    debugLog('Dialog cancelled');
                    dialog.close();
                },
                key: Clutter.KEY_Escape
            });

            dialog.addButton({
                label: _('Create'),
                action: () => {
                    const name = entry.get_text().trim();
                    debugLog(`Creating list with name: ${name}`);
                    if (name) {
                        const listId = this._database.createList(name);
                        debugLog(`List created with ID: ${listId}`);
                        this._loadItems();
                        Main.notify('ClipMaster', _('List created successfully'));
                    } else {
                        debugLog('List name is empty');
                    }
                    dialog.close();
                },
                default: true
            });

            debugLog('Opening dialog...');
            dialog.open();
            entry.grab_key_focus();
        }

        _showListsMenu() {
            const lists = this._database.getLists();

            if (lists.length === 0) {
                Main.notify('ClipMaster', _('No custom lists. Click + to create one.'));
                return;
            }

            const menu = new PopupMenu.PopupMenu(this._listsButton, 0.0, St.Side.TOP);
            const pinnedLists = this._settings.get_strv('pinned-lists') || [];

            lists.forEach(list => {
                const menuItem = new PopupMenu.PopupMenuItem(list.name);
                menuItem.connect('activate', () => {
                    this._setFilter(list.id);
                });

                // Pin/Unpin button
                const isPinned = pinnedLists.includes(String(list.id));
                const pinButton = new St.Button({
                    style_class: 'clipmaster-list-pin-button',
                    child: new St.Icon({
                        icon_name: isPinned ? 'starred-symbolic' : 'non-starred-symbolic',
                        icon_size: 14
                    }),
                    can_focus: false,
                    reactive: true
                });
                pinButton.connect('button-press-event', (actor, event) => {
                    if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

                    const currentPinned = this._settings.get_strv('pinned-lists') || [];
                    const listIdStr = String(list.id);

                    if (currentPinned.includes(listIdStr)) {
                        // Unpin
                        const newPinned = currentPinned.filter(id => id !== listIdStr);
                        this._settings.set_strv('pinned-lists', newPinned);
                        pinButton.child.icon_name = 'non-starred-symbolic';
                    } else {
                        // Pin (no limit - will show in separate row)
                        currentPinned.push(listIdStr);
                        this._settings.set_strv('pinned-lists', currentPinned);
                        pinButton.child.icon_name = 'starred-symbolic';
                    }

                    // Refresh pinned list buttons
                    this._refreshPinnedLists();
                    return Clutter.EVENT_STOP;
                });
                menuItem.add_child(pinButton);

                const deleteButton = new St.Button({
                    style_class: 'clipmaster-list-delete-button',
                    child: new St.Icon({
                        icon_name: 'edit-delete-symbolic',
                        icon_size: 14
                    }),
                    can_focus: false
                });
                deleteButton.connect('clicked', () => {
                    const listName = list.name;
                    menu.close();
                    this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._showConfirmDialog(
                            _('Are you sure you want to delete the list "%s"? This action cannot be undone.').format(listName),
                            () => {
                                // Also remove from pinned if pinned
                                const pinned = this._settings.get_strv('pinned-lists') || [];
                                const newPinned = pinned.filter(id => id !== String(list.id));
                                this._settings.set_strv('pinned-lists', newPinned);

                                debugLog(`Deleting list: ${listName} (ID: ${list.id})`);
                                this._database.deleteList(list.id);
                                this._refreshPinnedLists();
                                this._loadItems();
                                Main.notify('ClipMaster', _('List deleted'));
                            }
                        );
                        return GLib.SOURCE_REMOVE;
                    }, 'confirm-dialog-delay-list');
                    return Clutter.EVENT_STOP;
                });

                menuItem.add_child(deleteButton);
                menu.addMenuItem(menuItem);
            });

            Main.uiGroup.add_child(menu.actor);
            menu.open();

            menu.connect('open-state-changed', (menu, open) => {
                if (!open) menu.destroy();
            });
        }

        _refreshPinnedLists() {
            // Remove old pinned list buttons
            for (const btn of this._pinnedListButtons) {
                if (btn.get_parent()) {
                    btn.get_parent().remove_child(btn);
                }
                btn.destroy();
            }
            this._pinnedListButtons = [];

            // Get pinned list IDs
            const pinnedIds = this._settings.get_strv('pinned-lists') || [];

            // Hide bar if no pinned lists
            if (pinnedIds.length === 0) {
                this._pinnedBar.visible = false;
                return;
            }

            // Get lists from database
            const allLists = this._database.getLists();
            const listsMap = new Map(allLists.map(l => [String(l.id), l]));

            // Create buttons for all pinned lists
            let validPinnedCount = 0;
            pinnedIds.forEach(listIdStr => {
                const list = listsMap.get(listIdStr);
                if (!list) return; // List was deleted

                validPinnedCount++;

                const btn = new St.Button({
                    style_class: 'clipmaster-filter-button clipmaster-pinned-list',
                    label: list.name.length > 10 ? list.name.substring(0, 10) + '…' : list.name,
                    can_focus: false
                });
                btn._listId = list.id;

                btn.connect('clicked', () => {
                    this._setFilter(list.id);
                    return Clutter.EVENT_STOP;
                });

                this._pinnedListButtons.push(btn);
                this._pinnedBar.add_child(btn);
            });

            // Show bar only if there are valid pinned lists
            this._pinnedBar.visible = validPinnedCount > 0;
        }

        _startDrag(event) {
            debugLog(`_startDrag called`);

            // Don't start drag if not showing
            if (!this._isShowing || !this.visible) {
                debugLog('Not starting drag - popup not showing');
                return;
            }

            this._dragging = true;
            [this._dragStartX, this._dragStartY] = event.get_coords();
            [this._dragStartPosX, this._dragStartPosY] = this.get_position();
            this._lastDragUpdate = 0;  // Throttle timestamp

            debugLog(`Drag start coords: (${this._dragStartX}, ${this._dragStartY})`);
            debugLog(`Popup position: (${this._dragStartPosX}, ${this._dragStartPosY})`);

            if (isNaN(this._dragStartX) || isNaN(this._dragStartY) ||
                isNaN(this._dragStartPosX) || isNaN(this._dragStartPosY)) {
                debugLog(`Invalid drag coords, cancelling`);
                this._dragging = false;
                return;
            }

            debugLog(`Connecting motion-event to global.stage`);
            this._signalManager.connect(
                global.stage,
                'motion-event',
                (actor, motionEvent) => {
                    // Safety check - don't process if not dragging or popup hidden
                    if (!this._dragging || !this._isShowing || !this.visible) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    // Throttle updates to ~60fps (16ms) for smoother performance
                    const now = Date.now();
                    if (now - this._lastDragUpdate < 16) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                    this._lastDragUpdate = now;

                    const [currentX, currentY] = motionEvent.get_coords();
                    if (isNaN(currentX) || isNaN(currentY)) return Clutter.EVENT_PROPAGATE;

                    const newX = Math.round(this._dragStartPosX + (currentX - this._dragStartX));
                    const newY = Math.round(this._dragStartPosY + (currentY - this._dragStartY));

                    if (!isNaN(newX) && !isNaN(newY)) {
                        this.set_position(newX, newY);
                    }

                    // Propagate event to not block other input
                    return Clutter.EVENT_PROPAGATE;
                },
                'drag-motion'
            );

            this._signalManager.connect(
                global.stage,
                'button-release-event',
                () => {
                    debugLog(`Drag released`);
                    this._stopDrag();
                    // Don't block the release event
                    return Clutter.EVENT_PROPAGATE;
                },
                'drag-release'
            );

            debugLog(`Drag setup complete using SignalManager`);
        }

        _stopDrag() {
            this._dragging = false;
            if (this._signalManager) {
                this._signalManager.disconnect('drag-motion');
                this._signalManager.disconnect('drag-release');
            }
        }

        _connectSignals() {
            this.connect('key-press-event', this._onKeyPress.bind(this));
        }

        _onButtonHover(button) {
            if (button.hover && button._tooltipText) {
                // Show tooltip
                this._tooltip.set_text(button._tooltipText);
                this._tooltip.visible = true;

                // Position tooltip below the button
                const [x, y] = button.get_transformed_position();
                const [bw, bh] = button.get_size();
                this._tooltip.set_position(Math.round(x), Math.round(y + bh + 4));
            } else {
                // Hide tooltip
                this._tooltip.visible = false;
            }
        }

        _createModalOverlay() {
            // not used - using simpler click detection
        }

        _removeModalOverlay() {
            this._stopDrag();
            // Note: click-outside-handler is now cleaned up in _cleanupAllGlobalHandlers()
        }

        _setupClickOutside() {
            this._signalManager.disconnect('click-outside-handler');
            this._signalManager.disconnect('focus-window-handler');

            debugLog('Setting up click outside handler');
            this._signalManager.connect(
                global.stage,
                'button-press-event',
                (actor, event) => {
                    // ALWAYS propagate if popup is not in a valid showing state
                    // This prevents blocking input when the handler hasn't been cleaned up
                    if (!this || this._signalManager === null) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    // Early exit checks - ALWAYS propagate if not showing
                    if (!this._isShowing || !this.visible) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    // Also check if popup is off-screen (hidden state)
                    const [posX, posY] = this.get_position();
                    if (posX < -1000 || posY < -1000) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    const timeSinceShow = Date.now() - this._showTime;
                    if (timeSinceShow < 1000) {
                        debugLog(`Ignoring click during grace period (${timeSinceShow}ms since show)`);
                        return Clutter.EVENT_PROPAGATE;
                    }

                    if (this._isPinned) {
                        debugLog(`Popup is pinned, ignoring outside click`);
                        return Clutter.EVENT_PROPAGATE;
                    }

                    const [clickX, clickY] = event.get_coords();
                    const [popupX, popupY] = this.get_position();
                    const [popupW, popupH] = this.get_size();

                    const isInside = clickX >= popupX && clickX <= popupX + popupW &&
                        clickY >= popupY && clickY <= popupY + popupH;

                    if (isInside) {
                        debugLog('Click is inside popup, allowing');
                        return Clutter.EVENT_PROPAGATE;
                    } else {
                        debugLog('Click is outside popup, closing');
                        if (this._extension && this._extension.hidePopup) {
                            this._extension.hidePopup();
                        }
                        // Don't block the click - let it through to the underlying window
                        // The popup will close but the click should still register
                        return Clutter.EVENT_PROPAGATE;
                    }
                },
                'click-outside-handler'
            );

            // Also close popup when user focuses another window (clicking on Firefox, etc.)
            this._signalManager.connect(
                global.display,
                'notify::focus-window',
                () => {
                    // Safety checks
                    if (!this._isShowing || !this.visible || this._isPinned) {
                        return;
                    }

                    const timeSinceShow = Date.now() - this._showTime;
                    if (timeSinceShow < 500) {
                        debugLog(`Ignoring focus change during grace period (${timeSinceShow}ms since show)`);
                        return;
                    }

                    const focusedWindow = global.display.focus_window;
                    if (focusedWindow) {
                        debugLog(`Focus changed to window: ${focusedWindow.get_title()}, closing popup`);
                        if (this._extension && this._extension.hidePopup) {
                            this._extension.hidePopup();
                        }
                    }
                },
                'focus-window-handler'
            );
        }

        _showConfirmDialog(message, onConfirm) {
            debugLog('_showConfirmDialog called');
            const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });

            const messageLabel = new St.Label({
                text: message,
                style_class: 'clipmaster-confirm-dialog-message'
            });
            messageLabel.clutter_text.set_line_wrap(true);
            messageLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
            messageLabel.set_width(400);

            dialog.contentLayout.add_child(messageLabel);

            dialog.addButton({
                label: _('Cancel'),
                action: () => {
                    debugLog('Delete dialog cancelled');
                    dialog.close();
                },
                key: Clutter.KEY_Escape
            });

            dialog.addButton({
                label: _('Delete'),
                action: () => {
                    debugLog('Delete confirmed');
                    dialog.close();
                    if (onConfirm) {
                        onConfirm();
                    }
                },
                default: true
            });

            debugLog('Opening delete confirmation dialog...');
            dialog.open();
        }

        _setFilter(listId, type = null) {
            this._currentListId = listId;
            this._currentType = type;

            // Clear active state from all buttons including pinned lists
            [this._allButton, this._favButton, this._textButton, this._imageButton, this._urlButton, this._codeButton, this._listsButton].forEach(b => {
                if (b) b.remove_style_class_name('active');
            });
            // Also clear pinned list buttons
            for (const btn of this._pinnedListButtons) {
                btn.remove_style_class_name('active');
            }

            if (listId === -1) {
                this._favButton.add_style_class_name('active');
            } else if (type === ItemType.TEXT) {
                this._textButton.add_style_class_name('active');
            } else if (type === ItemType.IMAGE) {
                this._imageButton.add_style_class_name('active');
            } else if (type === ItemType.URL) {
                this._urlButton.add_style_class_name('active');
            } else if (type === ItemType.CODE) {
                this._codeButton.add_style_class_name('active');
            } else if (listId !== null && listId > 0) {
                // Check if it's a pinned list or regular list
                const pinnedBtn = this._pinnedListButtons.find(b => b._listId === listId);
                if (pinnedBtn) {
                    pinnedBtn.add_style_class_name('active');
                } else {
                    this._listsButton.add_style_class_name('active');
                }
            } else {
                this._allButton.add_style_class_name('active');
            }

            this._loadItems();
        }

        show() {
            if (!this._isShowing) {
                return;
            }

            this._searchEntry.set_text('');
            this._searchQuery = '';
            this._selectedIndex = 0;
            this._currentListId = null;
            this._currentType = null;
            this._plainTextMode = false;

            this._loadItems();

            this.visible = true;
            this.opacity = 255;
            this.reactive = true;
            this._showTime = Date.now();

            debugLog(`Popup shown at ${this._showTime}`);

            // Remove old timeout before creating new one
            if (this._outsideClickTimeoutId) {
                this._timeoutManager.remove('click-outside-setup');
            }

            this._outsideClickTimeoutId = this._timeoutManager.add(
                GLib.PRIORITY_DEFAULT,
                100,
                () => {
                    if (this._isShowing && this.visible) {
                        debugLog('Setting up click outside handler after 100ms delay');
                        this._setupClickOutside();
                        this.grab_key_focus();
                    } else {
                        debugLog(`Not setting up click outside - isShowing=${this._isShowing}, visible=${this.visible}`);
                    }
                    return GLib.SOURCE_REMOVE;
                },
                'click-outside-setup'
            );
        }

        cancelClickOutside() {
            if (this._signalManager) {
                this._signalManager.disconnect('click-outside-handler');
                this._timeoutManager.remove('click-outside-setup');
                debugLog('Click outside handler cancelled');
            }
        }

        hide() {
            debugLog(`hide() called - _isPinned=${this._isPinned}, _isShowing=${this._isShowing}`);

            if (this._isPinned) {
                debugLog('Popup is pinned, not hiding');
                return;
            }

            this._isShowing = false;

            // Clean up ALL global stage handlers to prevent input blocking
            this._cleanupAllGlobalHandlers();

            this._removeModalOverlay();
            this.visible = false;
            this.opacity = 0;
            this.reactive = false;

            // Release shell key focus so the previously active app can receive paste shortcuts.
            if (global.stage?.get_key_focus?.()) {
                global.stage.set_key_focus(null);
            }

            // Move off-screen as safety measure
            this.set_position(-10000, -10000);

            debugLog('Popup hidden');
        }

        _cleanupAllGlobalHandlers() {
            if (this._signalManager) {
                // Disconnect all known global stage handlers
                this._signalManager.disconnect('click-outside-handler');
                this._signalManager.disconnect('focus-window-handler');
                this._signalManager.disconnect('drag-motion');
                this._signalManager.disconnect('drag-release');
                debugLog('All global handlers disconnected');
            }

            // Reset dragging state
            this._dragging = false;
        }

        dispose_resources() {
            // Prevent double disposal check not needed if we check properties


            // Force cleanup regardless of pin state
            this._isPinned = false;
            this._isShowing = false;
            this._dragging = false;

            // Clean up tooltip
            if (this._tooltip && this._tooltip.get_parent()) {
                this._tooltip.get_parent().remove_child(this._tooltip);
                this._tooltip.destroy();
                this._tooltip = null;
            }

            // Clean up item timeouts
            this._clearItemTimeouts();

            // Clean up all global handlers first
            this._cleanupAllGlobalHandlers();

            // Disconnect all signals BEFORE any destruction
            if (this._signalManager) {
                this._signalManager.disconnectAll();
                this._signalManager = null;
            }

            if (this._outsideClickTimeoutId) {
                this._timeoutManager.remove(this._outsideClickTimeoutId);
                this._outsideClickTimeoutId = null;
            }

            if (this._timeoutManager) {
                this._timeoutManager.removeAll();
                this._timeoutManager = null;
            }

            // Clean up interface settings
            if (this._interfaceSettings) {
                this._interfaceSettings = null;
            }

            this._removeModalOverlay();

            if (this._customStylesheet) {
                const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                theme.unload_stylesheet(this._customStylesheet);
                this._customStylesheet = null;
            }

            this._extension = null;
            this._settings = null;
            this._database = null;
            this._monitor = null;

            debugLog('Popup resources disposed');
        }

        destroy() {
            this._clearItemTimeouts();
            this.dispose_resources();
            super.destroy();
        }

        _clearItemTimeouts() {
            // Clear all paste-on-hover timeouts from item rows
            if (this._itemsBox) {
                const children = this._itemsBox.get_children();
                children.forEach(child => {
                    if (child._pasteTimeoutId) {
                        GLib.source_remove(child._pasteTimeoutId);
                        child._pasteTimeoutId = null;
                    }
                    if (child._pasteResetTimeoutId) {
                        GLib.source_remove(child._pasteResetTimeoutId);
                        child._pasteResetTimeoutId = null;
                    }
                });
            }
            debugLog('Item timeouts cleared');
        }

        _loadItems() {
            // Safety checks for disposed state
            if (!this._itemsBox || !this._database) return;

            this._itemsBox.destroy_all_children();

            const limit = this._settings.get_int('items-per-page');
            const options = {
                limit: limit,
                search: this._searchQuery || null,
                listId: this._currentListId,
                type: this._currentType
            };

            this._items = this._database.getItems(options);

            if (this._items.length === 0) {
                const emptyLabel = new St.Label({
                    text: _('No clipboard items'),
                    style_class: 'clipmaster-empty',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER
                });
                this._itemsBox.add_child(emptyLabel);
                return;
            }

            this._items.forEach((item, index) => {
                const row = this._createItemRow(item, index);
                this._itemsBox.add_child(row);
            });

            this._updateSelection();
        }

        _createItemRow(item, index) {
            const row = new St.BoxLayout({
                style_class: 'clipmaster-item',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: true
            });
            row._item = item;
            row._index = index;

            row.connect('button-press-event', (actor, event) => {
                debugLog(`Row ${index} button-press-event, button=${event.get_button()}`);
                if (event.get_button() === 1) {
                    if (row._pasteTimeoutId) {
                        debugLog(`Cancelling paste timeout for item ${index} (user clicked)`);
                        GLib.source_remove(row._pasteTimeoutId);
                        row._pasteTimeoutId = null;
                    }

                    this._selectedIndex = index;
                    this._updateSelection();
                    debugLog(`Single click on row ${index}, selecting and pasting...`);
                    this._pasteFromHover = false;
                    this._pasteSelected();
                    return Clutter.EVENT_STOP;
                } else if (event.get_button() === 3) {
                    this._selectedIndex = index;
                    this._updateSelection();
                    this._showContextMenu(item, row);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            row.connect('enter-event', (actor, event) => {
                debugLog(`ENTER EVENT on row ${index}`);
                this._selectedIndex = index;
                this._updateSelection();

                let pasteOnSelect = false;
                if (this._settings) {
                    pasteOnSelect = this._settings.get_boolean('paste-on-select');
                }

                debugLog(`Hover on item ${index}, paste-on-select=${pasteOnSelect}, visible=${this.visible}, isShowing=${this._isShowing}`);

                if (pasteOnSelect) {
                    // Clear existing timeout before creating new one
                    if (row._pasteTimeoutId) {
                        debugLog(`Cancelling existing paste timeout for row ${index}`);
                        GLib.source_remove(row._pasteTimeoutId);
                        row._pasteTimeoutId = null;
                    }
                    if (row._pasteResetTimeoutId) {
                        GLib.source_remove(row._pasteResetTimeoutId);
                        row._pasteResetTimeoutId = null;
                    }

                    debugLog(`Setting up paste timeout for row ${index} (500ms delay)`);
                    row._pasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        debugLog(`Paste timeout fired for row ${index} - checking conditions...`);
                        debugLog(`  selectedIndex=${this._selectedIndex}, index=${index}, visible=${this.visible}, isShowing=${this._isShowing}`);

                        if (this._selectedIndex === index && this.visible && this._isShowing) {
                            debugLog(`✓ Conditions met - PASTING item ${index} (from paste-on-select hover)`);
                            this._pasteFromHover = true;
                            this._pasteSelected();
                            // Clear any existing reset timeout before creating new one
                            if (row._pasteResetTimeoutId) {
                                GLib.source_remove(row._pasteResetTimeoutId);
                                row._pasteResetTimeoutId = null;
                            }
                            row._pasteResetTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                                this._pasteFromHover = false;
                                row._pasteResetTimeoutId = null;
                                return GLib.SOURCE_REMOVE;
                            });
                        } else {
                            debugLog(`✗ Conditions NOT met - NOT pasting`);
                        }
                        row._pasteTimeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    debugLog(`Paste on select is DISABLED, not setting timeout`);
                }
            });

            row.connect('leave-event', (actor, event) => {
                debugLog(`LEAVE EVENT on row ${index}`);
                if (row._pasteTimeoutId) {
                    debugLog(`Cancelling paste timeout for item ${index} (user left row)`);
                    GLib.source_remove(row._pasteTimeoutId);
                    row._pasteTimeoutId = null;
                }
                if (row._pasteResetTimeoutId) {
                    GLib.source_remove(row._pasteResetTimeoutId);
                    row._pasteResetTimeoutId = null;
                }
            });

            if (index < 9) {
                const numLabel = new St.Label({
                    text: (index + 1).toString(),
                    style_class: 'clipmaster-item-number'
                });
                row.add_child(numLabel);
            } else {
                const spacer = new St.Widget({ width: 24 });
                row.add_child(spacer);
            }

            const iconName = this._getTypeIcon(item.type);
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 16,
                style_class: 'clipmaster-item-icon'
            });
            row.add_child(icon);

            const contentBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'clipmaster-item-content'
            });

            if (item.title) {
                const titleLabel = new St.Label({
                    text: item.title,
                    style_class: 'clipmaster-item-title',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.START
                });
                titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                contentBox.add_child(titleLabel);
            }

            let previewText = item.preview || item.plainText || item.content || '';
            if (item.type === ItemType.IMAGE) {
                const size = item.metadata?.size ? ` (${Math.round(item.metadata.size / 1024)}KB)` : '';
                const dimensions = (item.metadata?.width && item.metadata?.height)
                    ? ` ${item.metadata.width}×${item.metadata.height}` : '';
                previewText = `🖼️ Image${dimensions}${size}`;

                // Try to show thumbnail - from dedicated thumbnail field OR from base64 content (legacy)
                let thumbBase64 = item.thumbnail;

                // Fallback: If no thumbnail but content is base64 (legacy format), use it directly
                if (!thumbBase64 && item.metadata?.storedAs === 'base64' && item.content) {
                    thumbBase64 = item.content;
                }

                if (thumbBase64) {
                    try {
                        const thumbData = GLib.base64_decode(thumbBase64);
                        const bytes = new GLib.Bytes(thumbData);
                        const gicon = Gio.BytesIcon.new(bytes);

                        const thumbIcon = new St.Icon({
                            gicon: gicon,
                            icon_size: 48,
                            style_class: 'clipmaster-thumbnail',
                            x_align: Clutter.ActorAlign.START,
                            y_align: Clutter.ActorAlign.CENTER
                        });

                        contentBox.add_child(thumbIcon);
                    } catch (e) {
                        debugLog(`Failed to render thumbnail: ${e.message}`);
                    }
                }
            }

            const previewLength = this._settings.get_int('preview-length');
            if (previewText.length > previewLength) {
                previewText = previewText.substring(0, previewLength) + '...';
            }
            previewText = previewText.replace(/\n/g, ' ').trim();

            const previewLabel = new St.Label({
                text: previewText,
                style_class: item.title ? 'clipmaster-item-preview dim' : 'clipmaster-item-preview',
                x_expand: true,
                x_align: Clutter.ActorAlign.START
            });
            previewLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            contentBox.add_child(previewLabel);

            if (item.created) {
                const date = new Date(item.created);
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                let timeText = '';
                if (diffMins < 1) {
                    timeText = _('Just now');
                } else if (diffMins < 60) {
                    timeText = `${diffMins} ${diffMins === 1 ? _('min') : _('mins')} ago`;
                } else if (diffHours < 24) {
                    timeText = `${diffHours} ${diffHours === 1 ? _('hour') : _('hours')} ago`;
                } else if (diffDays < 7) {
                    timeText = `${diffDays} ${diffDays === 1 ? _('day') : _('days')} ago`;
                } else {
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    const hours = String(date.getHours()).padStart(2, '0');
                    const mins = String(date.getMinutes()).padStart(2, '0');
                    timeText = `${day}.${month}.${year} ${hours}:${mins}`;
                }

                const timeLabel = new St.Label({
                    text: timeText,
                    style_class: 'clipmaster-item-time',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.START
                });
                contentBox.add_child(timeLabel);
            }

            row.add_child(contentBox);

            // QR button for TEXT and URL items
            if ((item.type === ItemType.TEXT || item.type === ItemType.URL) &&
                QrCodeGenerator.canEncode(item.content || item.plainText)) {
                const qrButton = new St.Button({
                    style_class: 'clipmaster-qr-button',
                    can_focus: false,
                    reactive: true,
                    track_hover: true
                });

                const qrIcon = new St.Icon({
                    icon_name: 'view-grid-symbolic',
                    icon_size: 14,
                    style_class: 'clipmaster-item-qr'
                });
                qrButton.set_child(qrIcon);

                qrButton.connect('button-press-event', (actor, event) => {
                    if (event.get_button() === 1) {
                        this._showQrDialog(item);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                row.add_child(qrButton);
            }

            const favButton = new St.Button({
                style_class: 'clipmaster-fav-button',
                can_focus: false,
                reactive: true,
                track_hover: true
            });

            const favIcon = new St.Icon({
                icon_name: item.isFavorite ? 'starred-symbolic' : 'non-starred-symbolic',
                icon_size: 16,
                style_class: item.isFavorite ? 'clipmaster-item-fav' : 'clipmaster-item-fav-inactive'
            });
            favButton.set_child(favIcon);

            favButton.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    const newFavoriteState = this._database.toggleFavorite(item.id);
                    favIcon.icon_name = newFavoriteState ? 'starred-symbolic' : 'non-starred-symbolic';
                    favIcon.style_class = newFavoriteState ? 'clipmaster-item-fav' : 'clipmaster-item-fav-inactive';
                    this._loadItems();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            row.add_child(favButton);

            return row;
        }

        _getTypeIcon(type) {
            const icons = {
                [ItemType.TEXT]: 'text-x-generic-symbolic',
                [ItemType.HTML]: 'text-html-symbolic',
                [ItemType.IMAGE]: 'image-x-generic-symbolic',
                [ItemType.FILE]: 'folder-documents-symbolic',
                [ItemType.URL]: 'web-browser-symbolic',
                [ItemType.COLOR]: 'color-select-symbolic'
            };
            return icons[type] || 'text-x-generic-symbolic';
        }

        _updateSelection() {
            if (!this._itemsBox) return;

            const children = this._itemsBox.get_children();
            children.forEach((child, index) => {
                if (child._index !== undefined) {
                    if (index === this._selectedIndex) {
                        child.add_style_class_name('selected');
                    } else {
                        child.remove_style_class_name('selected');
                    }
                }
            });
        }

        async _pasteSelected() {
            debugLog(`=== _pasteSelected() CALLED ===`);
            debugLog(`Items length: ${this._items.length}, selectedIndex: ${this._selectedIndex}`);

            if (this._items.length === 0 || this._selectedIndex >= this._items.length) {
                debugLog(`✗ _pasteSelected: No items or invalid index (${this._selectedIndex}/${this._items.length})`);
                return;
            }

            const item = this._items[this._selectedIndex];
            debugLog(`✓ _pasteSelected: Pasting item ${item.id} (type: ${item.type})`);
            debugLog(`  Item preview: ${item.preview ? item.preview.substring(0, 50) : 'no preview'}`);

            if (item.type === ItemType.IMAGE && item.content) {
                debugLog(`Copying image to clipboard: ${item.content}`);
                await this._monitor.copyImageToClipboard(item.content);
            } else {
                const content = this._plainTextMode ? item.plainText : item.content;
                debugLog(`Copying text to clipboard (plainText=${this._plainTextMode}): ${content ? content.substring(0, 50) : 'null'}...`);
                this._monitor.copyToClipboard(content, this._plainTextMode);
            }

            this._database.updateItem(item.id, {
                lastUsed: Date.now(),
                useCount: (item.useCount || 1) + 1
            });

            let closeOnPaste = false;
            if (this._settings) {
                closeOnPaste = this._settings.get_boolean('close-on-paste');
            }

            const isFromHover = this._pasteFromHover || false;
            debugLog(`close-on-paste=${closeOnPaste}, _isPinned=${this._isPinned}, isFromHover=${isFromHover}`);

            if (closeOnPaste && !this._isPinned && !isFromHover) {
                this._extension.queueAutoPasteForSelection();
                debugLog(`Closing popup after paste (close-on-paste=true, not pinned, explicit click)`);
                this._extension.hidePopup();
            } else {
                debugLog(`NOT closing popup (close-on-paste=${closeOnPaste}, pinned=${this._isPinned}, isFromHover=${isFromHover})`);
            }

            debugLog(`=== _pasteSelected() COMPLETED ===`);
        }

        _showContextMenu(item, row) {
            const menu = new PopupMenu.PopupMenu(row, 0.0, St.Side.TOP);

            menu.addAction(_('Edit Title...'), () => {
                this._showEditDialog(item, 'title');
            });

            if (item.type === ItemType.TEXT || item.type === ItemType.URL) {
                menu.addAction(_('Edit Content...'), () => {
                    this._showEditDialog(item, 'content');
                });
            }

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const favLabel = item.isFavorite ? _('Remove from Favorites') : _('Add to Favorites');
            menu.addAction(favLabel, () => {
                this._database.toggleFavorite(item.id);
                this._loadItems();
            });

            const lists = this._database.getLists();
            if (lists.length > 0) {
                const listSubmenu = new PopupMenu.PopupSubMenuMenuItem(_('Add to List'));
                lists.forEach(list => {
                    listSubmenu.menu.addAction(list.name, () => {
                        this._database.addItemToList(item.id, list.id);
                        this._loadItems();
                    });
                });
                menu.addMenuItem(listSubmenu);
            }

            // QR Code share option for text/URL items
            if ((item.type === ItemType.TEXT || item.type === ItemType.URL) &&
                QrCodeGenerator.canEncode(item.content || item.plainText)) {
                menu.addAction(_('Share as QR Code'), () => {
                    menu.close();
                    this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._showQrDialog(item);
                        return GLib.SOURCE_REMOVE;
                    }, 'qr-dialog-delay');
                });
            }

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            menu.addAction(_('Delete'), () => {
                const itemPreview = item.preview || item.plainText || _('this item');
                const previewText = itemPreview.length > 50 ? itemPreview.substring(0, 50) + '...' : itemPreview;
                menu.close();
                this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._showConfirmDialog(
                        _('Are you sure you want to delete "%s"? This action cannot be undone.').format(previewText),
                        () => {
                            this._database.deleteItem(item.id);
                            this._loadItems();
                        }
                    );
                    return GLib.SOURCE_REMOVE;
                }, 'confirm-dialog-delay');
            });

            Main.uiGroup.add_child(menu.actor);
            menu.open();

            menu.connect('open-state-changed', (menu, open) => {
                if (!open) {
                    menu.destroy();
                }
            });
        }

        _showEditDialog(item, field) {
            const dialog = new ModalDialog.ModalDialog({
                styleClass: 'clipmaster-dialog'
            });

            const title = field === 'title' ? _('Edit Title') : _('Edit Content');
            const label = new St.Label({
                text: title,
                style_class: 'clipmaster-dialog-title'
            });
            dialog.contentLayout.add_child(label);

            const entry = new St.Entry({
                style_class: 'clipmaster-dialog-entry',
                text: item[field] || '',
                can_focus: true
            });
            dialog.contentLayout.add_child(entry);

            dialog.addButton({
                label: _('Cancel'),
                action: () => dialog.close(),
                key: Clutter.KEY_Escape
            });

            dialog.addButton({
                label: _('Save'),
                action: () => {
                    const newValue = entry.get_text();
                    const updates = {};
                    updates[field] = newValue;

                    if (field === 'content') {
                        updates.plainText = newValue;
                        updates.preview = newValue.substring(0, 200);
                    }

                    this._database.updateItem(item.id, updates);
                    this._loadItems();
                    dialog.close();
                },
                default: true
            });

            dialog.open();
            entry.grab_key_focus();
        }

        _showQrDialog(item) {
            const text = item.content || item.plainText || '';

            if (!QrCodeGenerator.canEncode(text)) {
                Main.notify(_('ClipMaster'), _('Text too long for QR code (max 2000 chars)'));
                return;
            }

            const dialog = new ModalDialog.ModalDialog({
                styleClass: 'clipmaster-dialog clipmaster-qr-dialog'
            });

            const titleLabel = new St.Label({
                text: _('QR Code'),
                style_class: 'clipmaster-dialog-title',
                x_align: Clutter.ActorAlign.CENTER
            });
            dialog.contentLayout.add_child(titleLabel);

            try {
                // Generate QR code
                const { size, modules } = QrCodeGenerator.generate(text, QrEcc.MEDIUM);

                // Create visual QR code using St.DrawingArea or grid of boxes
                const qrSize = 200;
                const cellSize = Math.floor(qrSize / (size + 4)); // +4 for border
                const actualSize = cellSize * (size + 4);

                const qrContainer = new St.Widget({
                    style_class: 'clipmaster-qr-container',
                    width: actualSize,
                    height: actualSize,
                    x_align: Clutter.ActorAlign.CENTER
                });

                // Draw QR code as colored boxes
                for (let y = 0; y < size; y++) {
                    for (let x = 0; x < size; x++) {
                        if (modules[y][x]) {
                            const cell = new St.Widget({
                                style: `background-color: #000000;`,
                                width: cellSize,
                                height: cellSize,
                                x: (x + 2) * cellSize,
                                y: (y + 2) * cellSize
                            });
                            qrContainer.add_child(cell);
                        }
                    }
                }

                dialog.contentLayout.add_child(qrContainer);

                // Show text preview
                const previewText = text.length > 50 ? text.substring(0, 50) + '...' : text;
                const previewLabel = new St.Label({
                    text: previewText,
                    style_class: 'clipmaster-qr-preview',
                    x_align: Clutter.ActorAlign.CENTER
                });
                dialog.contentLayout.add_child(previewLabel);

                // Show character count
                const countLabel = new St.Label({
                    text: `${text.length} ${_('characters')}`,
                    style_class: 'clipmaster-qr-count',
                    x_align: Clutter.ActorAlign.CENTER
                });
                dialog.contentLayout.add_child(countLabel);

            } catch (e) {
                const errorLabel = new St.Label({
                    text: _('Failed to generate QR code: ') + e.message,
                    style_class: 'clipmaster-dialog-message'
                });
                dialog.contentLayout.add_child(errorLabel);
                debugLog(`QR generation error: ${e.message}`);
            }

            dialog.setButtons([{
                label: _('Close'),
                action: () => dialog.close(),
                default: true
            }]);

            dialog.open();
        }

        _onKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            const searchHasFocus = this._searchEntry.clutter_text.has_key_focus();

            if (symbol === Clutter.KEY_Escape) {
                this._extension.hidePopup();
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_KP_Up) {
                if (this._selectedIndex > 0) {
                    this._selectedIndex--;
                    this._updateSelection();
                    this._scrollToSelected();
                }
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_KP_Down) {
                if (this._selectedIndex < this._items.length - 1) {
                    this._selectedIndex++;
                    this._updateSelection();
                    this._scrollToSelected();
                }
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._pasteSelected();
                return Clutter.EVENT_STOP;
            }

            const hasAlt = event.get_state() & Clutter.ModifierType.MOD1_MASK;

            if (hasAlt) {
                if (symbol === Clutter.KEY_p || symbol === Clutter.KEY_P) {
                    this._isPinned = !this._isPinned;
                    if (this._isPinned) {
                        this._pinButton.add_style_pseudo_class('checked');
                    } else {
                        this._pinButton.remove_style_pseudo_class('checked');
                    }
                    debugLog(`Pin toggled via Alt+P: ${this._isPinned}`);
                    return Clutter.EVENT_STOP;
                }

                if (symbol === Clutter.KEY_t || symbol === Clutter.KEY_T) {
                    this._plainTextMode = !this._plainTextMode;
                    if (this._plainTextMode) {
                        this._plainTextButton.add_style_pseudo_class('checked');
                    } else {
                        this._plainTextButton.remove_style_pseudo_class('checked');
                    }
                    debugLog(`Plain text mode via Alt+T: ${this._plainTextMode}`);
                    return Clutter.EVENT_STOP;
                }

                if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F) {
                    if (this._items.length > 0 && this._selectedIndex < this._items.length) {
                        this._database.toggleFavorite(this._items[this._selectedIndex].id);
                        this._loadItems();
                    }


                    return Clutter.EVENT_STOP;
                }

                if (symbol === Clutter.KEY_d || symbol === Clutter.KEY_D) {
                    if (this._items.length > 0 && this._selectedIndex < this._items.length) {
                        const item = this._items[this._selectedIndex];
                        const itemPreview = item.preview || item.plainText || _('this item');
                        const previewText = itemPreview.length > 50 ? itemPreview.substring(0, 50) + '...' : itemPreview;
                        this._showConfirmDialog(
                            _('Are you sure you want to delete "%s"? This action cannot be undone.').format(previewText),
                            () => {
                                this._database.deleteItem(item.id);
                                this._loadItems();
                            }
                        );
                    }
                    debugLog(`Delete via Alt+D`);
                    return Clutter.EVENT_STOP;
                }
            }

            if (symbol === Clutter.KEY_Delete) {
                if (this._items.length > 0 && this._selectedIndex < this._items.length) {
                    const item = this._items[this._selectedIndex];
                    const itemPreview = item.preview || item.plainText || _('this item');
                    const previewText = itemPreview.length > 50 ? itemPreview.substring(0, 50) + '...' : itemPreview;
                    this._showConfirmDialog(
                        _('Are you sure you want to delete "%s"? This action cannot be undone.').format(previewText),
                        () => {
                            this._database.deleteItem(item.id);
                            this._loadItems();
                        }
                    );
                }
                return Clutter.EVENT_STOP;
            }

            if (!searchHasFocus) {
                if (!hasAlt && symbol >= Clutter.KEY_1 && symbol <= Clutter.KEY_9) {
                    const index = symbol - Clutter.KEY_1;
                    if (index < this._items.length) {
                        this._selectedIndex = index;
                        this._pasteSelected();
                    }
                    return Clutter.EVENT_STOP;
                }

                const unicode = event.get_key_unicode();
                if (unicode && unicode.match(/^[a-zA-Z0-9\s\-_\.@#$%&*()+=\[\]{}|\\:;"'<>,?/~`]$/)) {
                    this._searchEntry.grab_key_focus();
                    const currentText = this._searchEntry.get_text();
                    this._searchEntry.set_text(currentText + unicode);
                    this._searchEntry.clutter_text.set_cursor_position(-1);
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        _scrollToSelected() {
            if (this._selectedIndex < 0 || !this._itemsBox || !this._scrollView) return;

            const children = this._itemsBox.get_children();
            if (this._selectedIndex >= children.length) return;

            // Calculate the y position by summing heights of all children before the selected one
            let childY = 0;
            for (let i = 0; i < this._selectedIndex; i++) {
                childY += children[i].height;
            }

            const child = children[this._selectedIndex];
            const childHeight = child.height;
            const childBottom = childY + childHeight;

            // Try vadjustment first, then vscroll.adjustment for compatibility
            let vadjustment = this._scrollView.vadjustment;
            if (!vadjustment && this._scrollView.vscroll) {
                vadjustment = this._scrollView.vscroll.adjustment;
            }
            if (!vadjustment) {
                debugLog('ERROR: No vadjustment found');
                return;
            }

            const scrollValue = vadjustment.value;
            const pageSize = vadjustment.page_size;
            const scrollBottom = scrollValue + pageSize;

            debugLog(`Scroll: idx=${this._selectedIndex}, childY=${childY}, childH=${childHeight}, scroll=${scrollValue}, page=${pageSize}`);

            // Scroll up if child is above visible area
            if (childY < scrollValue) {
                vadjustment.set_value(childY);
                debugLog(`Scrolled UP to ${childY}`);
            }
            // Scroll down if child is below visible area
            else if (childBottom > scrollBottom) {
                vadjustment.set_value(childBottom - pageSize);
                debugLog(`Scrolled DOWN to ${childBottom - pageSize}`);
            }
        }
    });
