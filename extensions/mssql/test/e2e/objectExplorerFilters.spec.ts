/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    expandObjectExplorerPath,
    getSeededLaunchConfig,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import {
    applyFilterDialog,
    clickInlineAction,
    closeFilterDialog,
    closeFilterDialogIfOpen,
    expectVisibleNodes,
    fillFilterValues,
    FilterEntryPoint,
    folderLabel,
    getClearPropertyButton,
    getFilterOperator,
    getFilterValueInput,
    getFolderNode,
    openFilterDialog,
    selectFilterOperator,
    waitForFolderState,
} from "./utils/objectExplorerFilterHelpers";
import { Tag } from "./utils/tags";

const TABLES = "Tables";
const TABLE_NODE = /^(dbo|sales)\./;
const ALL_TABLES = [
    "dbo.Customers",
    "dbo.OrderLines",
    "dbo.Orders",
    "sales.Customers",
    "sales.Invoices",
];

/**
 * Object Explorer filters on the Tables folder of a seeded database: setting filters from each entry
 * point, the dialog's per-row Clear and Clear All buttons, editing an applied filter, and removing
 * it. Each test starts from an unfiltered, expanded Tables folder and checks which table nodes the
 * folder shows.
 */
test.describe("MSSQL Extension - Object Explorer filters", () => {
    const databaseName = uniqueDatabaseName("E2E_OEFilter");

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        await runSql(
            fs.readFileSync(
                path.join(__dirname, "..", "resources", "e2e", "objectExplorerFilters", "seed.sql"),
                "utf8",
            ),
            databaseName,
        );
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test.beforeEach(async () => {
        const { page } = getContext();
        await closeFilterDialogIfOpen(page);
        const tables = await expandObjectExplorerPath(page, [
            SEEDED_PROFILE_NAME,
            "Databases",
            databaseName,
            folderLabel(TABLES),
        ]);
        if (/\(filtered\)/.test((await tables.getAttribute("aria-label")) ?? "")) {
            await clickInlineAction(page, tables, "Clear Filters");
        }
        await waitForFolderState(page, TABLES, false);
        await expectVisibleNodes(page, TABLE_NODE, ALL_TABLES);
    });

    /** Applies filter values to the Tables folder and waits for the filtered folder to load. */
    async function applyTablesFilter(
        page: Page,
        values: Record<string, string>,
        entryPoint: FilterEntryPoint = "inline action",
    ): Promise<void> {
        const dialog = await openFilterDialog(page, getFolderNode(page, TABLES), entryPoint);
        await fillFilterValues(dialog, values);
        await applyFilterDialog(page, dialog);
        await waitForFolderState(page, TABLES, true);
    }

    test(
        "Filter inline action filters the Tables folder by name",
        { ...testCases(5878868), tag: Tag.pullRequest },
        async () => {
            const { page } = getContext();
            const dialog = await openFilterDialog(
                page,
                getFolderNode(page, TABLES),
                "inline action",
            );

            await expect(dialog.getByLabel(new RegExp(`/${databaseName}/Tables$`))).toBeVisible();
            for (const property of ["Name", "Schema", "Owner"]) {
                await expect(getFilterValueInput(dialog, property)).toHaveValue("");
                await expect(getFilterOperator(dialog, property)).toHaveText("Contains");
                await expect(getClearPropertyButton(dialog, property)).toBeDisabled();
            }

            await fillFilterValues(dialog, { Name: "Order" });
            await expect(getClearPropertyButton(dialog, "Name")).toBeEnabled();
            await applyFilterDialog(page, dialog);

            await waitForFolderState(page, TABLES, true);
            await expectVisibleNodes(page, TABLE_NODE, ["dbo.OrderLines", "dbo.Orders"]);
        },
    );

    // Failed in the E2E nightly flaky run even with the keyring prompt fixed: a filtered folder's children
    // or filter state did not update (toHaveCount(0) still saw 1).
    // TODO: Stabilize this test, then remove its flaky tag.
    test(
        "Filter context menu item filters the Tables folder by schema",
        { ...testCases(5878868), tag: Tag.flaky },
        async () => {
            const { page } = getContext();
            await applyTablesFilter(page, { Schema: "sales" }, "context menu");

            await expectVisibleNodes(page, TABLE_NODE, ["sales.Customers", "sales.Invoices"]);
        },
    );

    test("Filters on several properties must all match", testCases(5878868), async () => {
        const { page } = getContext();
        await applyTablesFilter(page, { Name: "Customers", Schema: "sales" });

        await expectVisibleNodes(page, TABLE_NODE, ["sales.Customers"]);
    });

    test("Clear button resets only its own property row", testCases(5878868), async () => {
        const { page } = getContext();
        const dialog = await openFilterDialog(page, getFolderNode(page, TABLES), "inline action");
        await fillFilterValues(dialog, { Name: "Customers", Schema: "sales" });

        await getClearPropertyButton(dialog, "Name").click();

        await expect(getFilterValueInput(dialog, "Name")).toHaveValue("");
        await expect(getClearPropertyButton(dialog, "Name")).toBeDisabled();
        await expect(getFilterValueInput(dialog, "Schema")).toHaveValue("sales");
        await expect(getClearPropertyButton(dialog, "Schema")).toBeEnabled();

        await applyFilterDialog(page, dialog);
        await waitForFolderState(page, TABLES, true);
        await expectVisibleNodes(page, TABLE_NODE, ["sales.Customers", "sales.Invoices"]);
    });

    test("Clear All button resets every property row", testCases(5878868), async () => {
        const { page } = getContext();
        const dialog = await openFilterDialog(page, getFolderNode(page, TABLES), "context menu");
        await fillFilterValues(dialog, { Name: "Order", Schema: "dbo", Owner: "dbo" });

        await dialog.getByRole("button", { name: "Clear All", exact: true }).click();

        for (const property of ["Name", "Schema", "Owner"]) {
            await expect(getFilterValueInput(dialog, property)).toHaveValue("");
            await expect(getClearPropertyButton(dialog, property)).toBeDisabled();
        }

        await applyFilterDialog(page, dialog);
        await waitForFolderState(page, TABLES, false);
        await expectVisibleNodes(page, TABLE_NODE, ALL_TABLES);
    });

    test("Filter dialog is pre-populated with the applied filter", testCases(5878868), async () => {
        const { page } = getContext();
        await applyTablesFilter(page, { Name: "Customers", Schema: "sales" });

        const dialog = await openFilterDialog(page, getFolderNode(page, TABLES), "inline action");
        await expect(getFilterValueInput(dialog, "Name")).toHaveValue("Customers");
        await expect(getFilterValueInput(dialog, "Schema")).toHaveValue("sales");
        await expect(getFilterValueInput(dialog, "Owner")).toHaveValue("");
        await expect(getClearPropertyButton(dialog, "Name")).toBeEnabled();

        // Closing without applying keeps the existing filter.
        await closeFilterDialog(page, dialog);
        await waitForFolderState(page, TABLES, true);
        await expectVisibleNodes(page, TABLE_NODE, ["sales.Customers"]);
    });

    test(
        "Editing the value and operator of an applied filter updates the folder",
        testCases(5878868),
        async () => {
            const { page } = getContext();
            await applyTablesFilter(page, { Name: "Order" });
            await expectVisibleNodes(page, TABLE_NODE, ["dbo.OrderLines", "dbo.Orders"]);

            let dialog = await openFilterDialog(page, getFolderNode(page, TABLES), "context menu");
            await expect(getFilterValueInput(dialog, "Name")).toHaveValue("Order");
            await selectFilterOperator(dialog, "Name", "Ends With");
            await fillFilterValues(dialog, { Name: "Lines" });
            await applyFilterDialog(page, dialog);

            await waitForFolderState(page, TABLES, true);
            await expectVisibleNodes(page, TABLE_NODE, ["dbo.OrderLines"]);

            dialog = await openFilterDialog(page, getFolderNode(page, TABLES), "inline action");
            await expect(getFilterOperator(dialog, "Name")).toHaveText("Ends With");
            await expect(getFilterValueInput(dialog, "Name")).toHaveValue("Lines");
            await closeFilterDialog(page, dialog);
        },
    );

    // Failed in the E2E nightly flaky run even with the keyring prompt fixed: a filtered folder's children
    // or filter state did not update (toHaveCount(0) still saw 1).
    // TODO: Stabilize this test, then remove its flaky tag.
    test(
        "Clear Filters inline action removes the filter",
        { ...testCases(5878868), tag: Tag.flaky },
        async () => {
            const { page } = getContext();
            await applyTablesFilter(page, { Schema: "sales" });
            await expectVisibleNodes(page, TABLE_NODE, ["sales.Customers", "sales.Invoices"]);

            await clickInlineAction(page, getFolderNode(page, TABLES), "Clear Filters");

            const tables = await waitForFolderState(page, TABLES, false);
            await expectVisibleNodes(page, TABLE_NODE, ALL_TABLES);
            await tables.hover();
            await expect(tables.getByRole("button", { name: "Clear Filters" })).toHaveCount(0);
        },
    );

    test("Clear Filters context menu item removes the filter", testCases(5878868), async () => {
        const { page } = getContext();
        await applyTablesFilter(page, { Name: "Invoices" }, "context menu");
        await expectVisibleNodes(page, TABLE_NODE, ["sales.Invoices"]);

        await runObjectExplorerContextAction(page, getFolderNode(page, TABLES), "Clear Filters");

        await waitForFolderState(page, TABLES, false);
        await expectVisibleNodes(page, TABLE_NODE, ALL_TABLES);
    });

    test(
        "Clearing every value in the filter dialog removes the filter",
        testCases(5878868),
        async () => {
            const { page } = getContext();
            await applyTablesFilter(page, { Name: "Customers", Schema: "dbo" });
            await expectVisibleNodes(page, TABLE_NODE, ["dbo.Customers"]);

            const dialog = await openFilterDialog(
                page,
                getFolderNode(page, TABLES),
                "inline action",
            );
            await dialog.getByRole("button", { name: "Clear All", exact: true }).click();
            await expect(getFilterValueInput(dialog, "Name")).toHaveValue("");
            await expect(getFilterValueInput(dialog, "Schema")).toHaveValue("");
            await applyFilterDialog(page, dialog);

            await waitForFolderState(page, TABLES, false);
            await expectVisibleNodes(page, TABLE_NODE, ALL_TABLES);
        },
    );
});
