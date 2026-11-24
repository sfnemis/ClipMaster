// Lint configuration for development only. It is not part of the published
// extension; the review guidelines recommend running a linter, and this is the
// one that runs here.
export default [
    {
        files: ['clipmaster@gnome.extension/**/*.js', 'tests/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                // Provided by GNOME Shell to code running in its process.
                global: 'readonly',
                console: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                imports: 'readonly',
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
        rules: {
            'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
            'no-undef': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-console': 'off',
            eqeqeq: ['error', 'smart'],
            'max-len': ['warn', { code: 200, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
            semi: ['error', 'always'],
        },
    },
];
