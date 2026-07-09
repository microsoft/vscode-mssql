/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local ESM Monaco (doc 04 §6.3): Query Studio must never load editor code
 * from a CDN — the webview may be offline and the harness environment has no
 * network. Monaco is bundled INTO this webview bundle; the editor worker is
 * its own bundle entry (dist/views/editorWorker.js) instantiated relative to
 * the document base (<base href> points at dist/views/).
 *
 * Import this module FIRST in index.tsx so `loader.config({ monaco })` wins
 * before any @monaco-editor/react Editor mounts (otherwise the loader falls
 * back to its jsdelivr AMD default — exactly the failure the
 * querystudio-open harness scenario caught).
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
