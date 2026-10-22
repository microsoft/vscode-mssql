/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getGridLaunchConfig } from "./grid/gridLaunchConfig";
import {
    clearClipboard,
    readClipboard,
    runCommandFromPalette,
    withClipboardLock,
} from "./utils/testHelpers";
import { getCell } from "./grid/gridActions";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { writeCoverage } from "./utils/coverageHelpers";

test.describe("Query Studio execution and pinned results", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig({
                "mssql.enableExperimentalFeatures": true,
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
            }),
        },
    });

    test("shows embedded actual plans and retains pinned rows across a rerun", async () => {
        const { page, electronApp } = getContext();
        await runCommandFromPalette(
            page,
            "MS SQL: Query Studio: New Query",
            "MS SQL: Query Studio: New Query",
        );
        const studioFrame = page.locator(".webview:visible");
        await expect(studioFrame).toHaveCount(1);
        const studioName = await studioFrame.getAttribute("name");
        const studio = page
            .frameLocator(`.webview[name="${studioName}"]`)
            .frameLocator("#active-frame");
        await studio.getByTitle("Connect to a SQL Server", { exact: true }).click();
        await page.getByRole("option", { name: /^e2e-grid/ }).click();
        await expect(studio.getByTitle("Change connection", { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        const actualPlanToggle = studio.getByTitle(
            "Include actual execution plan (applies to next execute)",
            { exact: true },
        );
        await actualPlanToggle.click();
        await expect(actualPlanToggle).toHaveAttribute("aria-pressed", "true");
        const editor = studio.locator(".monaco-editor .view-lines");
        await editor.click();
        // Constant-only SELECTs can omit plan XML; use a catalog scan so SQL Server
        // returns real plans without creating or modifying test data.
        await page.keyboard.insertText(
            "SELECT TOP (1) 42 AS answer FROM sys.all_objects;\n" +
                "SELECT TOP (1) 84 AS other_answer FROM sys.all_objects;\n" +
                "SELECT REPLICATE(CONVERT(nvarchar(max), N'x'), 400000) AS large_value;",
        );
        await studio.getByTitle("Execute (F5 / Ctrl+E)", { exact: true }).click();
        await expect(studio.locator("#queryPlanParent1")).toBeVisible({ timeout: 60_000 });
        await expect(
            studio.getByRole("tree", { name: /Execution plan 1, use arrow keys/ }),
        ).toBeVisible();
        await studio.getByRole("tab", { name: /^Results/ }).click();
        await expect(
            studio.locator(".slick-cell").filter({ hasText: /^42$/ }).first(),
        ).toBeVisible();
        await studio.getByRole("button", { name: "Pin all results", exact: true }).click();
        const pinned = page
            .frameLocator(`.webview:not([name="${studioName}"])`)
            .frameLocator("#active-frame");
        await expect(pinned.locator(".qs-pinned-root")).toBeVisible();
        if (process.env.MSSQL_EXPECT_WEBVIEW_COVERAGE === "1") {
            for (const frame of [studio, pinned]) {
                expect(
                    await frame
                        .locator("body")
                        .evaluate(
                            () =>
                                Object.keys(
                                    (window as unknown as { __coverage__?: object }).__coverage__ ??
                                        {},
                                ).length,
                        ),
                ).toBeGreaterThan(0);
            }
        }
        await expect(
            pinned.locator(".slick-cell").filter({ hasText: /^42$/ }).first(),
        ).toBeVisible();
        await withClipboardLock(async () => {
            await clearClipboard(electronApp);
            const largeGrid = pinned.locator(".fluent-result-grid").nth(2);
            await expect(largeGrid).toHaveAttribute("data-row-count", "1");
            await getCell(largeGrid, 0, 0).click();
            await page.keyboard.press("ControlOrMeta+c");
            await expect
                .poll(async () => (await readClipboard(electronApp)).replace(/\r\n/g, "\n"))
                .toBe("x".repeat(400_000));
        });
        await page
            .getByRole("tab", { name: /Untitled/ })
            .first()
            .click();
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText("SELECT 99 AS answer;");
        await studio.getByTitle("Execute (F5 / Ctrl+E)", { exact: true }).click();
        await expect(
            studio.getByText("Query executed successfully.", { exact: true }),
        ).toBeVisible();
        await studio.getByRole("tab", { name: /^Results/ }).click();
        await expect(
            studio.locator(".slick-cell").filter({ hasText: /^99$/ }).first(),
        ).toBeVisible();
        await studio.getByTitle("Switch to Text View", { exact: true }).click();
        await expect(studio.locator(".qs-text-view .monaco-editor")).toBeVisible();
        await expect(studio.locator(".qs-text-view")).toContainText("99");
        await studio.getByTitle("Switch to Grid View", { exact: true }).click();
        await page
            .getByRole("tab", { name: /Pinned Results/ })
            .first()
            .click();
        await expect(pinned.locator(".qs-pinned-root")).toBeVisible();
        await expect(
            pinned.locator(".slick-cell").filter({ hasText: /^42$/ }).first(),
        ).toBeVisible();
        await expect(pinned.locator(".slick-cell").filter({ hasText: /^99$/ })).toHaveCount(0);
        await pinned.getByRole("tab", { name: /^Query Plan/ }).click();
        await expect(pinned.locator("#queryPlanParent1")).toBeVisible();
        await expect(
            pinned.getByRole("tree", { name: /Execution plan 1, use arrow keys/ }),
        ).toBeVisible();
        await writeCoverage(studio, "queryStudioExecution");
        await writeCoverage(pinned, "queryStudioPinnedResults");
    });
});
