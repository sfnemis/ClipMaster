/*
 * ClipMaster - Code snippet detection
 *
 * Copyright (C) 2025 SFN <sfnemis@github.com>
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Decides whether a piece of copied text should be filed under the code
 * category. It only affects which icon and filter an entry gets, so a wrong
 * answer costs nothing; the patterns therefore favour the shapes that prose
 * does not have, such as a shebang, a shell invocation or a statement that ends
 * in a brace or a colon.
 */

const SHELL_PATTERNS = [
    /^\s*(sudo|apt|apt-get|dnf|yum|pacman|zypper|brew|flatpak|snap|systemctl|journalctl)\s+\S/m,
    /^\s*(npm|yarn|pnpm|pip|pip3|cargo|go|gradle|mvn|composer|gem|bundle)\s+\S/m,
    /^\s*(python|python3|node|deno|bun|ruby|perl|php|java|rustc|gcc|g\+\+|clang|make|cmake|meson|ninja)\s+\S/m,
    /^\s*(git|docker|podman|kubectl|helm|terraform|ansible|ssh|scp|rsync|curl|wget)\s+\S/m,
    /^\s*(chmod|chown|mkdir|rm|cp|mv|ln|tar|zip|unzip|grep|sed|awk|find|xargs)\s+-?\S/m,
    /^\s*\$\s+\S/m,
    /^\s*(Get|Set|New|Remove|Invoke|Start|Stop|Out|Write|Read|Import|Export)-[A-Z]\w+/m,
];

const LANGUAGE_PATTERNS = [
    // Declarations and blocks, which prose does not produce.
    /^\s*(const|let|var)\s+[\w$]+\s*=/m,
    /^\s*(function|async function)\s+[\w$]*\s*\(/m,
    /^\s*(export|import)\s+(\{|\*|default|[\w$]+)/m,
    /^\s*(class|interface|enum|struct|trait|impl)\s+\w+[\s{:<]/m,
    /^\s*(def|async def)\s+\w+\s*\(/m,
    /^\s*(fn|pub fn)\s+\w+\s*\(/m,
    /^\s*(func)\s+\w*\s*\(/m,
    /^\s*(public|private|protected)\s+(static\s+)?[\w<>[\]]+\s+\w+\s*\(/m,
    /^\s*(if|for|while|switch|match)\s*\(.*\)\s*\{/m,
    /^\s*(if|for|while|elif|else|try|except|with)\b.*:\s*$/m,
    /^\s*#\s*(include|define|ifdef|ifndef|pragma)\s+\S/m,
    /^\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE)\s+\S/im,
    /^\s*@\w+(\(|\s*$)/m,
    /^\s*[.#][\w-]+\s*\{\s*[\w-]+\s*:/m,
    /^\s*@(media|import|keyframes|font-face)\s+\S/m,
    /\b(console\.log|println!|printf|System\.out\.print|fmt\.Print)\s*\(/,
    /\bmodule\.exports\s*=/,
    /\brequire\s*\(['"]/,
];

const STRUCTURE_HINTS = /[{};]|=>|->|::|\+=|-=|==|!=|&&|\|\|/;

export function isCodeSnippet(text) {
    if (!text || text.length < 8)
        return false;

    const trimmed = text.trim();

    if (trimmed.startsWith('#!'))
        return true;

    if (SHELL_PATTERNS.some(pattern => pattern.test(trimmed)))
        return true;

    if (LANGUAGE_PATTERNS.some(pattern => pattern.test(trimmed)))
        return true;

    // Several indented lines plus operators or punctuation that prose does not
    // use is the last resort, for a snippet whose keywords are not listed above.
    const lines = trimmed.split('\n');
    if (lines.length >= 3) {
        const indented = lines.filter(line => /^[\t ]{2,}\S/.test(line)).length;
        if (indented >= lines.length * 0.3 && STRUCTURE_HINTS.test(trimmed))
            return true;
    }

    return false;
}
