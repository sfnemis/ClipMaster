const TERMINAL_IDENTIFIERS = [
    'org.gnome.terminal',
    'org.gnome.console',
    'ptyxis',
    'tilix',
    'alacritty',
    'kitty',
    'wezterm',
    'konsole',
    'xterm',
];

const SHIFT_LEFT = 42;
const CTRL_LEFT = 29;
const INSERT_KEY = 110;
const V_KEY = 47;

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

export function isTerminalWindow(meta = {}) {
    const candidates = [
        normalize(meta.appId),
        normalize(meta.wmClass),
        normalize(meta.wmClassInstance),
        normalize(meta.title),
    ].filter(Boolean);

    return candidates.some(candidate =>
        TERMINAL_IDENTIFIERS.some(identifier =>
            candidate === identifier ||
            candidate.includes(identifier) ||
            candidate.endsWith(`${identifier}.desktop`)
        )
    );
}

export function getPasteKeySpec(meta = {}) {
    if (isTerminalWindow(meta)) {
        return {
            modifiers: [CTRL_LEFT, SHIFT_LEFT],
            keycode: V_KEY,
            label: 'Ctrl+Shift+V',
        };
    }

    return {
        modifiers: [SHIFT_LEFT],
        keycode: INSERT_KEY,
        label: 'Shift+Insert',
    };
}
