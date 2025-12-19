// @ts-check

import tseslint from "typescript-eslint";
import notice from "eslint-plugin-notice";
import jsdoc from "eslint-plugin-jsdoc";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import { includeIgnoreFile } from "@eslint/compat";
import path from "node:path";
import { fileURLToPath } from "node:url";
import stylistic from "@stylistic/eslint-plugin";
import customRules from "eslint-plugin-custom-eslint-rules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, "../../.gitignore");

export default [
    {
        ignores: ["out/**/*", "dist/**/*"],
    },
    {
        files: ["src/**/*.ts", "test/**/*.ts"],
        ignores: [
            ...(includeIgnoreFile(gitignorePath).ignores || []),
            "**/out/**/*",
        ],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                project: "./tsconfig.json",
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
            "custom-eslint-rules/banned-imports": "error",
        },
    },
];
