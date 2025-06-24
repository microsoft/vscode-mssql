// @ts-check

import tseslint from "typescript-eslint";
import notice from "eslint-plugin-notice";
import jsdoc from "eslint-plugin-jsdoc";
import deprecationPlugin from "eslint-plugin-deprecation";
import { fixupPluginRules } from "@eslint/compat";
import reactRecommended from "eslint-plugin-react/configs/recommended.js";
import react from "eslint-plugin-react";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import { includeIgnoreFile } from "@eslint/compat";
import path from "node:path";
import { fileURLToPath } from "node:url";
import customRules from "eslint-plugin-custom-eslint-rules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");
import stylistic from "@stylistic/eslint-plugin";

export default [
    {
        ignores: ["out/**/*"],
    },
    {
        files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
        ignores: [
            ...(includeIgnoreFile(gitignorePath).ignores || []),
            "src/views/**/*",
            "src/prompts/**/*.ts", // Ignore prompts files as they are copied from other repos
            "**/out/**/*",
        ],
        languageOptions: {
            ...reactRecommended.languageOptions,
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                project: ["./tsconfig.json", "./tsconfig.react.json"],
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            notice,
            jsdoc,
            ["@typescript-eslint"]: tseslint.plugin,
            // @ts-ignore
            ["deprecation"]: fixupPluginRules(deprecationPlugin),
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
            ...eslintPluginPrettierRecommended.rules,
            "notice/notice": [
                "error",
                {
                    template:
                        "/*---------------------------------------------------------------------------------------------" +
                        "\n" +
                        " *  Copyright (c) Microsoft Corporation. All rights reserved." +
                        "\n" +
                        " *  Licensed under the MIT License. See License.txt in the project root for license information." +
                        "\n" +
                        " *--------------------------------------------------------------------------------------------*/" +
                        "\n" +
                        "\n",
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
            ], // non-complete list of globals that are easy to access unintentionally
            "no-var": "off",
            "jsdoc/no-types": "warn",
            "no-restricted-syntax": ["warn", "Literal[raw='null']"],
            "@typescript-eslint/no-explicit-any": "warn",
            // Not really that useful, there are valid reasons to have empty functions
            "@typescript-eslint/no-empty-function": "off",
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
            "deprecation/deprecation": "warn",
            "@typescript-eslint/no-floating-promises": [
                "error",
                {
                    ignoreVoid: true,
                },
            ],
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
            "custom-eslint-rules/banned-imports": "error",
        },
    },
];
