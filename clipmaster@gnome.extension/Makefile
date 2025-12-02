# ClipMaster GNOME Extension Makefile
# Usage:
#   make install    - Install extension locally
#   make uninstall  - Remove extension
#   make package    - Create distributable zip
#   make clean      - Remove build artifacts
#   make schemas    - Compile GSettings schemas
#   make pot        - Generate translation template

UUID = clipmaster@gnome.extension
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

# Files to include in the package
SOURCES = extension.js prefs.js metadata.json LICENSE
ASSETS = assets/stylesheet.css assets/icons/clipmaster-symbolic.svg
SCHEMAS = schemas/org.gnome.shell.extensions.clipmaster.gschema.xml
SRC_MANAGER = src/Manager/Database.js src/Manager/ClipboardMonitor.js
SRC_UI = src/UI/Indicator.js src/UI/Popup.js
SRC_UTIL = src/Util/Constants.js src/Util/Encryption.js src/Util/Utils.js

.PHONY: all install uninstall package clean schemas pot

all: schemas

schemas:
	@echo "Compiling GSettings schemas..."
	@glib-compile-schemas schemas/

install: schemas
	@echo "Installing $(UUID)..."
	@mkdir -p $(INSTALL_DIR)
	@mkdir -p $(INSTALL_DIR)/schemas
	@mkdir -p $(INSTALL_DIR)/assets/icons
	@mkdir -p $(INSTALL_DIR)/src/Manager
	@mkdir -p $(INSTALL_DIR)/src/UI
	@mkdir -p $(INSTALL_DIR)/src/Util
	@cp $(SOURCES) $(INSTALL_DIR)/
	@cp assets/stylesheet.css $(INSTALL_DIR)/assets/
	@cp assets/icons/* $(INSTALL_DIR)/assets/icons/
	@cp schemas/*.xml $(INSTALL_DIR)/schemas/
	@cp schemas/gschemas.compiled $(INSTALL_DIR)/schemas/ 2>/dev/null || true
	@cp src/Manager/*.js $(INSTALL_DIR)/src/Manager/
	@cp src/UI/*.js $(INSTALL_DIR)/src/UI/
	@cp src/Util/*.js $(INSTALL_DIR)/src/Util/
	@glib-compile-schemas $(INSTALL_DIR)/schemas/
	@echo "Done! Restart GNOME Shell to activate."

uninstall:
	@echo "Uninstalling $(UUID)..."
	@rm -rf $(INSTALL_DIR)
	@echo "Done!"

package: schemas
	@echo "Creating $(UUID).zip..."
	@rm -f $(UUID).zip
	@zip -r $(UUID).zip \
		$(SOURCES) \
		assets/ \
		schemas/*.xml \
		schemas/gschemas.compiled \
		src/
	@echo "Package created: $(UUID).zip"

clean:
	@echo "Cleaning build artifacts..."
	@rm -f $(UUID).zip
	@rm -f schemas/gschemas.compiled
	@rm -f po/*.mo
	@echo "Done!"

pot:
	@echo "Generating translation template..."
	@mkdir -p po
	@xgettext --from-code=UTF-8 \
		--output=po/$(UUID).pot \
		--package-name=$(UUID) \
		extension.js prefs.js \
		src/Manager/*.js \
		src/UI/*.js \
		src/Util/*.js
	@echo "Template created: po/$(UUID).pot"

# Development helpers
lint:
	@echo "Running eslint..."
	@eslint extension.js prefs.js src/ || true

test:
	@echo "Reloading extension..."
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@sleep 1
	@gnome-extensions enable $(UUID)
	@echo "Extension reloaded!"

logs:
	@journalctl -f --user -g ClipMaster


