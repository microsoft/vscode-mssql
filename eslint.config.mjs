// @ts-check

import tseslint from 'typescript-eslint';
import notice from "eslint-plugin-notice";
import jsdoc from 'eslint-plugin-jsdoc';
import deprecationPlugin from "eslint-plugin-deprecation";
import { fixupPluginRules } from "@eslint/compat";
import reactRefresh from "eslint-plugin-react-refresh";

const commonRules = {
  "notice/notice": [
    "error",
    {
      template: `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

`,
    }
  ],
  "no-undef": "off",
  "no-unused-vars": "off",
  "constructor-super": "warn",
  "curly": "off",
  "eqeqeq": "warn",
  "no-buffer-constructor": "warn",
  "no-caller": "warn",
  "no-debugger": "warn",
  "no-duplicate-case": "warn",
  "no-duplicate-imports": "off",
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
    "context"
  ], // non-complete list of globals that are easy to access unintentionally
  "no-var": "off",
  "semi": "off",
  "jsdoc/no-types": "warn",
  "no-restricted-syntax": [
    'warn',
    "Literal[raw='null']"
  ],
  "@typescript-eslint/no-explicit-any": "warn",
  // Not really that useful, there are valid reasons to have empty functions
  "@typescript-eslint/no-empty-function": "off",
  "@typescript-eslint/no-inferrable-types": [
    "warn",
    {
      "ignoreParameters": true,
      "ignoreProperties": true
    }
  ],
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      "argsIgnorePattern": "^_"
    }
  ],
  "deprecation/deprecation": "warn",
  "@typescript-eslint/no-floating-promises": [
    "warn",
    {
      "ignoreVoid": true
    }
  ],
  "@typescript-eslint/naming-convention": [
    "warn",
    {
      "selector": "property",
      "modifiers": [
        "private"
      ],
      "format": [
        "camelCase"
      ],
      "leadingUnderscore": "require"
    }
  ],
};



export default [
  {
    files: ['**/*.ts'],
    ignores: ['src/prompts/**/*.ts', 'typings/**.*.d.ts', 'src/reactviews/**/*'],  // Ignore prompts files as they are copied from other repos
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json"
      },
    },
    plugins: {
      notice,
      jsdoc,
      ['@typescript-eslint']: tseslint.plugin,
      // @ts-ignore
      ["deprecation"]: fixupPluginRules(deprecationPlugin),
    },
    rules: {
      ...commonRules
    },
  }, {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: './tsconfig.react.json',
      },
    },
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      ...commonRules
    },
    plugins: {
      notice,
      jsdoc,
      ['@typescript-eslint']: tseslint.plugin,
      // @ts-ignore
      ["deprecation"]: fixupPluginRules(deprecationPlugin),
      ['react-refresh']: reactRefresh
    }
  }
];