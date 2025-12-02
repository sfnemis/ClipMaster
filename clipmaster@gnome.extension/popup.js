/**
 * ClipMaster - Clipboard Popup UI
 * Main popup interface for clipboard management
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SignalManager, TimeoutManager } from './utils.js';
import { ItemType, debugLog } from './constants.js';

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
            opacity: 0,  // Start fully transparent!
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
        this._isPinned = false;  // Pin state - keeps popup open on outside click
        this._isShowing = false;  // Track if popup is intentionally shown
        this._showTime = 0;  // Track when popup was shown (for grace period)
        this._pasteFromHover = false;  // Track if paste came from hover (paste-on-select)
        this._customStylesheet = null;  // Track custom theme stylesheet
        
        // Drag state
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPosX = 0;
        this._dragStartPosY = 0;
        
        // Modal overlay for click-outside detection
        this._modalOverlay = null;
        
        // Use utility managers for proper lifecycle management
        this._signalManager = new SignalManager();
        this._timeoutManager = new TimeoutManager();
        
        // Apply theme
        this._applyTheme();
        
        // Listen for theme changes using SignalManager
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
        
        this._buildUI();
        this._connectSignals();
    }
    
    _applyTheme() {
        try {
            // Remove all theme classes
            this.remove_style_class_name('light');
            this.remove_style_class_name('theme-catppuccin');
            this.remove_style_class_name('theme-dracula');
            this.remove_style_class_name('theme-nord');
            this.remove_style_class_name('theme-gruvbox');
            this.remove_style_class_name('theme-onedark');
            this.remove_style_class_name('theme-adwaita');
            this.remove_style_class_name('theme-monokai');
            this.remove_style_class_name('theme-solarized');
            this.remove_style_class_name('theme-tokyonight');
            this.remove_style_class_name('theme-rosepine');
            this.remove_style_class_name('theme-material');
            this.remove_style_class_name('theme-ayu');
            
            // Check for custom theme
            const customThemePath = this._settings.get_string('custom-theme-path') || '';
            if (customThemePath) {
                // Load custom theme
                const customFile = Gio.File.new_for_path(customThemePath);
                if (customFile.query_exists(null)) {
                    try {
                        // Unload previous custom theme if any
                        if (this._customStylesheet) {
                            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                            theme.unload_stylesheet(this._customStylesheet);
                        }
                        // Load new custom theme
                        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                        theme.load_stylesheet(customFile);
                        this._customStylesheet = customFile;
                    } catch (e) {
                        log(`ClipMaster: Error loading custom theme: ${e.message}`);
                    }
                }
            } else {
                // Unload custom theme if cleared
                if (this._customStylesheet) {
                    try {
                        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                        theme.unload_stylesheet(this._customStylesheet);
                        this._customStylesheet = null;
                    } catch (e) {
                        log(`ClipMaster: Error unloading custom theme: ${e.message}`);
                    }
                }
            }
            
            // Apply selected theme (only if no custom theme)
            if (!customThemePath) {
                const themeName = this._settings.get_string('theme') || 'gruvbox';
                this.add_style_class_name(`theme-${themeName}`);
            }
            
            // Also apply light/dark based on dark-theme setting (for backward compatibility)
            const isDark = this._settings.get_boolean('dark-theme');
            if (!isDark) {
                this.add_style_class_name('light');
            }
        } catch (e) {
            log(`ClipMaster: Theme error: ${e.message}`);
        }
    }
    
    _buildUI() {
        // Header
        this._header = new St.BoxLayout({
            style_class: 'clipmaster-header',
            x_expand: true,
            reactive: true
        });
        
        // ClipMaster icon (also serves as drag indicator)
        const headerIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(
                this._extension._extensionPath + '/icons/clipmaster-symbolic.svg'
            ),
            style_class: 'clipmaster-header-icon',
            icon_size: 18
        });
        this._header.add_child(headerIcon);
        
        // Title
        const title = new St.Label({
            text: 'ClipMaster',
            style_class: 'clipmaster-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START
        });
        this._header.add_child(title);
        
        // Plain text button - paste as plain text
        this._plainTextButton = new St.Button({
            style_class: 'clipmaster-toggle-button',
            child: new St.Icon({
                icon_name: 'text-x-generic-symbolic',
                icon_size: 16
            }),
            can_focus: false
        });
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
        
        // Pin button - keeps popup open when clicking outside
        this._pinButton = new St.Button({
            style_class: 'clipmaster-toggle-button',
            child: new St.Icon({
                icon_name: 'view-pin-symbolic',
                icon_size: 16
            }),
            can_focus: false
        });
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
        
        // Add List button
        this._addListButton = new St.Button({
            style_class: 'clipmaster-toggle-button',
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                icon_size: 16
            }),
            can_focus: false
        });
        this._addListButton.connect('button-press-event', () => {
            debugLog('Add list button pressed');
            this._showCreateListDialog();
            return Clutter.EVENT_STOP;
        });
        this._addListButton.connect('clicked', () => {
            debugLog('Add list button clicked');
            this._showCreateListDialog();
            return Clutter.EVENT_STOP;
        });
        this._header.add_child(this._addListButton);
        
        // Close button - CRITICAL: must stop event propagation
        this._closeButton = new St.Button({
            style_class: 'clipmaster-close-button',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 16
            }),
            can_focus: false  // Prevent focus stealing
        });
        this._closeButton.connect('button-press-event', () => {
            debugLog('Close button pressed');
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;
        });
        this._closeButton.connect('clicked', () => {
            debugLog('Close button clicked');
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;
        });
        this._header.add_child(this._closeButton);
        
        // Header drag - entire header is draggable
        this._header.connect('button-press-event', (actor, event) => {
            debugLog(`Header button-press-event triggered`);
            
            // Don't start drag if clicking on buttons
            try {
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
                
                // Check if clicking on buttons
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
            } catch (e) {
                debugLog(`Header drag error: ${e.message}`);
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        this.add_child(this._header);
        
        // Search bar
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
        this.add_child(this._searchEntry);
        
        // Filter bar
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
        
        // Lists dropdown
        this._listsButton = new St.Button({
            style_class: 'clipmaster-filter-button',
            label: _('Lists ▾'),
            can_focus: false
        });
        this._listsButton.connect('clicked', () => { this._showListsMenu(); return Clutter.EVENT_STOP; });
        filterBar.add_child(this._listsButton);
        
        this.add_child(filterBar);
        
        // Items scroll view
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
        
        // Footer
        const footer = new St.BoxLayout({
            style_class: 'clipmaster-footer',
            x_expand: true
        });
        
        const shortcutText = new St.Label({
            text: '↑↓ Nav • Enter Paste • F Fav • T Text • P Pin • Del • Esc',
            style_class: 'clipmaster-footer-text',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER
        });
        footer.add_child(shortcutText);
        
        this.add_child(footer);
    }
    
    _showCreateListDialog() {
        debugLog('_showCreateListDialog called');
        try {
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
        } catch (e) {
            log(`ClipMaster: Error showing create list dialog: ${e.message}`);
            debugLog(`Dialog error: ${e.message}`);
            Main.notify('ClipMaster', _('Error creating list dialog'));
        }
    }
    
    _showListsMenu() {
        const lists = this._database.getLists();
        
        if (lists.length === 0) {
            Main.notify('ClipMaster', _('No custom lists. Click + to create one.'));
            return;
        }
        
        // Create a simple menu
        const menu = new PopupMenu.PopupMenu(this._listsButton, 0.0, St.Side.TOP);
        
        lists.forEach(list => {
            // Create a menu item with delete button
            const menuItem = new PopupMenu.PopupMenuItem(list.name);
            menuItem.connect('activate', () => {
                this._setFilter(list.id);
            });
            
            // Add delete button
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
                // Delay dialog opening to allow menu to fully dispose
                this._timeoutManager.add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._showConfirmDialog(
                        _('Are you sure you want to delete the list "%s"? This action cannot be undone.').format(listName),
                        () => {
                            debugLog(`Deleting list: ${listName} (ID: ${list.id})`);
                            this._database.deleteList(list.id);
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
    
    _startDrag(event) {
        debugLog(`_startDrag called`);
        try {
            this._dragging = true;
            [this._dragStartX, this._dragStartY] = event.get_coords();
            [this._dragStartPosX, this._dragStartPosY] = this.get_position();
            
            debugLog(`Drag start coords: (${this._dragStartX}, ${this._dragStartY})`);
            debugLog(`Popup position: (${this._dragStartPosX}, ${this._dragStartPosY})`);
            
            if (isNaN(this._dragStartX) || isNaN(this._dragStartY) ||
                isNaN(this._dragStartPosX) || isNaN(this._dragStartPosY)) {
                debugLog(`Invalid drag coords, cancelling`);
                this._dragging = false;
                return;
            }
            
            debugLog(`Connecting motion-event to global.stage`);
            // Use SignalManager for drag signals
            this._signalManager.connect(
                global.stage,
                'motion-event',
                (actor, motionEvent) => {
                    if (!this._dragging) return Clutter.EVENT_PROPAGATE;
                    
                    try {
                        const [currentX, currentY] = motionEvent.get_coords();
                        if (isNaN(currentX) || isNaN(currentY)) return Clutter.EVENT_PROPAGATE;
                        
                        const newX = Math.round(this._dragStartPosX + (currentX - this._dragStartX));
                        const newY = Math.round(this._dragStartPosY + (currentY - this._dragStartY));
                        
                        if (!isNaN(newX) && !isNaN(newY)) {
                            this.set_position(newX, newY);
                        }
                    } catch (e) {
                        debugLog(`Drag motion error: ${e.message}`);
                    }
                    return Clutter.EVENT_STOP;
                },
                'drag-motion'
            );
            
            this._signalManager.connect(
                global.stage,
                'button-release-event',
                () => {
                    debugLog(`Drag released`);
                    this._stopDrag();
                    return Clutter.EVENT_STOP;
                },
                'drag-release'
            );
            
            debugLog(`Drag setup complete using SignalManager`);
        } catch (e) {
            debugLog(`Start drag error: ${e.message}`);
            this._dragging = false;
        }
    }
    
    _stopDrag() {
        this._dragging = false;
        // Use SignalManager to disconnect drag signals
        if (this._signalManager) {
            this._signalManager.disconnect('drag-motion');
            this._signalManager.disconnect('drag-release');
        }
    }
    
    _connectSignals() {
        this.connect('key-press-event', this._onKeyPress.bind(this));
    }
    
    _createModalOverlay() {
        // Don't use modal overlay - use simpler click detection
        // that checks if click is inside popup bounds
    }
    
    _removeModalOverlay() {
        this._stopDrag();
        // Use SignalManager to disconnect click outside handler
        if (this._signalManager) {
            this._signalManager.disconnect('click-outside-handler');
        }
    }
    
    _setupClickOutside() {
        // Remove existing handler first using SignalManager
        this._signalManager.disconnect('click-outside-handler');
        
        debugLog('Setting up click outside handler');
        this._signalManager.connect(
            global.stage,
            'button-press-event',
            (actor, event) => {
            // Safety check: ensure popup is still valid and not disposed
            try {
                // Check if popup is still valid by trying to access a property
                // If disposed, this will throw an error and we'll catch it
                if (!this || this._signalManager === null) {
                    // Popup is being destroyed, disconnect handler
                    return Clutter.EVENT_PROPAGATE;
                }
                
                // Use try-catch for property access in case object is disposed
                let isVisible, isShowing;
                try {
                    isVisible = this.visible;
                    isShowing = this._isShowing;
                } catch (e) {
                    // Object is disposed, disconnect handler and return
                    debugLog('Popup is disposed, disconnecting click outside handler');
                    this._signalManager.disconnect('click-outside-handler');
                    return Clutter.EVENT_PROPAGATE;
                }
                
                if (!isVisible || !isShowing) {
                    return Clutter.EVENT_PROPAGATE;
                }
                
                // Grace period: ignore clicks within 1000ms of showing popup (increased)
                const timeSinceShow = Date.now() - this._showTime;
                if (timeSinceShow < 1000) {
                    debugLog(`Ignoring click during grace period (${timeSinceShow}ms since show)`);
                    return Clutter.EVENT_PROPAGATE;
                }
                
                // If pinned, don't close on outside click
                if (this._isPinned) {
                    debugLog(`Popup is pinned, ignoring outside click`);
                    return Clutter.EVENT_PROPAGATE;
                }
                
                try {
                    const [clickX, clickY] = event.get_coords();
                    const [popupX, popupY] = this.get_position();
                    const [popupW, popupH] = this.get_size();
                    
                    debugLog(`Click at (${clickX}, ${clickY}), popup at (${popupX}, ${popupY}), size (${popupW}, ${popupH})`);
                    
                    // Check if click is INSIDE popup - if so, let it through
                    const isInside = clickX >= popupX && clickX <= popupX + popupW &&
                                     clickY >= popupY && clickY <= popupY + popupH;
                    
                    if (isInside) {
                        debugLog('Click is inside popup, allowing');
                        // Click is inside popup, let it propagate to popup elements
                        return Clutter.EVENT_PROPAGATE;
                    } else {
                        debugLog('Click is outside popup, closing');
                        // Click is outside popup, close it
                        // Check if extension still exists
                        if (this._extension && this._extension.hidePopup) {
                            this._extension.hidePopup();
                        }
                        return Clutter.EVENT_STOP;  // Stop propagation to prevent other handlers
                    }
                } catch (e) {
                    debugLog(`Click outside error: ${e.message}`);
                    // If error occurs, disconnect handler to prevent further errors
                    try {
                        if (this._signalManager) {
                            this._signalManager.disconnect('click-outside-handler');
                        }
                    } catch (disconnectError) {
                        // Ignore disconnect errors
                    }
                    return Clutter.EVENT_PROPAGATE;
                }
            } catch (e) {
                // Popup is disposed or invalid, disconnect handler
                debugLog(`Click outside handler error (popup disposed?): ${e.message}`);
                try {
                    if (this._signalManager) {
                        this._signalManager.disconnect('click-outside-handler');
                    }
                } catch (disconnectError) {
                    // Ignore disconnect errors
                }
                return Clutter.EVENT_PROPAGATE;
            }
            },
            'click-outside-handler'
        );
    }
    
    /**
     * Show confirmation dialog before deletion
     * @param {string} message - Confirmation message
     * @param {Function} onConfirm - Callback when user confirms
     */
    _showConfirmDialog(message, onConfirm) {
        debugLog('_showConfirmDialog called');
        try {
            // Create modal dialog - same style as create list dialog
            const dialog = new ModalDialog.ModalDialog({ styleClass: 'clipmaster-dialog' });
            
            // Create message label
            const messageLabel = new St.Label({
                text: message,
                style_class: 'clipmaster-confirm-dialog-message'
            });
            messageLabel.clutter_text.set_line_wrap(true);
            messageLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
            messageLabel.set_width(400);
            
            // Add message directly to dialog contentLayout
            dialog.contentLayout.add_child(messageLabel);
            
            // Add buttons using addButton method (same as create list dialog)
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
            
            // Show dialog (same as create list dialog - no Meta.get_current_time())
            debugLog('Opening delete confirmation dialog...');
            dialog.open();
        } catch (e) {
            log(`ClipMaster: Error showing confirm dialog: ${e.message}`);
            debugLog(`Confirm dialog error: ${e.message}`);
            // If dialog fails, just execute the action directly
            if (onConfirm) {
                onConfirm();
            }
        }
    }
    
    _setFilter(listId, type = null) {
        this._currentListId = listId;
        this._currentType = type;
        
        // Update button styles
        [this._allButton, this._favButton, this._textButton, this._imageButton, this._urlButton, this._listsButton].forEach(b => {
            if (b) b.remove_style_class_name('active');
        });
        
        if (listId === -1) {
            this._favButton.add_style_class_name('active');
        } else if (type === ItemType.TEXT) {
            this._textButton.add_style_class_name('active');
        } else if (type === ItemType.IMAGE) {
            this._imageButton.add_style_class_name('active');
        } else if (type === ItemType.URL) {
            this._urlButton.add_style_class_name('active');
        } else if (listId !== null && listId > 0) {
            this._listsButton.add_style_class_name('active');
        } else {
            this._allButton.add_style_class_name('active');
        }
        
        this._loadItems();
    }
    
    show() {
        // Only show if intentionally triggered
        if (!this._isShowing) {
            return;
        }
        
        this._searchEntry.set_text('');
        this._searchQuery = '';
        this._selectedIndex = 0;
        this._currentListId = null;
        this._currentType = null;
        this._plainTextMode = false;
        // Don't reset pin state - user controls it explicitly
        
        this._loadItems();
        
        // Make popup visible AND opaque
        this.visible = true;
        this.opacity = 255;
        this.reactive = true;
        this._showTime = Date.now();  // Record show time for grace period
        
        debugLog(`Popup shown at ${this._showTime}`);
        
        // Setup click outside handler after popup is visible (longer delay to prevent immediate closing)
        // Use longer delay to ensure popup is fully rendered and user has time to see it
        // Use TimeoutManager for proper cleanup
        this._timeoutManager.add(
            GLib.PRIORITY_DEFAULT,
            800,
            () => {
                if (this._isShowing && this.visible) {
                    debugLog('Setting up click outside handler after 800ms delay');
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
    
    hide() {
        debugLog(`hide() called - _isPinned=${this._isPinned}, _isShowing=${this._isShowing}`);
        
        // If pinned, don't hide
        if (this._isPinned) {
            debugLog('Popup is pinned, not hiding');
            return;
        }
        
        this._isShowing = false;
        
        // Disconnect click outside handler BEFORE removing overlay
        // This prevents handler from trying to access disposed popup
        try {
            if (this._signalManager) {
                this._signalManager.disconnect('click-outside-handler');
                debugLog('Click outside handler disconnected');
            }
        } catch (e) {
            debugLog(`Error disconnecting click outside handler: ${e.message}`);
        }
        
        this._removeModalOverlay();  // This also removes click outside handler
        this.visible = false;
        this.opacity = 0;  // Make fully transparent
        this.reactive = false;
        debugLog('Popup hidden');
    }
    
    // GJS best practice: dispose() for cleanup before destroy()
    vfunc_dispose() {
        // Cleanup all signals using SignalManager
        if (this._signalManager) {
            this._signalManager.disconnectAll();
            this._signalManager = null;
        }
        
        // Cleanup all timeouts using TimeoutManager
        if (this._timeoutManager) {
            this._timeoutManager.removeAll();
            this._timeoutManager = null;
        }
        
        this._removeModalOverlay();
        this._stopDrag();
        
        // Unload custom stylesheet if any
        if (this._customStylesheet) {
            try {
                const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                theme.unload_stylesheet(this._customStylesheet);
                this._customStylesheet = null;
            } catch (e) {
                log(`ClipMaster: Error unloading custom theme on dispose: ${e.message}`);
            }
        }
        
        // Clear references
        this._extension = null;
        this._settings = null;
        this._database = null;
        this._monitor = null;
        
        super.vfunc_dispose();
    }
    
    destroy() {
        // Ensure dispose is called first
        this.vfunc_dispose();
        super.destroy();
    }
    
    _loadItems() {
        // Clear existing items
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
        
        // Connect click
        row.connect('button-press-event', (actor, event) => {
            debugLog(`Row ${index} button-press-event, button=${event.get_button()}`);
            if (event.get_button() === 1) {
                // Cancel any pending hover paste timeout
                if (row._pasteTimeoutId) {
                    debugLog(`Cancelling paste timeout for item ${index} (user clicked)`);
                    GLib.source_remove(row._pasteTimeoutId);
                    row._pasteTimeoutId = null;
                }
                
                // Single click - select and paste
                this._selectedIndex = index;
                this._updateSelection();
                debugLog(`Single click on row ${index}, selecting and pasting...`);
                // Paste selected item (not from hover, so popup will close if close-on-paste is enabled)
                this._pasteFromHover = false;
                this._pasteSelected();
                return Clutter.EVENT_STOP;
            } else if (event.get_button() === 3) {
                // Right click - show context menu
                this._selectedIndex = index;
                this._updateSelection();
                this._showContextMenu(item, row);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        // Hover - Paste on selection
        row.connect('enter-event', (actor, event) => {
            debugLog(`ENTER EVENT on row ${index}`);
            this._selectedIndex = index;
            this._updateSelection();
            
            // Paste on selection if enabled
            let pasteOnSelect = false;
            try {
                pasteOnSelect = this._settings.get_boolean('paste-on-select');
            } catch (e) {
                debugLog(`Error reading paste-on-select: ${e.message}`);
            }
            
            debugLog(`Hover on item ${index}, paste-on-select=${pasteOnSelect}, visible=${this.visible}, isShowing=${this._isShowing}`);
            
            if (pasteOnSelect) {
                // Store timeout ID to cancel if user moves away
                if (row._pasteTimeoutId) {
                    debugLog(`Cancelling existing paste timeout for row ${index}`);
                    try {
                        GLib.source_remove(row._pasteTimeoutId);
                    } catch (e) {
                        debugLog(`Error removing existing paste timeout: ${e.message}`);
                    }
                    row._pasteTimeoutId = null;
                }
                
                debugLog(`Setting up paste timeout for row ${index} (500ms delay)`);
                // Small delay to prevent accidental pastes while navigating
                row._pasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    debugLog(`Paste timeout fired for row ${index} - checking conditions...`);
                    debugLog(`  selectedIndex=${this._selectedIndex}, index=${index}, visible=${this.visible}, isShowing=${this._isShowing}`);
                    
                    // Only paste if still on the same item and popup is visible
                    if (this._selectedIndex === index && this.visible && this._isShowing) {
                        debugLog(`✓ Conditions met - PASTING item ${index} (from paste-on-select hover)`);
                        // Mark that this is from paste-on-select (not explicit click)
                        this._pasteFromHover = true;
                        // Paste to clipboard
                        this._pasteSelected();
                        // Reset after a short delay
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            this._pasteFromHover = false;
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
        
        // Cancel paste timeout if user leaves the row
        row.connect('leave-event', (actor, event) => {
            debugLog(`LEAVE EVENT on row ${index}`);
            if (row._pasteTimeoutId) {
                debugLog(`Cancelling paste timeout for item ${index} (user left row)`);
                try {
                    GLib.source_remove(row._pasteTimeoutId);
                } catch (e) {
                    debugLog(`Error removing paste timeout on leave: ${e.message}`);
                }
                row._pasteTimeoutId = null;
            }
        });
        
        // Number badge for quick access (1-9)
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
        
        // Type icon (simple icon for all types including images)
        const iconName = this._getTypeIcon(item.type);
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 16,
            style_class: 'clipmaster-item-icon'
        });
        row.add_child(icon);
        
        // Content box
        const contentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'clipmaster-item-content'
        });
        
        // Title if exists
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
        
        // Preview
        let previewText = item.preview || item.plainText || item.content || '';
        if (item.type === ItemType.IMAGE) {
            const size = item.metadata?.size ? ` (${Math.round(item.metadata.size / 1024)}KB)` : '';
            previewText = `🖼️ Image${size}`;
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
        
        // Date/time display
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
                // Show date
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
        
        // Favorite button (always visible, shows state)
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
                // Toggle favorite
                const newFavoriteState = this._database.toggleFavorite(item.id);
                // Update icon
                favIcon.icon_name = newFavoriteState ? 'starred-symbolic' : 'non-starred-symbolic';
                favIcon.style_class = newFavoriteState ? 'clipmaster-item-fav' : 'clipmaster-item-fav-inactive';
                // Reload items to reflect changes
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
    
    _pasteSelected() {
        debugLog(`=== _pasteSelected() CALLED ===`);
        debugLog(`Items length: ${this._items.length}, selectedIndex: ${this._selectedIndex}`);
        
        if (this._items.length === 0 || this._selectedIndex >= this._items.length) {
            debugLog(`✗ _pasteSelected: No items or invalid index (${this._selectedIndex}/${this._items.length})`);
            return;
        }
        
        const item = this._items[this._selectedIndex];
        debugLog(`✓ _pasteSelected: Pasting item ${item.id} (type: ${item.type})`);
        debugLog(`  Item preview: ${item.preview ? item.preview.substring(0, 50) : 'no preview'}`);
        
        // Handle image items differently
        if (item.type === ItemType.IMAGE && item.content) {
            debugLog(`Copying image to clipboard: ${item.content}`);
            this._monitor.copyImageToClipboard(item.content);
        } else {
            const content = this._plainTextMode ? item.plainText : item.content;
            debugLog(`Copying text to clipboard (plainText=${this._plainTextMode}): ${content ? content.substring(0, 50) : 'null'}...`);
            this._monitor.copyToClipboard(content, this._plainTextMode);
        }
        
        // Update usage
        this._database.updateItem(item.id, {
            lastUsed: Date.now(),
            useCount: (item.useCount || 1) + 1
        });
        
        let closeOnPaste = false;
        try {
            closeOnPaste = this._settings.get_boolean('close-on-paste');
        } catch (e) {
            debugLog(`Error reading close-on-paste: ${e.message}`);
        }
        
        const isFromHover = this._pasteFromHover || false;
        debugLog(`close-on-paste=${closeOnPaste}, _isPinned=${this._isPinned}, isFromHover=${isFromHover}`);
        
        // Don't close if paste came from hover (paste-on-select)
        // Only close if user explicitly clicked AND close-on-paste is enabled AND popup is not pinned
        if (closeOnPaste && !this._isPinned && !isFromHover) {
            debugLog(`Closing popup after paste (close-on-paste=true, not pinned, explicit click)`);
            this._extension.hidePopup();
        } else {
            debugLog(`NOT closing popup (close-on-paste=${closeOnPaste}, pinned=${this._isPinned}, isFromHover=${isFromHover})`);
        }
        
        debugLog(`=== _pasteSelected() COMPLETED ===`);
    }
    
    _showContextMenu(item, row) {
        // Create a simple popup menu
        const menu = new PopupMenu.PopupMenu(row, 0.0, St.Side.TOP);
        
        // Edit title
        menu.addAction(_('Edit Title...'), () => {
            this._showEditDialog(item, 'title');
        });
        
        // Edit content (for text items)
        if (item.type === ItemType.TEXT || item.type === ItemType.URL) {
            menu.addAction(_('Edit Content...'), () => {
                this._showEditDialog(item, 'content');
            });
        }
        
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Toggle favorite
        const favLabel = item.isFavorite ? _('Remove from Favorites') : _('Add to Favorites');
        menu.addAction(favLabel, () => {
            this._database.toggleFavorite(item.id);
            this._loadItems();
        });
        
        // Add to list submenu
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
        
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Delete
        menu.addAction(_('Delete'), () => {
            const itemPreview = item.preview || item.plainText || _('this item');
            const previewText = itemPreview.length > 50 ? itemPreview.substring(0, 50) + '...' : itemPreview;
            menu.close();
            // Delay dialog opening to allow menu to fully dispose
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
    
    _onKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        const searchHasFocus = this._searchEntry.clutter_text.has_key_focus();
        
        // Escape - ALWAYS close
        if (symbol === Clutter.KEY_Escape) {
            this._extension.hidePopup();
            return Clutter.EVENT_STOP;
        }
        
        // Up/Down - ALWAYS navigate (even in search, moves selection)
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
        
        // Enter - ALWAYS paste selected
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            this._pasteSelected();
            return Clutter.EVENT_STOP;
        }
        
        // Delete - delete item (works even when search has focus)
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
        
        // These only work when search doesn't have focus (to allow typing)
        if (!searchHasFocus) {
            // P - toggle pin
            if (symbol === Clutter.KEY_p || symbol === Clutter.KEY_P) {
                this._isPinned = !this._isPinned;
                if (this._isPinned) {
                    this._pinButton.add_style_pseudo_class('checked');
                } else {
                    this._pinButton.remove_style_pseudo_class('checked');
                }
                debugLog(`Pin toggled via keyboard: ${this._isPinned}`);
                return Clutter.EVENT_STOP;
            }
            
            // T - toggle plain text mode
            if (symbol === Clutter.KEY_t || symbol === Clutter.KEY_T) {
                this._plainTextMode = !this._plainTextMode;
                if (this._plainTextMode) {
                    this._plainTextButton.add_style_pseudo_class('checked');
                } else {
                    this._plainTextButton.remove_style_pseudo_class('checked');
                }
                debugLog(`Plain text mode: ${this._plainTextMode}`);
                return Clutter.EVENT_STOP;
            }
            
            // F - toggle favorite
            if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F) {
                if (this._items.length > 0 && this._selectedIndex < this._items.length) {
                    this._database.toggleFavorite(this._items[this._selectedIndex].id);
                    this._loadItems();
                }
                return Clutter.EVENT_STOP;
            }
            
            // 1-9 - quick paste
            if (symbol >= Clutter.KEY_1 && symbol <= Clutter.KEY_9) {
                const index = symbol - Clutter.KEY_1;
                if (index < this._items.length) {
                    this._selectedIndex = index;
                    this._pasteSelected();
                }
                return Clutter.EVENT_STOP;
            }
        }
        
        return Clutter.EVENT_PROPAGATE;
    }
    
    _scrollToSelected() {
        // Scroll to make selected item visible
        const children = this._itemsBox.get_children();
        if (this._selectedIndex >= 0 && this._selectedIndex < children.length) {
            const child = children[this._selectedIndex];
            if (child) {
                const adj = this._scrollView.vscroll.adjustment;
                const [, childY] = child.get_transformed_position();
                const [, scrollY] = this._scrollView.get_transformed_position();
                const relativeY = childY - scrollY;
                const scrollHeight = this._scrollView.height;
                const childHeight = child.height;
                
                if (relativeY < 0) {
                    adj.value += relativeY;
                } else if (relativeY + childHeight > scrollHeight) {
                    adj.value += (relativeY + childHeight - scrollHeight);
                }
            }
        }
    }
});


