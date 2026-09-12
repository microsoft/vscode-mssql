/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getAuthenticationType,
    getPassword,
    getServerName,
    getUserName,
} from "../utils/envConfigReader";

export const GRID_PROFILE_NAME = "e2e-grid";

/**
 * Editor settings that make `setQueryText` deterministic.
 *
 * Without these, pasted or typed SQL can be rewritten underneath the test: the language service
 * offers completions, and a newline while the suggest widget is open accepts a suggestion rather
 * than inserting a line break. Auto-closing brackets and quotes compound it.
 */
const EDITOR_DETERMINISM = {
    "editor.acceptSuggestionOnEnter": "off",
    "editor.quickSuggestions": { other: false, comments: false, strings: false },
    "editor.suggestOnTriggerCharacters": false,
    "editor.wordBasedSuggestions": "off",
    "editor.tabCompletion": "off",
    "editor.parameterHints.enabled": false,
    "editor.autoClosingBrackets": "never",
    "editor.autoClosingQuotes": "never",
    "editor.formatOnType": false,
    "editor.formatOnPaste": false,
};

/**
 * Shortcut assignments for the grid suite.
 *
 * Only `ctrlcmd+a` and `ctrlcmd+c` have built-in defaults (see `getDefaultConfig` in
 * src/webviews/common/keyboardUtils.ts); the rest come from `mssql.shortcuts`, and the ones
 * below ship with an empty binding. Pinning them here means the shortcut tests assert real
 * behaviour instead of asserting against no binding at all.
 */
const GRID_SHORTCUTS = {
    // Clipboard
    "event.resultGrid.copySelection": "ctrlcmd+c",
    "event.resultGrid.copyWithHeaders": "ctrlcmd+shift+c",
    "event.resultGrid.copyAllHeaders": "ctrlcmd+shift+h",
    "event.resultGrid.copyAsCSV": "ctrlcmd+alt+1",
    "event.resultGrid.copyAsJSON": "ctrlcmd+alt+2",
    "event.resultGrid.copyAsInsert": "ctrlcmd+alt+3",
    "event.resultGrid.copyAsInClause": "ctrlcmd+alt+4",

    // Export
    "event.queryResults.saveAsCSV": "ctrlcmd+alt+5",
    "event.queryResults.saveAsJSON": "ctrlcmd+alt+6",
    "event.queryResults.saveAsExcel": "ctrlcmd+alt+7",
    "event.queryResults.saveAsInsert": "ctrlcmd+alt+8",

    // Selection
    "event.resultGrid.selectAll": "ctrlcmd+a",
    "event.resultGrid.selectColumn": "ctrl+space",
    "event.resultGrid.selectRow": "shift+space",
    "event.resultGrid.expandSelectionLeft": "shift+left",
    "event.resultGrid.expandSelectionRight": "shift+right",
    "event.resultGrid.expandSelectionUp": "shift+up",
    "event.resultGrid.expandSelectionDown": "shift+down",

    // Navigation. Deliberately not ctrlcmd+left/right, which the workbench binds to word-wise
    // cursor movement and can consume before the webview sees them.
    "event.resultGrid.moveToRowStart": "ctrlcmd+alt+left",
    "event.resultGrid.moveToRowEnd": "ctrlcmd+alt+right",

    // Column operations
    "event.resultGrid.toggleSort": "alt+shift+o",
    "event.resultGrid.openFilterMenu": "ctrlcmd+alt+f",
    "event.resultGrid.openColumnMenu": "f3",
    "event.resultGrid.changeColumnWidth": "alt+shift+s",

    // View
    "event.queryResults.switchToResultsTab": "ctrl+alt+r",
    "event.queryResults.switchToMessagesTab": "ctrl+alt+y",
    "event.queryResults.switchToTextView": "ctrlcmd+alt+t",
    "event.queryResults.maximizeGrid": "ctrlcmd+alt+m",
};

/** Bindings the specs press, kept next to the map above so they cannot drift apart. */
export const GRID_KEYS = {
    copy: "ctrlcmd+c",
    copyWithHeaders: "ctrlcmd+shift+c",
    moveToRowStart: "Control+Alt+ArrowLeft",
    moveToRowEnd: "Control+Alt+ArrowRight",
    selectColumn: "Control+Space",
    selectRow: "Shift+Space",
    toggleSort: "Alt+Shift+O",
    switchToTextView: "Control+Alt+T",
    maximizeGrid: "Control+Alt+M",
} as const;

/**
 * Builds the settings.json contents for a grid e2e VS Code instance.
 *
 * The connection profile is seeded rather than entered through the connection dialog. With
 * `savePassword: false` the extension reads the inline password straight from settings instead
 * of consulting the credential store (see `addSavedPassword` in src/models/connectionStore.ts),
 * so no dialog, no credential prompt, and no certificate checkbox are involved.
 */
export function getGridLaunchConfig(overrides: Record<string, unknown> = {}) {
    return {
        "mssql.showChangelogOnUpdate": false,
        // The preview grid is the subject of this suite; the classic grid is out of scope.
        "mssql.preview.betaResultsGrid": true,
        "mssql.openQueryResultsInTabByDefault": false,
        "mssql.openQueryResultsInTabByDefaultDoNotShowPrompt": true,
        "mssql.persistQueryResultTabs": true,
        // VS Code's simple save dialog is an HTML workbench surface, so export tests can
        // choose a deterministic temp path without relying on native dialog automation.
        "files.simpleDialog.enable": true,
        "mssql.connections": [
            {
                profileName: GRID_PROFILE_NAME,
                server: getServerName(),
                database: "master",
                authenticationType:
                    getAuthenticationType() === "SQL Login" ? "SqlLogin" : "Integrated",
                user: getUserName(),
                password: getPassword(),
                savePassword: false,
                trustServerCertificate: true,
                connectTimeout: 30,
            },
        ],
        "mssql.shortcuts": GRID_SHORTCUTS,
        ...EDITOR_DETERMINISM,
        ...overrides,
    };
}
