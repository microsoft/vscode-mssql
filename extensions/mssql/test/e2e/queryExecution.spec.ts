/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { screenshot } from "./utils/screenshotUtils";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    executeQueryAndWait,
    getActiveEditorTab,
    getModifierKey,
    openFileFromDisk,
    openNewQueryEditor,
    waitForQueryExecutionToEnd,
} from "./utils/testHelpers";
import {
    getAuthenticationType,
    getDatabaseName,
    getPassword,
    getProfileName,
    getSavePassword,
    getServerName,
    getUserName,
} from "./utils/envConfigReader";
import { test, expect } from "./baseFixtures";
import { BASIC_PASSWORD_STORE_ARGS, DEFAULT_USER_CONFIG } from "./utils/launchVscodeWithMsSqlExt";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { EditorTitleActions, QuickInput } from "./pageObjects";

/** Editor toolbar action labels, which are the command titles from package.nls.json. */
const TOOLBAR = {
    executeQuery: "Execute Query (MSSQL)",
    cancelQuery: "Cancel Query (MSSQL)",
    revealQueryResult: "Reveal Query Result (MSSQL)",
    connect: "Connect (MSSQL)",
    disconnect: "Disconnect (MSSQL)",
    changeConnection: "Change Connection (MSSQL)",
    changeDatabase: "Change Database (MSSQL)",
    estimatedPlan: "Estimated Plan (MSSQL)",
    enableActualPlan: "Enable Actual Plan (MSSQL)",
    disableActualPlan: "Disable Actual Plan (MSSQL)",
};

/**
 * Actions that package.json shows only while the editor's URI is in `mssql.connections`.
 *
 * Untitled URIs have nothing to encode, so a mismatch in how that list is built shows up only
 * for files on disk (see issue #23115).
 */
const CONNECTED_ACTIONS = [
    TOOLBAR.revealQueryResult,
    TOOLBAR.disconnect,
    TOOLBAR.changeConnection,
    TOOLBAR.changeDatabase,
    TOOLBAR.estimatedPlan,
    TOOLBAR.enableActualPlan,
];

const CONNECTED_TOOLBAR = {
    available: [TOOLBAR.executeQuery, ...CONNECTED_ACTIONS],
    unavailable: [TOOLBAR.connect],
};

test.describe("MSSQL Extension - Query Execution", async () => {
    const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-query-execution-"));

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            extraLaunchArgs: BASIC_PASSWORD_STORE_ARGS,
            initialConfig: {
                ...DEFAULT_USER_CONFIG,
                // Save As then takes a typed path instead of opening the OS dialog.
                "files.simpleDialog.enable": true,
                // Native menus hide "More Actions..." from Playwright; see EditorTitleActions.
                "window.menuStyle": "custom",
            },
        },
        afterLaunch: async ({ page: vsCodePage }) => {
            const serverName = getServerName();
            const databaseName = getDatabaseName();
            const authType = getAuthenticationType();
            const userName = getUserName();
            const password = getPassword();
            const savePassword = getSavePassword();
            const profileName = getProfileName();
            await addDatabaseConnection(
                vsCodePage,
                serverName,
                databaseName,
                authType,
                userName,
                password,
                savePassword,
                profileName,
            );
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await openNewQueryEditor(vsCodePage);
            const dropTestDatabaseScript = `
USE master;
ALTER DATABASE TestDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE TestDB;`;
            await enterTextIntoQueryEditor(vsCodePage, dropTestDatabaseScript);
            await executeQueryAndWait(vsCodePage);
        },
    });

    test.afterAll(() => {
        if (path.dirname(scriptsDir) !== os.tmpdir()) {
            throw new Error(`Refusing to clean up unexpected scripts directory: ${scriptsDir}`);
        }
        fs.rmSync(scriptsDir, { recursive: true, force: true });
    });

    /**
     * A fresh folder for each test, so a retry or a repeated run never finds a file from an
     * earlier attempt (Save As would ask to overwrite it, Quick Open would reuse its editor).
     */
    function createTestDir(): string {
        return fs.mkdtempSync(path.join(scriptsDir, "test-"));
    }

    test.beforeEach(async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        await screenshot(vsCodePage, testInfo, "BeforeEach");
    });

    test("Create table, insert data, and execute query", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        await openNewQueryEditor(vsCodePage);
        await screenshot(vsCodePage, testInfo, "NewEditorOpened");

        const createTestDB = "CREATE DATABASE TestDB;";
        await enterTextIntoQueryEditor(vsCodePage, createTestDB);
        await screenshot(vsCodePage, testInfo, "CreateDbTyped");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "CreateDbExecuted");

        await screenshot(vsCodePage, testInfo, "NewEditorOpened2");
        await openNewQueryEditor(vsCodePage);

        const sqlScript = `
USE TestDB;
CREATE TABLE TestTable (ID INT PRIMARY KEY, Name VARCHAR(50), Age INT);
INSERT INTO TestTable (ID, Name, Age) VALUES (1, 'Doe', 30);
SELECT Name FROM TestTable;`;

        await enterTextIntoQueryEditor(vsCodePage, sqlScript);
        await screenshot(vsCodePage, testInfo, "CreateTableTyped");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "CreateTableExecuted");

        const nameQueryResult = await vsCodePage.getByText("Doe");
        await expect(nameQueryResult).toBeVisible({ timeout: 10000 });
    });

    test("Toolbar keeps the connected actions when an untitled editor is saved to disk", async () => {
        const { page: vsCodePage } = getContext();
        const toolbar = new EditorTitleActions(vsCodePage);
        // Spaces, the ampersand and the parentheses are all percent-encoded in the file URI.
        const filePath = path.join(createTestDir(), "My Scripts", "Sales & Ops (Q1).sql");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // New editors copy the connection made in afterLaunch.
        await openNewQueryEditor(vsCodePage);
        await toolbar.expectActions(CONNECTED_TOOLBAR);

        await enterTextIntoQueryEditor(vsCodePage, "SELECT 1;");
        await vsCodePage.keyboard.press(`${getModifierKey()}+S`);
        const saveDialog = new QuickInput(vsCodePage);
        await expect(saveDialog.widget).toBeVisible();
        await saveDialog.input.fill(filePath);
        await expect(saveDialog.input).toHaveValue(filePath);
        await saveDialog.input.press("Enter");

        await expect(getActiveEditorTab(vsCodePage)).toContainText(path.basename(filePath), {
            timeout: 15 * 1000,
        });
        await toolbar.expectActions(CONNECTED_TOOLBAR);
    });

    test("Toolbar actions work on a SQL file opened from disk", async () => {
        const { page: vsCodePage } = getContext();
        const toolbar = new EditorTitleActions(vsCodePage);
        const filePath = path.join(createTestDir(), "long-running.sql");
        // Long enough to check the toolbar while it runs. The test cancels it instead of waiting.
        fs.writeFileSync(filePath, "WAITFOR DELAY '00:00:30';\n");

        // Opened SQL files also copy the connection made in afterLaunch.
        await openFileFromDisk(vsCodePage, filePath);
        await toolbar.expectActions(CONNECTED_TOOLBAR);

        // The actual plan setting is tracked per URI, separately from the connection.
        await toolbar.click(TOOLBAR.enableActualPlan);
        await toolbar.expectActions({
            available: [TOOLBAR.disableActualPlan],
            unavailable: [TOOLBAR.enableActualPlan],
        });
        await toolbar.click(TOOLBAR.disableActualPlan);
        await toolbar.expectActions({
            available: [TOOLBAR.enableActualPlan],
            unavailable: [TOOLBAR.disableActualPlan],
        });

        // Running queries are tracked by file path rather than by URI.
        await toolbar.click(TOOLBAR.executeQuery);
        await toolbar.expectActions({
            available: [TOOLBAR.cancelQuery],
            unavailable: [TOOLBAR.executeQuery, TOOLBAR.disconnect],
        });
        await toolbar.click(TOOLBAR.cancelQuery);
        await waitForQueryExecutionToEnd(vsCodePage);
        await toolbar.expectActions(CONNECTED_TOOLBAR);

        await toolbar.click(TOOLBAR.disconnect);
        await toolbar.expectActions({
            available: [TOOLBAR.connect],
            unavailable: CONNECTED_ACTIONS,
        });
    });
});
