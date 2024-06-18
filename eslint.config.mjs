// @ts-check

import tseslint from 'typescript-eslint';
import notice from "eslint-plugin-notice";

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['src/prompts/**/*.ts'],  // Ignore prompts files as they are copied from other repos
    languageOptions: {
      parser: tseslint.parser
    },
    plugins: {
      notice
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

      ]
    }
  }
];