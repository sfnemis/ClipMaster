/*
 * ClipMaster - Panel Indicator
 * License: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ItemType } from '../Util/Constants.js';

export const ClipMasterIndicator = GObject.registerClass(
class ClipMasterIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'ClipMaster');
        
        this._extension = extension;
        this._settings = extension._settings;
        
        this._icon = new St.Icon({
            icon_name: this._settings.get_string('indicator-icon'),
            style_class: 'system-status-icon'
        });
        this.add_child(this._icon);
        
        this._buildMenu();
    }
    
    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            const button = event.get_button();
            
            if (button === 1) {
                this._extension.togglePopup();
                return Clutter.EVENT_STOP;
            } else if (button === 3) {
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
        }
        
        return super.vfunc_event(event);
    }
    
    _buildMenu() {
        this._recentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._recentSection);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        this.menu.addAction(_('Show Clipboard Manager'), () => {
            this.menu.close();
            this._extension.showPopup();
        });
        
        this.menu.addAction(_('Clear History'), () => {
            this._extension._database.clearHistory(true);
            this._extension._refreshIndicator();
        });
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        this.menu.addAction(_('Preferences'), () => {
            this.menu.close();
            this._extension._openPreferencesWindow();
        });
    }
    
    refresh() {
        this._recentSection.removeAll();
        
        const items = this._extension._database.getItems({ limit: 5 });
        
        if (items.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem(_('No clipboard items'), {
                reactive: false
            });
            this._recentSection.addMenuItem(emptyItem);
            return;
        }
        
        items.forEach(item => {
            let preview = item.preview || item.content || '';
            if (item.type === ItemType.IMAGE) {
                preview = `🖼️ ${item.preview || 'Image'}`;
            }
            if (preview.length > 50) {
                preview = preview.substring(0, 50) + '...';
            }
            preview = preview.replace(/\n/g, ' ');
            
            const menuItem = new PopupMenu.PopupMenuItem(preview);
            menuItem.connect('activate', () => {
                if (item.type === ItemType.IMAGE && item.content) {
                    this._extension._monitor.copyImageToClipboard(item.content);
                } else {
                    this._extension._monitor.copyToClipboard(item.content);
                }
            });
            this._recentSection.addMenuItem(menuItem);
        });
    }
});
