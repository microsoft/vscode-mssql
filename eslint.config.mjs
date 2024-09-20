// @ts-check

import tseslint from "typescript-eslint";
import notice from "eslint-plugin-notice";
import jsdoc from "eslint-plugin-jsdoc";
import deprecationPlugin from "eslint-plugin-deprecation";
import { fixupPluginRules } from "@eslint/compat";
import reactRecommended from "eslint-plugin-react/configs/recommended.js";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      "src/prompts/**/*.ts",
      "**/*.d.ts",
      "src/reactviews/pages/ExecutionPlan/**/*",
    ], // Ignore prompts files as they are copied from other repos
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
      "jsx-a11y": jsxA11y,
      ...eslintPluginPrettierRecommended.plugins
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
        "warn",
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
      "@typescript-eslint/semi": "warn",
      //...jsxA11y.flatConfigs.recommended.rules,
      "prettier/prettier": [
        "warn",
        {
          endOfLine: "auto",
        },
      ],
    },
  },
];
