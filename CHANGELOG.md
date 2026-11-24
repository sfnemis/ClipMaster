# Changelog

## 2.0

This release fixes two things that cost people data or privacy, so please read
the first two sections even if you skip the rest.

### Your history is no longer thrown away

If ClipMaster could not read its history file, it carried on with an empty
history and the next thing you copied was written over the stored one. Turning
the obfuscation switch off was enough to trigger it, and so was any other
problem reading the file. That is almost certainly what happened to everyone who
reported losing their history after logging out.

Now a failed read stops ClipMaster from writing at all. The file is left exactly
where it is, a timestamped copy is kept next to it, and you get a notification
saying so. Saving also goes through a temporary file and a rename, with one
previous version kept as `clipboard.json.bak`, and the last save on logout is
no longer abandoned half way.

Two more: emoji and anything else outside the basic character set were corrupted
when the history was written, and two entries could end up sharing an identifier,
so deleting one removed the other.

### Excluded applications actually work now

The list was read by the preferences window and by nothing else, so copies from
a password manager were stored like everything else. It works now, and it
matches the application id, its name or its window class, so `KeePassXC`,
`org.keepassxc.KeePassXC` and `keepassxc` all do what you would expect.

One copy produces several clipboard events, and the later ones arrive after the
application that made the copy has lost the focus, which was enough to get the
content recorded under a different window's name. Those are refused by content
now, not by which window happens to be focused.

There is also a private mode: it stops recording entirely, it is in the panel
menu and the popup, and the panel icon changes while it is on.

### The obfuscation setting is described honestly

The preferences window used to say "AES-256". The code has always been a
repeating-key XOR with the key stored next to the data. It is called obfuscation
now, everywhere, with a plain statement that whoever can read the file can
recover what is in it. Nothing about the protection changed. The description
did, because the old one was wrong. The key is now drawn from the system random
source instead of `Math.random()`, and the history, the key and the image folder
are created readable by you only.

### GNOME 50 and 51

ClipMaster 1.3.1 could not open its popup at all on GNOME 50: it passed a
parameter to the shell that GNOME 50 removed, and the call threw. GNOME 51
removed two more things it used. Supported versions are now 46 to 51.

Also fixed from the same family of bugs: ClipMaster never disconnected any of
its signals when it was disabled, because the check it used for that is not a
method GJS actually provides. That one leak is behind the unclickable elements,
the primary selection that kept recording after being switched off, and the
error people saw on GNOME 50.

### No keyboard shortcut out of the box

The GNOME Extensions review guidelines do not allow an extension that reads the
clipboard to claim a keyboard shortcut, and the two that ClipMaster used were
already taken: `Super+V` opens the notification list and `Ctrl+Shift+V` is how
you paste in a terminal, which is what several of you reported. Open the
preferences, go to Shortcuts and press whatever you want. If you had already
chosen your own, it is kept.

### New

- Pin an item to the top of the list, separately from favourites
- Open the popup at a fixed spot on the screen instead of at the pointer
- Resize the popup by dragging the handle in its bottom right corner
- The size now follows the display scale, so it is no longer tiny on a 4K screen
- Closing when you click outside is a setting, and it reacts in 250 ms instead
  of a second
- Clearing the history asks first and tells you how many items will go

### From a review on extensions.gnome.org

- Turning the panel icon off did nothing until you restarted the session
- Copying something that is offered both as text and as a picture, which is
  what spreadsheets, note applications and drawing canvases do, stored the
  picture and threw the text away. The text is kept now, and there is a setting
  if you want the picture instead
- The shortcut conflict with terminals and with LibreOffice survived changing
  the shortcut, because it was the second one, "paste as plain text", that kept
  its own default

### Smaller fixes

- The preferences window no longer asks you to reload the extension by hand
  after importing or clearing
- Enforcing the size limit no longer freezes the desktop for seconds
- The QR dialog draws the code once instead of building thousands of widgets
- Code entries get their own icon
- Clearing the history deletes the image files too, and old orphans are swept up
- Debug logging appears in the journal, which it never did before
- The README no longer tells you to install `wl-clipboard` and `xclip`. No
  version of ClipMaster has ever called them, so you can remove them.

## 1.3.1 and earlier

See the commit history.
