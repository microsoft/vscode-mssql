/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Feature hints for the user survey.
 *
 * When a respondent scores the extension at or below FEATURE_HINT_MAX_SCORE and their feedback
 * describes something the extension already does, the survey offers to show them that feature
 * before they submit.
 *
 * To add a hint:
 * 1. Add its localized `featureName` and `description` (and optional `tryNow.label`) to the
 *    `FeatureHints` class in src/constants/locConstants.ts.
 * 2. Add an entry below with a unique, stable `id`, and a `docsUrl`, a `tryNow` action, or both.
 * 3. Choose a match mode:
 *    - `keyword`: strict, local matching on Submit. List whole words or phrases (case-insensitive)
 *      or RegExps. Best for distinctive terms such as "F5".
 *    - `copilot`: evaluated by a small Copilot model only when the respondent presses
 *      "Check with Copilot" and is signed in to Copilot. Write `promptHint` in English for the
 *      model. Best for needs people describe in many different ways.
 * 4. Optionally add `isAlreadyInUse` to skip the hint for users who already have the feature.
 *
 * The featureHints unit tests validate every entry here.
 */

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { FeatureHints as Loc } from "../../constants/locConstants";
import { FeatureHintDefinition } from "./featureHints";

const keymapExtensionId = "ms-mssql.mssql-database-management-keymap";

export const featureHintDefinitions: readonly FeatureHintDefinition[] = [
    {
        id: "databaseManagementKeymap",
        featureName: Loc.keymapName,
        description: Loc.keymapDescription,
        docsUrl: `https://marketplace.visualstudio.com/items?itemName=${keymapExtensionId}`,
        tryNow: {
            kind: "command",
            command: "extension.open",
            args: [keymapExtensionId],
            label: Loc.viewExtension,
        },
        match: {
            mode: "keyword",
            keywords: [
                "F5",
                "shortcut",
                "shortcuts",
                "keybinding",
                "keybindings",
                "key binding",
                "key bindings",
                "hotkey",
                "hotkeys",
                "hot key",
                "hot keys",
                "keymap",
                "key map",
            ],
        },
        isAlreadyInUse: () => vscode.extensions.getExtension(keymapExtensionId) !== undefined,
    },
    {
        id: "schemaCompare",
        featureName: Loc.schemaCompareName,
        description: Loc.schemaCompareDescription,
        docsUrl: "https://aka.ms/vscode-mssql-schema-compare-docs",
        tryNow: {
            kind: "command",
            command: Constants.cmdSchemaCompare,
            label: Loc.openSchemaCompare,
        },
        match: {
            mode: "copilot",
            promptHint:
                "Compares the schemas of two databases, SQL projects, or .dacpac files, shows the " +
                "differences side by side, and applies them or generates a deployment script. " +
                "Users may ask to diff databases, find schema drift, sync dev/test/prod, or " +
                "migrate schema changes between environments.",
        },
    },
];
