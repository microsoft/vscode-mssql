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
 *    - `copilot`: evaluated on Submit by a small Copilot model, only when the respondent is
 *      signed in to Copilot; skipped otherwise. Write `promptHint` in English for the model.
 *      Best for needs people describe in many different ways.
 * 4. Optionally add a `screenshot`: add its id to FeatureHintScreenshotId in
 *    src/sharedInterfaces/userSurvey.ts and its image to
 *    src/webviews/pages/UserSurvey/featureHintScreenshots.ts.
 * 5. Optionally add `isAlreadyInUse` to skip the hint for users who already have the feature.
 *
 * At most MAX_FEATURE_HINTS are suggested at once: keyword matches first, then Copilot matches
 * at or above COPILOT_MIN_CONFIDENCE, most confident first.
 *
 * The featureHints unit tests validate every entry here.
 */

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { FeatureHints as Loc } from "../../constants/locConstants";
import { DeploymentType } from "../../sharedInterfaces/deployment";
import { FeatureHintDefinition, FeatureHintTryNow } from "./featureHints";

const keymapExtensionId = "ms-mssql.mssql-database-management-keymap";

/** For features launched from an Object Explorer node, which the survey can't supply. */
const openObjectExplorer: FeatureHintTryNow = {
    kind: "command",
    command: "workbench.view.extension.objectExplorer",
    label: Loc.openObjectExplorer,
};

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
        screenshot: "schemaCompare",
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
    {
        id: "dataTierApplication",
        featureName: Loc.dacpacName,
        description: Loc.dacpacDescription,
        screenshot: "dataTierApplication",
        docsUrl: "https://aka.ms/vscode-mssql-dacpac",
        tryNow: {
            kind: "command",
            command: Constants.cmdDacpacDialog,
            label: Loc.openDataTierApplication,
        },
        match: {
            mode: "keyword",
            keywords: [
                "dacpac",
                "dacpacs",
                "bacpac",
                "bacpacs",
                "data-tier application",
                "data-tier applications",
                "data tier application",
                "data tier applications",
            ],
        },
    },
    {
        id: "localContainer",
        featureName: Loc.localContainerName,
        description: Loc.localContainerDescription,
        screenshot: "localContainer",
        docsUrl:
            "https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-local-container",
        tryNow: {
            kind: "command",
            command: Constants.cmdDeployNewDatabase,
            args: [{ deploymentType: DeploymentType.LocalContainers }],
            label: Loc.createContainer,
        },
        match: {
            mode: "keyword",
            keywords: ["docker", "container", "containers", "containerized"],
        },
    },
    {
        id: "schemaDesigner",
        featureName: Loc.schemaDesignerName,
        description: Loc.schemaDesignerDescription,
        screenshot: "schemaDesigner",
        docsUrl: "https://aka.ms/vscode-mssql-schema-designer-docs",
        tryNow: openObjectExplorer,
        match: {
            mode: "keyword",
            keywords: [
                "ER diagram",
                "ER diagrams",
                "ERD",
                "ERDs",
                "entity relationship",
                "entity-relationship",
                "database diagram",
                "database diagrams",
                "schema diagram",
                "schema diagrams",
            ],
        },
    },
    {
        id: "editData",
        featureName: Loc.editDataName,
        description: Loc.editDataDescription,
        screenshot: "editData",
        docsUrl:
            "https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#view-and-edit-data",
        tryNow: openObjectExplorer,
        match: {
            mode: "copilot",
            promptHint:
                "Opens a table's rows in an editable grid where users can add, update, and " +
                "delete rows, then review and save the changes, without writing INSERT, UPDATE, " +
                "or DELETE statements. Users may ask to edit rows like in SSMS 'Edit Top 200 " +
                "Rows', change cell values directly, or browse table contents in a spreadsheet view.",
        },
    },
    {
        id: "tableDesigner",
        featureName: Loc.tableDesignerName,
        description: Loc.tableDesignerDescription,
        screenshot: "tableDesigner",
        docsUrl: "https://aka.ms/vscode-mssql-table-designer",
        tryNow: openObjectExplorer,
        match: {
            mode: "copilot",
            promptHint:
                "A visual designer for creating a new table or changing an existing one: " +
                "columns, data types, primary and foreign keys, indexes, check constraints, and " +
                "defaults, with a preview of the generated script. Users may ask for a GUI to " +
                "create or alter tables, add columns without writing DDL, or a table designer " +
                "like SSMS.",
        },
    },
    {
        id: "objectSearch",
        featureName: Loc.objectSearchName,
        description: Loc.objectSearchDescription,
        docsUrl: "https://aka.ms/vscode-mssql-object-search",
        tryNow: openObjectExplorer,
        match: {
            mode: "copilot",
            promptHint:
                "Searches a server or database for tables, views, stored procedures, and " +
                "functions by name, and opens or scripts the results. Users may ask to find an " +
                "object quickly, filter a long list of tables, locate which database contains a " +
                "procedure, or search like SSMS Object Explorer Details or Redgate SQL Search.",
        },
    },
    {
        id: "localToCloud",
        featureName: Loc.localToCloudName,
        description: Loc.localToCloudDescription,
        docsUrl: "https://aka.ms/vscode-mssql-local-to-cloud-deployment",
        tryNow: {
            kind: "command",
            command: Constants.cmdDeployNewDatabase,
            args: [{ deploymentType: DeploymentType.LocalToCloud }],
            label: Loc.startDeployment,
        },
        match: {
            mode: "copilot",
            promptHint:
                "A guided wizard that moves a database from a local SQL Server container to " +
                "Azure SQL Database: it checks compatibility, then deploys the schema, or schema " +
                "and data, to a new or existing Azure SQL database. Users may ask to publish or " +
                "migrate a local or dev database to Azure, push a database to the cloud, or go " +
                "from local development to Azure SQL.",
        },
    },
];
