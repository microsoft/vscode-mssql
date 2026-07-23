/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local ESM Monaco setup shared by webviews that host an editor.
 *
 * The editor must never fall back to @monaco-editor/react's CDN loader: VS Code
 * webviews may be offline and their content-security policy intentionally blocks
 * that network dependency. Consumers must load this module before mounting an
 * Editor or DiffEditor. The editor worker is emitted as dist/views/editorWorker.js
 * and resolved relative to the webview document base.
 */

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import {
    conf as sqlLanguageConfiguration,
    language as sqlMonarchLanguage,
} from "monaco-editor/esm/vs/basic-languages/sql/sql.js";

declare const self: {
    MonacoEnvironment?: {
        getWorker: (workerId: string, label: string) => Worker;
    };
};

self.MonacoEnvironment = {
    getWorker: () => new Worker(new URL("editorWorker.js", document.baseURI), { type: "module" }),
};

const SQL_JOIN_OPERATOR_WORDS = new Set([
    "APPLY",
    "CROSS",
    "FULL",
    "INNER",
    "JOIN",
    "LEFT",
    "OUTER",
    "RIGHT",
]);

monaco.languages.setLanguageConfiguration("sql", sqlLanguageConfiguration);
monaco.languages.setMonarchTokensProvider("sql", {
    ...sqlMonarchLanguage,
    operators: sqlMonarchLanguage.operators?.filter(
        (word) => !SQL_JOIN_OPERATOR_WORDS.has(word.toUpperCase()),
    ),
});

loader.config({ monaco });

/** The bundled namespace — use this instead of window.monaco. */
export const monacoApi = monaco;
