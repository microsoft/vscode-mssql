// @ts-check

import tseslint from 'typescript-eslint';
import notice from "eslint-plugin-notice";
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['src/prompts/**/*.ts'],  // Ignore prompts files as they are copied from other repos
    languageOptions: {
      parser: tseslint.parser
    },
    plugins: {
      notice,
      jsdoc
    },
    rules: {
      "notice/notice": [
        "warn",
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
    },
  }
];