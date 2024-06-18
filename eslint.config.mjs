// @ts-check

import tseslint from 'typescript-eslint';
import notice from "eslint-plugin-notice";
import microsoftEslintPlugin from '@microsoft/eslint-plugin-sdl';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      microsoftEslintPlugin,
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
            whenFailedToMatch: "Couldn't find copyright statement",
            whenOutsideTolerance: "The copyright statement isn't in the right format"
          }
        },

      ]
    }
  }
];