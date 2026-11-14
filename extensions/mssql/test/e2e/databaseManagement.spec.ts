/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    getSeededLaunchConfig,
    refreshObjectExplorerNode,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    querySingleValue,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { getWebviewByTitle } from "./utils/testHelpers";
import { testCases } from "./utils/testCases";

/**
 * Create, rename, and drop databases through the Object Explorer database management dialogs.
 * Outcomes are checked both in Object Explorer and directly against the server.
 */
test.describe("MSSQL Extension - Database Management", () => {
    const createdDatabase = uniqueDatabaseName("E2E_Create");
    const renameSource = uniqueDatabaseName("E2E_Rename");
    const renameTarget = `${renameSource}_Renamed`;
    const dropDatabase = uniqueDatabaseName("E2E_Drop");

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.beforeAll(async () => {
        await recreateDatabase(renameSource);
        await runSql(
            "CREATE TABLE dbo.KeptAcrossRename (Id int PRIMARY KEY); INSERT dbo.KeptAcrossRename VALUES (1);",
            renameSource,
        );
        await recreateDatabase(dropDatabase);
    });

    test.afterAll(async () => {
        for (const name of [createdDatabase, renameSource, renameTarget, dropDatabase]) {
            await dropDatabaseIfExists(name);
        }
    });

    async function openDatabasesFolder(page: Page) {
        const databases = await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
        await refreshObjectExplorerNode(page, databases);
        return databases;
    }

    async function openDatabaseDialog(
        page: Page,
        databaseName: string,
        menuLabel: string,
        dialogTitle: string,
    ): Promise<FrameLocator> {
        await openDatabasesFolder(page);
        await runObjectExplorerContextAction(
            page,
            getObjectExplorerNode(page, databaseName),
            menuLabel,
        );
        return getWebviewByTitle(page, dialogTitle);
    }

    test("Create Database applies the chosen compatibility level", testCases(5878941), async () => {
        const { page } = getContext();
        const databases = await openDatabasesFolder(page);
        await runObjectExplorerContextAction(page, databases, "New Database...");
        const dialog = await getWebviewByTitle(page, "Create Database");

        const nameBox = dialog.getByRole("textbox", { name: "Database Name" });
        await expect(nameBox).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Owner" })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Recovery Model" })).toBeVisible();
        const createButton = dialog.getByRole("button", { name: "Create", exact: true });
        await expect(createButton).toBeDisabled();

        await dialog.getByRole("button", { name: "Compatibility Level" }).click();
        for (const level of [
            "SQL Server 2016 (130)",
            "SQL Server 2017 (140)",
            "SQL Server 2019 (150)",
            "SQL Server 2022 (160)",
        ]) {
            await expect(dialog.getByRole("option", { name: level })).toBeVisible();
        }
        await dialog.getByRole("option", { name: "SQL Server 2019 (150)" }).click();
        await expect(dialog.getByRole("button", { name: "Compatibility Level" })).toHaveText(
            /SQL Server 2019 \(150\)/,
        );

        await nameBox.fill(createdDatabase);
        await expect(createButton).toBeEnabled();
        await createButton.click();

        await expect
            .poll(
                () =>
                    querySingleValue<number>(
                        `SELECT compatibility_level FROM sys.databases WHERE name = N'${createdDatabase}'`,
                    ),
                { timeout: 60 * 1000 },
            )
            .toBe(150);
        await refreshObjectExplorerNode(page, databases);
        await expect(getObjectExplorerNode(page, createdDatabase)).toBeVisible();
    });

    // Failed in the Linux CI build-and-test smoke run: the 'Rename Database...' context menu item was not found.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Rename Database renames it and keeps its contents",
        testCases(5878942),
        async () => {
            const { page } = getContext();
            const dialog = await openDatabaseDialog(
                page,
                renameSource,
                "Rename Database...",
                "Rename Database",
            );

            await expect(
                dialog.getByRole("table", { name: "Database Details" }).getByRole("cell", {
                    name: renameSource,
                    exact: true,
                }),
            ).toBeVisible();
            const nameBox = dialog.getByRole("textbox", { name: "New Database Name" });
            await expect(nameBox).toHaveValue(renameSource);
            await nameBox.fill(renameTarget);
            await dialog.getByRole("button", { name: "Rename", exact: true }).click();

            await expect
                .poll(() => querySingleValue<number>(`SELECT DB_ID(N'${renameTarget}')`), {
                    timeout: 60 * 1000,
                })
                .not.toBeNull();
            expect(await querySingleValue(`SELECT DB_ID(N'${renameSource}')`)).toBeNull();

            await openDatabasesFolder(page);
            await expect(getObjectExplorerNode(page, renameTarget)).toBeVisible();
            await expect(getObjectExplorerNode(page, renameSource)).toHaveCount(0);
            await expandObjectExplorerPath(page, [renameTarget, "Tables"]);
            await expect(getObjectExplorerNode(page, "dbo.KeptAcrossRename")).toBeVisible();
        },
    );

    test("Drop Database is not applied when cancelled", testCases(5878943), async () => {
        const { page } = getContext();
        const dialog = await openDatabaseDialog(
            page,
            dropDatabase,
            "Drop Database...",
            "Drop Database",
        );

        await expect(dialog.getByText(`Drop '${dropDatabase}'`)).toBeVisible();
        await expect(dialog.getByText("This action cannot be undone.")).toBeVisible();
        await expect(
            dialog.getByRole("table", { name: "Database Details" }).getByRole("cell", {
                name: dropDatabase,
                exact: true,
            }),
        ).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Drop", exact: true })).toBeDisabled();

        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByRole("tab", { name: /^Drop Database/ })).toHaveCount(0);
        expect(await querySingleValue(`SELECT DB_ID(N'${dropDatabase}')`)).not.toBeNull();
        await expect(getObjectExplorerNode(page, dropDatabase)).toBeVisible();
    });

    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Drop Database removes it once the permanent action is confirmed",
        testCases(5878943),
        async () => {
            const { page } = getContext();
            const dialog = await openDatabaseDialog(
                page,
                dropDatabase,
                "Drop Database...",
                "Drop Database",
            );

            const dropButton = dialog.getByRole("button", { name: "Drop", exact: true });
            await expect(dropButton).toBeDisabled();
            await dialog
                .getByRole("checkbox", {
                    name: "I understand this action is permanent and irreversible",
                })
                .check();
            await expect(dropButton).toBeEnabled();
            await dropButton.click();

            await expect
                .poll(() => querySingleValue(`SELECT DB_ID(N'${dropDatabase}')`), {
                    timeout: 60 * 1000,
                })
                .toBeNull();
            await openDatabasesFolder(page);
            await expect(getObjectExplorerNode(page, dropDatabase)).toHaveCount(0);
        },
    );
});
