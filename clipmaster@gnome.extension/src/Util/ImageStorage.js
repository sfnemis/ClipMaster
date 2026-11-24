/*
 * ClipMaster - Image Storage Utility
 * License: GPL-2.0-or-later
 * 
 * A copied image is written to its own file under the user data directory and
 * the history keeps only the path, so the history file stays small. A thumbnail
 * is generated at the same time and stored in the history itself, base64
 * encoded, which is what the popup and the panel menu draw.
 *
 * WebP is preferred for both because it is much smaller, but it needs the
 * gdk-pixbuf WebP loader, which is a separate package on most distributions
 * and is not always installed. PNG is the fallback whenever that loader is
 * missing, so no distribution needs an extra dependency for this to work.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import { debugLog, reportError } from './Constants.js';
import { loadContents } from './Utils.js';

export class ImageStorage {
    constructor(baseDir = null) {
        this._baseDir = baseDir || GLib.build_filenamev([
            GLib.get_user_data_dir(), 'clipmaster'
        ]);

        this._imagesDir = GLib.build_filenamev([this._baseDir, 'images']);

        // Thumbnail settings
        this._thumbSize = 128;      // pixels (width or height, maintaining aspect ratio)
        this._thumbQuality = '70';  // WebP quality (0-100)

        this._ensureDirectories();
    }

    _ensureDirectories() {
        try {
            GLib.mkdir_with_parents(this._imagesDir, 0o700);
            debugLog(`ImageStorage: Directories ensured at ${this._baseDir}`);
        } catch (e) {
            reportError(`could not create the image directory: ${e.message}`);
        }
    }

    /**
     * Save an image from raw bytes and generate a thumbnail
     * @param {Uint8Array} imageData - Raw image data
     * @param {string} format - Image format (png, jpeg, webp, etc.)
     * @param {string} hash - Unique hash for the image
     * @returns {Promise<{imagePath: string, thumbnail: string, originalSize: number, thumbnailSize: number}|null>}
     */
    async saveImage(imageData, hash = null) {
        const timestamp = Date.now();
        const imageId = hash || `img_${timestamp}`;

        try {
            // Step 1: Save original image as WebP for compression
            const imagePath = GLib.build_filenamev([this._imagesDir, `${imageId}.webp`]);

            // Decoding runs asynchronously: a synchronous decode of a multi
            // megabyte image happens on the compositor thread and drops frames.
            const inputStream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(imageData));
            const pixbuf = await ImageStorage._pixbufFromStream(inputStream);
            inputStream.close(null);

            if (!pixbuf) {
                debugLog('ImageStorage: Failed to create pixbuf from image data');
                return null;
            }

            const originalWidth = pixbuf.get_width();
            const originalHeight = pixbuf.get_height();

            // Step 2: Save full image as WebP (better compression than PNG)
            // Note: WebP support requires gdk-pixbuf-webp loader (usually installed)
            let savedAsWebp = false;
            try {
                pixbuf.savev(imagePath, 'webp', ['quality'], ['85']);
                savedAsWebp = true;
                debugLog(`ImageStorage: Saved WebP image to ${imagePath}`);
            } catch (e) {
                // Fallback to PNG if WebP not supported
                debugLog(`ImageStorage: WebP not supported, falling back to PNG: ${e.message}`);
                const pngPath = GLib.build_filenamev([this._imagesDir, `${imageId}.png`]);
                pixbuf.savev(pngPath, 'png', [], []);
                debugLog(`ImageStorage: Saved PNG image to ${pngPath}`);
            }

            // Step 3: Create thumbnail
            const thumbPixbuf = this._createThumbnail(pixbuf, this._thumbSize);

            // Step 4: Convert thumbnail to base64 for JSON storage
            let thumbnailBase64 = null;
            try {
                // Try WebP first for smaller size
                const [success, buffer] = thumbPixbuf.save_to_bufferv('webp', ['quality'], [this._thumbQuality]);
                if (success) {
                    thumbnailBase64 = GLib.base64_encode(buffer);
                }
            } catch {
                // WebP needs the gdk-pixbuf WebP loader, which is not installed
                // everywhere, so PNG is the fallback for the thumbnail too.
                try {
                    const [success, buffer] = thumbPixbuf.save_to_bufferv('png', [], []);
                    if (success) {
                        thumbnailBase64 = GLib.base64_encode(buffer);
                    }
                } catch (e2) {
                    debugLog(`ImageStorage: Failed to create thumbnail buffer: ${e2.message}`);
                }
            }

            // Get file sizes
            const imageFile = Gio.File.new_for_path(savedAsWebp ? imagePath : imagePath.replace('.webp', '.png'));
            const imageInfo = imageFile.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const savedImageSize = imageInfo.get_size();

            const thumbnailSize = thumbnailBase64 ? Math.ceil(thumbnailBase64.length * 0.75) : 0;

            debugLog(`ImageStorage: Original ${originalWidth}x${originalHeight}, saved ${savedImageSize} bytes, thumb ~${thumbnailSize} bytes`);

            return {
                imagePath: savedAsWebp ? imagePath : imagePath.replace('.webp', '.png'),
                thumbnail: thumbnailBase64,
                originalSize: imageData.length,
                savedSize: savedImageSize,
                thumbnailSize: thumbnailSize,
                width: originalWidth,
                height: originalHeight,
                format: savedAsWebp ? 'webp' : 'png'
            };

        } catch (e) {
            reportError(`could not save the image: ${e.message}`);
            return null;
        }
    }

    static _pixbufFromStream(stream) {
        return new Promise((resolve, reject) => {
            GdkPixbuf.Pixbuf.new_from_stream_async(stream, null, (source, result) => {
                try {
                    resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Create a thumbnail from a pixbuf, maintaining aspect ratio
     */
    _createThumbnail(pixbuf, maxSize) {
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();

        let newWidth, newHeight;

        if (width > height) {
            newWidth = maxSize;
            newHeight = Math.round((height / width) * maxSize);
        } else {
            newHeight = maxSize;
            newWidth = Math.round((width / height) * maxSize);
        }

        // Ensure at least 1 pixel
        newWidth = Math.max(1, newWidth);
        newHeight = Math.max(1, newHeight);

        return pixbuf.scale_simple(newWidth, newHeight, GdkPixbuf.InterpType.BILINEAR);
    }

    /**
     * Load the full image from disk
     * @param {string} imagePath - Path to the saved image
     * @returns {Uint8Array|null} - Raw image data or null
     */
    async loadImage(imagePath) {
        try {
            const file = Gio.File.new_for_path(imagePath);
            if (!file.query_exists(null)) {
                debugLog(`ImageStorage: Image not found: ${imagePath}`);
                return null;
            }

            return await loadContents(file);
        } catch (e) {
            reportError(`could not load the stored image: ${e.message}`);
            return null;
        }
    }

    /**
     * @param {string} imagePath - Path to the stored image file
     */
    deleteImage(imagePath) {
        try {
            const imageFile = Gio.File.new_for_path(imagePath);
            if (imageFile.query_exists(null)) {
                imageFile.delete(null);
                debugLog(`ImageStorage: Deleted image: ${imagePath}`);
            }
        } catch (e) {
            reportError(`could not delete the stored image: ${e.message}`);
        }
    }

    /**
     * Clean up orphaned images (images not in database)
     * @param {Set<string>} validPaths - Set of image paths that should be kept
     */
    cleanupOrphans(validPaths) {
        try {
            const imagesDir = Gio.File.new_for_path(this._imagesDir);
            const imagesEnum = imagesDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);

            let info;
            let deletedCount = 0;

            while ((info = imagesEnum.next_file(null)) !== null) {
                const name = info.get_name();
                const fullPath = GLib.build_filenamev([this._imagesDir, name]);

                if (!validPaths.has(fullPath)) {
                    this.deleteImage(fullPath);
                    deletedCount++;
                }
            }
            imagesEnum.close(null);

            debugLog(`ImageStorage: Cleaned up ${deletedCount} orphaned images`);
            return deletedCount;
        } catch (e) {
            reportError(`could not sweep unused image files: ${e.message}`);
            return 0;
        }
    }

    get imagesDir() {
        return this._imagesDir;
    }
}
