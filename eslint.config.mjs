// @ts-check

import tseslint from 'typescript-eslint';
import notice from "eslint-plugin-notice";
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['src/prompts/**/*.ts', 'typings/**.*.d.ts'],  // Ignore prompts files as they are copied from other repos
    languageOptions: {
      parser: tseslint.parser
    },
    plugins: {
      notice,
      jsdoc
    },
    rules: {
      "notice/notice": [
        "error",
        {
          template: `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

`,
          onNonMatchingHeader: 'prepend',
          messages: {
            whenFailedToMatch: "Missing or incorrectly formatted copyright statement.",
          }
        },

      ],
      "no-undef": "off",
      "no-unused-vars": "off",
      "constructor-super": "error",
      "curly": "off",
      "eqeqeq": "error",
      "no-buffer-constructor": "error",
      "no-caller": "error",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-duplicate-imports": "off",
      "no-eval": "error",
      "no-async-promise-executor": "off",
      "no-extra-semi": "error",
      "no-new-wrappers": "error",
      "no-redeclare": "off",
      "no-sparse-arrays": "error",
      "no-throw-literal": "off",
      "no-unsafe-finally": "error",
      "no-unused-labels": "error",
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
      "jsdoc/no-types": "error",
      "no-restricted-syntax": [
        'error',
        "Literal[raw='null']"
      ],
    },
  }
];