/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E tests for database management operations:
 *  - Create database
 *  - Rename database
 *  - Drop database
 *  - Create database with specific collation
 *
 * All operations are performed via the SQL query editor and verified through
 * sys catalog views. Complexity: Easy.
 */

import { screenshot } from "./utils/screenshotUtils";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    openNewQueryEditor,
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
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const E2E_DB_NAME = "E2ETestManagementDB";
const E2E_DB_RENAMED = "E2ETestManagementDB_Renamed";

test.describe("MSSQL Extension - Database Management", async () => {
    const getContext = useSharedVsCodeLifecycle({
        afterLaunch: async ({ page: vsCodePage }) => {
            await addDatabaseConnection(
                vsCodePage,
                getServerName(),
                getDatabaseName(),
                getAuthenticationType(),
                getUserName(),
                getPassword(),
                getSavePassword(),
                getProfileName(),
            );
        },
        beforeClose: async ({ page: vsCodePage }) => {
            // Best-effort cleanup: drop both the original and renamed test databases.
            await openNewQueryEditor(vsCodePage);
            const cleanup = `
USE master;
IF DB_ID(N'${E2E_DB_NAME}') IS NOT NULL
BEGIN
    ALTER DATABASE [${E2E_DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${E2E_DB_NAME}];
END
IF DB_ID(N'${E2E_DB_RENAMED}') IS NOT NULL
BEGIN
    ALTER DATABASE [${E2E_DB_RENAMED}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${E2E_DB_RENAMED}];
END`;
            await enterTextIntoQueryEditor(vsCodePage, cleanup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        },
    });

    test("Create a new database via SQL", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Ensure the database does not already exist from a previous run
        await openNewQueryEditor(vsCodePage);
        const ensureClean = `
USE master;
IF DB_ID(N'${E2E_DB_NAME}') IS NOT NULL
BEGIN
    ALTER DATABASE [${E2E_DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${E2E_DB_NAME}];
END`;
        await enterTextIntoQueryEditor(vsCodePage, ensureClean);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "pre-create-cleanup");

        // Create the database
        await openNewQueryEditor(vsCodePage);
        const createScript = `CREATE DATABASE [${E2E_DB_NAME}];`;
        await enterTextIntoQueryEditor(vsCodePage, createScript);
        await screenshot(vsCodePage, testInfo, "create-db-typed");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "create-db-executed");

        // Verify it exists in sys.databases
        await openNewQueryEditor(vsCodePage);
        const verifyScript = `SELECT name FROM sys.databases WHERE name = N'${E2E_DB_NAME}';`;
        await enterTextIntoQueryEditor(vsCodePage, verifyScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "verify-db-exists");

        await expect(vsCodePage.getByText(E2E_DB_NAME)).toBeVisible({ timeout: 15 * 1000 });
    });

    test("Rename a database via SQL (ALTER DATABASE MODIFY NAME)", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Pre-condition: ensure the source DB exists and the renamed DB does not
        await openNewQueryEditor(vsCodePage);
        const setup = `
USE master;
IF DB_ID(N'${E2E_DB_RENAMED}') IS NOT NULL
BEGIN
    ALTER DATABASE [${E2E_DB_RENAMED}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${E2E_DB_RENAMED}];
END
IF DB_ID(N'${E2E_DB_NAME}') IS NULL
    CREATE DATABASE [${E2E_DB_NAME}];`;
        await enterTextIntoQueryEditor(vsCodePage, setup);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "rename-setup");

        // Rename the database
        await openNewQueryEditor(vsCodePage);
        const renameScript = `
USE master;
ALTER DATABASE [${E2E_DB_NAME}] MODIFY NAME = [${E2E_DB_RENAMED}];`;
        await enterTextIntoQueryEditor(vsCodePage, renameScript);
        await screenshot(vsCodePage, testInfo, "rename-typed");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "rename-executed");

        // Verify renamed database exists and old name is gone
        await openNewQueryEditor(vsCodePage);
        const verifyScript = `
SELECT
    CASE WHEN DB_ID(N'${E2E_DB_RENAMED}') IS NOT NULL THEN 'RENAMED_EXISTS' ELSE 'RENAMED_MISSING' END AS renamed_status,
    CASE WHEN DB_ID(N'${E2E_DB_NAME}') IS NULL THEN 'ORIGINAL_GONE' ELSE 'ORIGINAL_STILL_EXISTS' END AS original_status;`;
        await enterTextIntoQueryEditor(vsCodePage, verifyScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "rename-verified");

        await expect(vsCodePage.getByText("RENAMED_EXISTS")).toBeVisible({ timeout: 15 * 1000 });
        await expect(vsCodePage.getByText("ORIGINAL_GONE")).toBeVisible({ timeout: 15 * 1000 });
    });

    test("Drop a database via SQL", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Pre-condition: ensure a database exists to drop
        await openNewQueryEditor(vsCodePage);
        const setup = `
USE master;
IF DB_ID(N'${E2E_DB_NAME}') IS NULL AND DB_ID(N'${E2E_DB_RENAMED}') IS NULL
    CREATE DATABASE [${E2E_DB_NAME}];`;
        await enterTextIntoQueryEditor(vsCodePage, setup);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "drop-setup");

        // Drop whichever variant exists
        await openNewQueryEditor(vsCodePage);
        const dropScript = `
USE master;
IF DB_ID(N'${E2E_DB_NAME}') IS NOT NULL
BEGIN
    ALTER DATABASE [${E2E_DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${E2E_DB_NAME}];
END
IF DB_ID(N'${E2E_DB_RENAMED}') IS NOT NULL
BEGIN
    ALTER DATABASE [${E2E_DB_RENAMED}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${E2E_DB_RENAMED}];
END`;
        await enterTextIntoQueryEditor(vsCodePage, dropScript);
        await screenshot(vsCodePage, testInfo, "drop-typed");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "drop-executed");

        // Verify neither database exists
        await openNewQueryEditor(vsCodePage);
        const verifyScript = `
SELECT
    CASE
        WHEN DB_ID(N'${E2E_DB_NAME}') IS NULL AND DB_ID(N'${E2E_DB_RENAMED}') IS NULL
        THEN 'DB_DROPPED'
        ELSE 'DB_STILL_EXISTS'
    END AS drop_status;`;
        await enterTextIntoQueryEditor(vsCodePage, verifyScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "drop-verified");

        await expect(vsCodePage.getByText("DB_DROPPED")).toBeVisible({ timeout: 15 * 1000 });
    });

    test("Create database with specific collation and verify properties", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        const collationDbName = "E2ECollationTestDB";

        // Cleanup in case DB exists from a prior run
        await openNewQueryEditor(vsCodePage);
        const cleanup = `
USE master;
IF DB_ID(N'${collationDbName}') IS NOT NULL
BEGIN
    ALTER DATABASE [${collationDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${collationDbName}];
END`;
        await enterTextIntoQueryEditor(vsCodePage, cleanup);
        await executeQuery(vsCodePage);

        // Create DB with explicit collation
        await openNewQueryEditor(vsCodePage);
        const createScript = `CREATE DATABASE [${collationDbName}] COLLATE SQL_Latin1_General_CP1_CI_AS;`;
        await enterTextIntoQueryEditor(vsCodePage, createScript);
        await screenshot(vsCodePage, testInfo, "create-collation-db-typed");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "create-collation-db-executed");

        // Verify the collation
        await openNewQueryEditor(vsCodePage);
        const verifyScript = `SELECT collation_name FROM sys.databases WHERE name = N'${collationDbName}';`;
        await enterTextIntoQueryEditor(vsCodePage, verifyScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "verify-collation");

        await expect(vsCodePage.getByText("SQL_Latin1_General_CP1_CI_AS")).toBeVisible({
            timeout: 15 * 1000,
        });

        // Cleanup
        await openNewQueryEditor(vsCodePage);
        const dropCleanup = `
USE master;
ALTER DATABASE [${collationDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [${collationDbName}];`;
        await enterTextIntoQueryEditor(vsCodePage, dropCleanup);
        await executeQuery(vsCodePage);
    });
});
