// @ts-check

import tseslint from "typescript-eslint";
import notice from "eslint-plugin-notice";
import jsdoc from "eslint-plugin-jsdoc";
import { fixupPluginRules, includeIgnoreFile } from "@eslint/compat";
import reactRecommended from "eslint-plugin-react/configs/recommended.js";
import react from "eslint-plugin-react";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import path from "node:path";
import { fileURLToPath } from "node:url";
import customRules from "eslint-plugin-custom-eslint-rules";
import stylistic from "@stylistic/eslint-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

// Common copyright notice template
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

// Shared rules for all extensions
const sharedRules = {
    ...eslintPluginPrettierRecommended.rules,
    "notice/notice": [
        "error",
        {
            template: copyrightNotice,
        },
    ],
    "no-undef": "off",
    "no-unused-vars": "off",
    "constructor-super": "warn",
    curly: "off",
    eqeqeq: "warn",
    "no-buffer-constructor": "warn",
    "no-caller": "warn",
    "no-debugger": "warn",
    "no-duplicate-case": "warn",
    "no-duplicate-imports": "error",
    "no-eval": "warn",
    "no-async-promise-executor": "off",
    "no-extra-semi": "warn",
    "no-new-wrappers": "warn",
    "no-redeclare": "off",
    "no-sparse-arrays": "warn",
    "no-throw-literal": "off",
    "no-unsafe-finally": "warn",
    "no-unused-labels": "warn",
    "no-restricted-globals": [
        "warn",
        "name",
        "length",
        "event",
        "closed",
        "external",
        "status",
        "origin",
        "orientation",
        "context",
    ],
    "no-var": "off",
    "jsdoc/no-types": "warn",
    "no-restricted-syntax": ["warn", "Literal[raw='null']"],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-deprecated": "warn",
    "@typescript-eslint/no-inferrable-types": [
        "warn",
        {
            ignoreParameters: true,
            ignoreProperties: true,
        },
    ],
    "@typescript-eslint/no-unused-vars": [
        "warn",
        {
            argsIgnorePattern: "^_",
        },
    ],
    "@typescript-eslint/no-floating-promises": [
        "error",
        {
            ignoreVoid: true,
        },
    ],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/naming-convention": [
        "warn",
        {
            selector: "property",
            modifiers: ["private"],
            format: ["camelCase"],
            leadingUnderscore: "require",
        },
    ],
    "@stylistic/semi": "warn",
    "prettier/prettier": [
        "error",
        {
            endOfLine: "auto",
            printWidth: 100,
            bracketSameLine: true,
        },
    ],
};

export default [
    // Global ignores
    {
        ignores: [
            "**/out/**/*",
            "**/dist/**/*",
            "**/node_modules/**/*",
            "**/coverage/**/*",
            "**/*.d.ts",
            "**/sqltoolsservice/**/*",
        ],
    },

    // mssql extension - with React support
    {
        files: [
            "extensions/mssql/src/**/*.ts",
            "extensions/mssql/src/**/*.tsx",
            "extensions/mssql/test/**/*.ts",
        ],
        ignores: [
            ...(includeIgnoreFile(gitignorePath).ignores || []),
            "extensions/mssql/src/prompts/**/*.ts", // Ignore prompts files as they are copied from other repos
        ],
        languageOptions: {
            ...reactRecommended.languageOptions,
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                project: [
                    "./extensions/mssql/tsconfig.extension.json",
                    "./extensions/mssql/tsconfig.react.json",
                ],
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            notice,
            jsdoc,
            ["@typescript-eslint"]: tseslint.plugin,
            react,
            ...eslintPluginPrettierRecommended.plugins,
            "@stylistic": stylistic,
            "custom-eslint-rules": customRules,
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            ...sharedRules,
            "custom-eslint-rules/banned-imports": "error",
        },
    },

    // data-workspace extension
    {
        files: ["extensions/data-workspace/src/**/*.ts", "extensions/data-workspace/test/**/*.ts"],
        ignores: [...(includeIgnoreFile(gitignorePath).ignores || [])],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                project: "./extensions/data-workspace/tsconfig.json",
            },
        },
        plugins: {
            notice,
            jsdoc,
            ["@typescript-eslint"]: tseslint.plugin,
            ...eslintPluginPrettierRecommended.plugins,
            "@stylistic": stylistic,
            "custom-eslint-rules": customRules,
        },
        rules: {
            ...sharedRules,
            "custom-eslint-rules/banned-imports": "error",
        },
    },

    // sql-database-projects extension
    {
        files: [
            "extensions/sql-database-projects/src/**/*.ts",
            "extensions/sql-database-projects/test/**/*.ts",
        ],
        ignores: [...(includeIgnoreFile(gitignorePath).ignores || [])],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                project: "./extensions/sql-database-projects/tsconfig.extension.json",
            },
        },
        plugins: {
            notice,
            jsdoc,
            ["@typescript-eslint"]: tseslint.plugin,
            ...eslintPluginPrettierRecommended.plugins,
            "@stylistic": stylistic,
            "custom-eslint-rules": customRules,
        },
        rules: {
            ...sharedRules,
            "custom-eslint-rules/banned-imports": "error",
        },
    },
];
