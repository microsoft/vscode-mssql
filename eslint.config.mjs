export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/out/**",
            "**/dist/**",
            "**/coverage/**",
            "**/.vscode-test/**",
            "**/.yarn/**",
        ],
    },
    {
        files: ["scripts/**/*.js", "scripts/**/*.mjs", "*.js", "*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
        },
        rules: {
            eqeqeq: "warn",
            "no-debugger": "warn",
            "no-duplicate-imports": "error",
            "no-eval": "warn",
            "no-throw-literal": "warn",
        },
    },
    {
        files: ["scripts/**/*.cjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "script",
        },
    },
];
