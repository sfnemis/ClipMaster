/*
 * ClipMaster - QR Code Generator
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * The encoder below is derived from the QR Code generator library by Project
 * Nayuki (https://www.nayuki.io/page/qr-code-generator-library), reduced to the
 * byte and alphanumeric modes this extension needs. The original is offered
 * under the MIT License and its notice is reproduced in full as that license
 * requires:
 *
 *   Copyright (c) Project Nayuki. (MIT License)
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   - The above copyright notice and this permission notice shall be included in
 *     all copies or substantial portions of the Software.
 *   - The Software is provided "as is", without warranty of any kind, express or
 *     implied, including but not limited to the warranties of merchantability,
 *     fitness for a particular purpose and noninfringement. In no event shall the
 *     authors or copyright holders be liable for any claim, damages or other
 *     liability, whether in an action of contract, tort or otherwise, arising from,
 *     out of or in connection with the Software or the use or other dealings in the
 *     Software.
 */

import { debugLog } from './Constants.js';

/**
 * QR Code Error Correction Level
 */
export const QrEcc = {
    LOW: 0,      // ~7% error correction
    MEDIUM: 1,   // ~15% error correction
    QUARTILE: 2, // ~25% error correction
    HIGH: 3      // ~30% error correction
};

/**
 * QR Code Generator
 * Creates QR codes from text data
 */
export class QrCodeGenerator {

    // Maximum characters for reliable QR encoding
    static MAX_CHARS = 2000;

    /**
     * Generate QR code modules (2D boolean array) from text
     * @param {string} text - Text to encode
     * @param {number} ecl - Error correction level (QrEcc.LOW to HIGH)
     * @returns {{size: number, modules: boolean[][]}} - QR code data
     */
    static generate(text, ecl = QrEcc.MEDIUM) {
        if (!text || text.length === 0) {
            throw new Error('Text cannot be empty');
        }

        if (text.length > this.MAX_CHARS) {
            throw new Error(`Text too long: ${text.length} chars (max ${this.MAX_CHARS})`);
        }

        debugLog(`QrCodeGenerator: Generating QR for ${text.length} chars`);

        // Use Nayuki algorithm implementation
        const qr = QrCode.encodeText(text, ecl);

        return {
            size: qr.size,
            modules: qr.modules
        };
    }

    /**
     * Check if text can be encoded
     * @param {string} text - Text to check
     * @returns {boolean}
     */
    static canEncode(text) {
        return text && text.length > 0 && text.length <= this.MAX_CHARS;
    }
}


/*---- QR Code Implementation (based on Nayuki) ----*/

// Internal QR Code class
class QrCode {

    static MIN_VERSION = 1;
    static MAX_VERSION = 40;

    // ECC codewords per block for each version and ECC level
    static ECC_CODEWORDS_PER_BLOCK = [
        [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
        [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
    ];

    // Number of error correction blocks for each version and ECC level
    static NUM_ERROR_CORRECTION_BLOCKS = [
        [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
        [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
        [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
        [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
    ];

    constructor(version, ecl, dataCodewords, msk) {
        this.version = version;
        this.ecl = ecl;
        this.size = version * 4 + 17;
        this.mask = msk;

        // Initialize modules
        this.modules = [];
        this.isFunction = [];
        for (let i = 0; i < this.size; i++) {
            this.modules.push(new Array(this.size).fill(false));
            this.isFunction.push(new Array(this.size).fill(false));
        }

        // Draw patterns
        this.drawFunctionPatterns();
        const allCodewords = this.addEccAndInterleave(dataCodewords);
        this.drawCodewords(allCodewords);

        // Choose mask
        if (msk === -1) {
            let minPenalty = Infinity;
            for (let i = 0; i < 8; i++) {
                this.applyMask(i);
                this.drawFormatBits(i);
                const penalty = this.getPenaltyScore();
                if (penalty < minPenalty) {
                    msk = i;
                    minPenalty = penalty;
                }
                this.applyMask(i);
            }
        }

        this.mask = msk;
        this.applyMask(msk);
        this.drawFormatBits(msk);
        this.isFunction = [];
    }

    static encodeText(text, ecl) {
        const segs = QrSegment.makeSegments(text);
        return QrCode.encodeSegments(segs, ecl);
    }

    static encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
        let version, dataUsedBits;

        for (version = minVersion; ; version++) {
            const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
            const usedBits = QrSegment.getTotalBits(segs, version);
            if (usedBits <= dataCapacityBits) {
                dataUsedBits = usedBits;
                break;
            }
            if (version >= maxVersion) {
                throw new Error('Data too long');
            }
        }

        // Boost ECC if possible
        for (const newEcl of [QrEcc.MEDIUM, QrEcc.QUARTILE, QrEcc.HIGH]) {
            if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) {
                ecl = newEcl;
            }
        }

        // Build data bits
        const bb = [];
        for (const seg of segs) {
            appendBits(seg.mode.modeBits, 4, bb);
            appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
            for (const b of seg.data) {
                bb.push(b);
            }
        }

        const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
        appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
        appendBits(0, (8 - bb.length % 8) % 8, bb);

        for (let padByte = 0xEC; bb.length < dataCapacityBits; padByte ^= 0xEC ^ 0x11) {
            appendBits(padByte, 8, bb);
        }

        // Pack into bytes
        const dataCodewords = [];
        while (dataCodewords.length * 8 < bb.length) {
            dataCodewords.push(0);
        }
        bb.forEach((b, i) => {
            dataCodewords[i >>> 3] |= b << (7 - (i & 7));
        });

        return new QrCode(version, ecl, dataCodewords, mask);
    }

    static getNumDataCodewords(ver, ecl) {
        return Math.floor(QrCode.getNumRawDataModules(ver) / 8) -
            QrCode.ECC_CODEWORDS_PER_BLOCK[ecl][ver] * QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    }

    static getNumRawDataModules(ver) {
        let result = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            const numAlign = Math.floor(ver / 7) + 2;
            result -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7) {
                result -= 36;
            }
        }
        return result;
    }

    getModule(x, y) {
        return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
    }

    drawFunctionPatterns() {
        // Draw finder patterns
        for (let i = 0; i < this.size; i++) {
            this.setFunctionModule(6, i, i % 2 === 0);
            this.setFunctionModule(i, 6, i % 2 === 0);
        }

        this.drawFinderPattern(3, 3);
        this.drawFinderPattern(this.size - 4, 3);
        this.drawFinderPattern(3, this.size - 4);

        // Draw alignment patterns
        const alignPatPos = this.getAlignmentPatternPositions();
        for (const i of alignPatPos) {
            for (const j of alignPatPos) {
                if (!((i === 6 && j === 6) || (i === 6 && j === this.size - 7) || (i === this.size - 7 && j === 6))) {
                    this.drawAlignmentPattern(i, j);
                }
            }
        }

        this.drawFormatBits(0);
        this.drawVersion();
    }

    drawFinderPattern(x, y) {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const xx = x + dx, yy = y + dy;
                if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size) {
                    this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
                }
            }
        }
    }

    drawAlignmentPattern(x, y) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }

    setFunctionModule(x, y, isDark) {
        this.modules[y][x] = isDark;
        this.isFunction[y][x] = true;
    }

    drawFormatBits(mask) {
        const data = QrCode.ECC_FORMAT_BITS[this.ecl] << 3 | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) {
            rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        }
        const bits = (data << 10 | rem) ^ 0x5412;

        for (let i = 0; i <= 5; i++) {
            this.setFunctionModule(8, i, getBit(bits, i));
        }
        this.setFunctionModule(8, 7, getBit(bits, 6));
        this.setFunctionModule(8, 8, getBit(bits, 7));
        this.setFunctionModule(7, 8, getBit(bits, 8));
        for (let i = 9; i < 15; i++) {
            this.setFunctionModule(14 - i, 8, getBit(bits, i));
        }

        for (let i = 0; i < 8; i++) {
            this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
        }
        for (let i = 8; i < 15; i++) {
            this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
        }
        this.setFunctionModule(8, this.size - 8, true);
    }

    static ECC_FORMAT_BITS = [1, 0, 3, 2];

    drawVersion() {
        if (this.version < 7) return;

        let rem = this.version;
        for (let i = 0; i < 12; i++) {
            rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        }
        const bits = this.version << 12 | rem;

        for (let i = 0; i < 18; i++) {
            const color = getBit(bits, i);
            const a = this.size - 11 + i % 3;
            const b = Math.floor(i / 3);
            this.setFunctionModule(a, b, color);
            this.setFunctionModule(b, a, color);
        }
    }

    getAlignmentPatternPositions() {
        if (this.version === 1) return [];
        const numAlign = Math.floor(this.version / 7) + 2;
        const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
        const result = [6];
        for (let pos = this.size - 7; result.length < numAlign; pos -= step) {
            result.splice(1, 0, pos);
        }
        return result;
    }

    addEccAndInterleave(data) {
        const numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[this.ecl][this.version];
        const blockEccLen = QrCode.ECC_CODEWORDS_PER_BLOCK[this.ecl][this.version];
        const rawCodewords = Math.floor(QrCode.getNumRawDataModules(this.version) / 8);
        const numShortBlocks = numBlocks - rawCodewords % numBlocks;
        const shortBlockLen = Math.floor(rawCodewords / numBlocks);

        const blocks = [];
        const rsDiv = QrCode.reedSolomonComputeDivisor(blockEccLen);
        for (let i = 0, k = 0; i < numBlocks; i++) {
            const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
            const dat = data.slice(k, k + datLen);
            k += datLen;
            const ecc = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
            if (i < numShortBlocks) dat.push(0);
            blocks.push(dat.concat(ecc));
        }

        const result = [];
        for (let i = 0; i < blocks[0].length; i++) {
            blocks.forEach((block, j) => {
                if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
                    result.push(block[i]);
                }
            });
        }
        return result;
    }

    static reedSolomonComputeDivisor(degree) {
        const result = new Array(degree).fill(0);
        result[degree - 1] = 1;
        let root = 1;
        for (let i = 0; i < degree; i++) {
            for (let j = 0; j < result.length; j++) {
                result[j] = QrCode.reedSolomonMultiply(result[j], root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = QrCode.reedSolomonMultiply(root, 0x02);
        }
        return result;
    }

    static reedSolomonComputeRemainder(data, divisor) {
        const result = new Array(divisor.length).fill(0);
        for (const b of data) {
            const factor = b ^ result.shift();
            result.push(0);
            divisor.forEach((coef, i) => {
                result[i] ^= QrCode.reedSolomonMultiply(coef, factor);
            });
        }
        return result;
    }

    static reedSolomonMultiply(x, y) {
        let z = 0;
        for (let i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z;
    }

    drawCodewords(data) {
        let i = 0;
        for (let right = this.size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < this.size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? this.size - 1 - vert : vert;
                    if (!this.isFunction[y][x] && i < data.length * 8) {
                        this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
                        i++;
                    }
                }
            }
        }
    }

    applyMask(mask) {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                let invert;
                switch (mask) {
                    case 0: invert = (x + y) % 2 === 0; break;
                    case 1: invert = y % 2 === 0; break;
                    case 2: invert = x % 3 === 0; break;
                    case 3: invert = (x + y) % 3 === 0; break;
                    case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                    case 5: invert = x * y % 2 + x * y % 3 === 0; break;
                    case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
                    case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
                    default: throw new Error('Invalid mask');
                }
                if (!this.isFunction[y][x] && invert) {
                    this.modules[y][x] = !this.modules[y][x];
                }
            }
        }
    }

    getPenaltyScore() {
        let result = 0;

        // Adjacent modules in row/column
        for (let y = 0; y < this.size; y++) {
            let runColor = false;
            let runX = 0;
            for (let x = 0; x < this.size; x++) {
                if (x === 0 || this.modules[y][x] !== runColor) {
                    runColor = this.modules[y][x];
                    runX = 1;
                } else {
                    runX++;
                    if (runX === 5) result += 3;
                    else if (runX > 5) result++;
                }
            }
        }

        for (let x = 0; x < this.size; x++) {
            let runColor = false;
            let runY = 0;
            for (let y = 0; y < this.size; y++) {
                if (y === 0 || this.modules[y][x] !== runColor) {
                    runColor = this.modules[y][x];
                    runY = 1;
                } else {
                    runY++;
                    if (runY === 5) result += 3;
                    else if (runY > 5) result++;
                }
            }
        }

        // 2x2 blocks
        for (let y = 0; y < this.size - 1; y++) {
            for (let x = 0; x < this.size - 1; x++) {
                const color = this.modules[y][x];
                if (color === this.modules[y][x + 1] &&
                    color === this.modules[y + 1][x] &&
                    color === this.modules[y + 1][x + 1]) {
                    result += 3;
                }
            }
        }

        // Balance
        let dark = 0;
        for (const row of this.modules) {
            for (const color of row) {
                if (color) dark++;
            }
        }
        const total = this.size * this.size;
        const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
        result += k * 10;

        return result;
    }
}


/*---- QR Segment class ----*/

class QrSegment {

    static NUMERIC_REGEX = /^[0-9]*$/;
    static ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+./:-]*$/;
    static ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

    constructor(mode, numChars, data) {
        this.mode = mode;
        this.numChars = numChars;
        this.data = data.slice();
    }

    static makeBytes(data) {
        const bb = [];
        for (const b of data) {
            appendBits(b, 8, bb);
        }
        return new QrSegment(QrSegment.Mode.BYTE, data.length, bb);
    }

    static makeNumeric(digits) {
        const bb = [];
        for (let i = 0; i < digits.length;) {
            const n = Math.min(digits.length - i, 3);
            appendBits(parseInt(digits.substr(i, n), 10), n * 3 + 1, bb);
            i += n;
        }
        return new QrSegment(QrSegment.Mode.NUMERIC, digits.length, bb);
    }

    static makeAlphanumeric(text) {
        const bb = [];
        let i;
        for (i = 0; i + 2 <= text.length; i += 2) {
            let temp = QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
            temp += QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
            appendBits(temp, 11, bb);
        }
        if (i < text.length) {
            appendBits(QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb);
        }
        return new QrSegment(QrSegment.Mode.ALPHANUMERIC, text.length, bb);
    }

    static makeSegments(text) {
        if (text === '') return [];
        if (QrSegment.NUMERIC_REGEX.test(text)) return [QrSegment.makeNumeric(text)];
        if (QrSegment.ALPHANUMERIC_REGEX.test(text.toUpperCase())) return [QrSegment.makeAlphanumeric(text.toUpperCase())];

        // UTF-8 byte mode
        const bytes = [];
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c < 0x80) {
                bytes.push(c);
            } else if (c < 0x800) {
                bytes.push(0xC0 | (c >>> 6), 0x80 | (c & 0x3F));
            } else if (0xD800 <= c && c < 0xDC00 && i + 1 < text.length) {
                const d = text.charCodeAt(i + 1);
                if (0xDC00 <= d && d < 0xE000) {
                    const cp = 0x10000 + ((c & 0x3FF) << 10 | (d & 0x3FF));
                    bytes.push(0xF0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 0x3F), 0x80 | ((cp >>> 6) & 0x3F), 0x80 | (cp & 0x3F));
                    i++;
                }
            } else if (c < 0x10000) {
                bytes.push(0xE0 | (c >>> 12), 0x80 | ((c >>> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        }
        return [QrSegment.makeBytes(bytes)];
    }

    static getTotalBits(segs, version) {
        let result = 0;
        for (const seg of segs) {
            const ccbits = seg.mode.numCharCountBits(version);
            result += 4 + ccbits + seg.data.length;
        }
        return result;
    }

    static Mode = {
        NUMERIC: {
            modeBits: 0x1,
            numCharCountBits: (ver) => ver <= 9 ? 10 : ver <= 26 ? 12 : 14
        },
        ALPHANUMERIC: {
            modeBits: 0x2,
            numCharCountBits: (ver) => ver <= 9 ? 9 : ver <= 26 ? 11 : 13
        },
        BYTE: {
            modeBits: 0x4,
            numCharCountBits: (ver) => ver <= 9 ? 8 : 16
        }
    };
}


/*---- Helper functions ----*/

function appendBits(val, len, bb) {
    for (let i = len - 1; i >= 0; i--) {
        bb.push((val >>> i) & 1);
    }
}

function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
}
