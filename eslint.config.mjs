// @ts-check

import tseslint from 'typescript-eslint';
import notice from "eslint-plugin-notice";

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser
    },
    plugins: {
      notice
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
            whenFailedToMatch: "Couldn't find copyright statement",
            whenOutsideTolerance: "The copyright statement isn't in the right format"
          }
        },

      ]
    }
  }
];