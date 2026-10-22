/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getGridLaunchConfig } from "./grid/gridLaunchConfig";
import { runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

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
        const { page } = getContext();
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
                "SELECT TOP (1) 84 AS other_answer FROM sys.all_objects;",
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
        await expect(
            pinned.locator(".slick-cell").filter({ hasText: /^42$/ }).first(),
        ).toBeVisible();
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
    });
});
