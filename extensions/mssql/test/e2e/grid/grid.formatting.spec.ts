/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import { executeQueryAndWait, setQueryText, waitForResultGrid } from "../utils/testHelpers";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import { getCell, getResultsFrame, stageQuery } from "./gridActions";
import {
    MIN_VECTOR_MAJOR_VERSION,
    SERVER_MAJOR_VERSION_QUERY,
    TYPED_COLUMNS_QUERY,
    VECTOR_COLUMN_QUERY,
} from "./gridFixtures";

test.describe("MSSQL Extension - Preview Grid Formatting", () => {
    let grid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getGridLaunchConfig() },
        afterLaunch: async ({ electronApp, page }) => {
            grid = (await stageQuery(electronApp, page, TYPED_COLUMNS_QUERY)).grid;
        },
    });

    test("XML cells expose a link to the formatted value", async () => {
        await expect(getCell(grid, 0, 0).locator("a")).toBeVisible();
    });

    test("JSON cells expose a link to the formatted value", async () => {
        await expect(getCell(grid, 0, 1).locator("a")).toBeVisible();
    });

    test("opening a JSON cell creates a formatted query-result document", async () => {
        const { page } = getContext();
        await getCell(grid, 0, 1).locator("a").click();
        await expect(page.locator(".tab").filter({ hasText: /query-\d+\.json/ })).toBeVisible();
    });

    test("opening an XML cell formats its nested elements on separate lines", async () => {
        const { page } = getContext();
        await getCell(grid, 0, 0).locator("a").click();
        await expect(page.locator(".tab").filter({ hasText: /query-\d+\.xml/ })).toBeVisible();
        await expect(page.locator(".view-line").filter({ hasText: /^<plan>$/ })).toBeVisible();
        await expect(page.locator(".view-line").filter({ hasText: /<node\s*\/>/ })).toBeVisible();
        await expect(page.locator(".view-line").filter({ hasText: /^<\/plan>$/ })).toBeVisible();
    });

    test("VECTOR(n) data stays plain text rather than becoming a JSON link on SQL Server 2025", async () => {
        const { electronApp, page } = getContext();
        await page
            .getByRole("tab", { name: /Untitled-1/ })
            .first()
            .click();
        await setQueryText(electronApp, page, SERVER_MAJOR_VERSION_QUERY);
        await executeQueryAndWait(page);
        const resultsFrame = await getResultsFrame(page);
        const versionGrid = await waitForResultGrid(resultsFrame, "0_0", 1);
        const majorVersion = Number(await getCell(versionGrid, 0, 0).innerText());
        test.skip(
            majorVersion < MIN_VECTOR_MAJOR_VERSION,
            `VECTOR(n) requires SQL Server ${MIN_VECTOR_MAJOR_VERSION}+; connected server is ${majorVersion}`,
        );

        await setQueryText(electronApp, page, VECTOR_COLUMN_QUERY);
        await executeQueryAndWait(page);
        const vectorGrid = await waitForResultGrid(resultsFrame, "0_0", 1);
        await expect(getCell(vectorGrid, 0, 0)).toContainText("0.1");
        await expect(getCell(vectorGrid, 0, 0).locator("a")).toHaveCount(0);
    });
});
