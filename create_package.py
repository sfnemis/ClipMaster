#!/usr/bin/env python3
"""
ClipMaster Extension Package Script for extensions.gnome.org
Creates a properly formatted zip file for submission
"""

import os
import zipfile
import shutil
from pathlib import Path

EXTENSION_UUID = "clipmaster@gnome.extension"
EXTENSION_DIR = Path("clipmaster@gnome.extension")
PACKAGE_NAME = f"{EXTENSION_UUID}.shell-extension.zip"

# Files to exclude
EXCLUDE_PATTERNS = [
    ".git",
    ".DS_Store",
    "~",
    ".swp",
    ".swo",
    "gschemas.compiled",  # Will be compiled on install
]

def should_exclude(filepath):
    """Check if file should be excluded from package"""
    return any(pattern in str(filepath) for pattern in EXCLUDE_PATTERNS)

def create_package():
    """Create the extension package"""
    print("╔══════════════════════════════════════════════════════════╗")
    print("║     ClipMaster Extension Package Script                 ║")
    print("║     Preparing package for extensions.gnome.org          ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print("")
    
    if not EXTENSION_DIR.exists():
        print(f"❌ Error: Extension directory '{EXTENSION_DIR}' not found!")
        return False
    
    print("→ Creating zip package...")
    
    # Remove old package if exists
    if os.path.exists(PACKAGE_NAME):
        os.remove(PACKAGE_NAME)
    
    with zipfile.ZipFile(PACKAGE_NAME, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            # Filter out excluded directories
            dirs[:] = [d for d in dirs if not should_exclude(d)]
            
            for file in files:
                filepath = Path(root) / file
                if should_exclude(filepath):
                    continue
                
                # Get relative path for zip - files should be at root of zip, not in subdirectory
                # So we get the path relative to EXTENSION_DIR itself
                arcname = filepath.relative_to(EXTENSION_DIR)
                zipf.write(filepath, arcname)
                print(f"  Added: {arcname}")
    
    print("")
    print(f"✅ Package created successfully: {PACKAGE_NAME}")
    print("")
    print("📦 Package contents:")
    
    with zipfile.ZipFile(PACKAGE_NAME, 'r') as zipf:
        for info in zipf.infolist()[:20]:
            print(f"  {info.filename}")
        if len(zipf.namelist()) > 20:
            print(f"  ... and {len(zipf.namelist()) - 20} more files")
    
    print("")
    print("📋 Next steps:")
    print(f"   1. Review the package: unzip -l {PACKAGE_NAME}")
    print("   2. Test installation locally")
    print("   3. Upload to extensions.gnome.org")
    print("")
    
    return True

if __name__ == "__main__":
    create_package()

