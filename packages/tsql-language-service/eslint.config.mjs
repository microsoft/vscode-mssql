/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

import path from "node:path";
import { fileURLToPath } from "node:url";
import notice from "eslint-plugin-notice";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const copyrightNotice =
    "/*---------------------------------------------------------------------------------------------" +
    "\n" +
    " *  Copyright (c) Microsoft Corporation. All rights reserved." +
    "\n" +
    " *  Licensed under the MIT License. See License.txt in the project root for license information." +
    "\n" +
    " *--------------------------------------------------------------------------------------------*/" +
    "\n" +
    "\n";

const commonRules = {
    ...eslintPluginPrettierRecommended.rules,
    "notice/notice": ["error", { template: copyrightNotice }],
    "no-duplicate-imports": "error",
};

export default [
    { ignores: ["dist/**/*", "node_modules/**/*"] },
    {
        files: ["src/**/*.ts", "src/**/*.mts"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                tsconfigRootDir: packageDirectory,
                project: "./tsconfig.json",
            },
        },
        plugins: {
            notice,
            "@typescript-eslint": tseslint.plugin,
            ...eslintPluginPrettierRecommended.plugins,
        },
        rules: {
            ...commonRules,
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
        },
    },
    {
        files: [
            "test/**/*.js",
            "scripts/**/*.mjs",
            "benchmarks/worker-comparison.mjs",
            "benchmarks/large-corpora.mjs",
            "eslint.config.mjs",
        ],
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        plugins: { notice, ...eslintPluginPrettierRecommended.plugins },
        rules: commonRules,
    },
];
