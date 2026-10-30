/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { getGridLaunchConfig } from "./grid/gridLaunchConfig";
import { runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

for (const enabled of [true, false]) {
    test.describe(`Query Studio spatial preview ${enabled ? "enabled" : "disabled"}`, () => {
        test.setTimeout(90_000);
        let studio: FrameLocator;
        let pinned: FrameLocator;
        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: getGridLaunchConfig({
                    "mssql.enableExperimentalFeatures": true,
                    "mssql.sqlDataPlane.enabled": true,
                    "mssql.queryStudio.enabled": true,
                    "mssql.queryStudio.spatial.enabled": enabled,
                    "mssql.queryStudio.spatial.basemap.enabled": false,
                }),
            },
            afterLaunch: async ({ page }) => {
                await runCommandFromPalette(
                    page,
                    "MS SQL: Query Studio: New Query",
                    "MS SQL: Query Studio: New Query",
                );
                const frame = page.locator(".webview:visible");
                await expect(frame).toHaveCount(1);
                const name = await frame.getAttribute("name");
                studio = page
                    .frameLocator(`.webview[name="${name}"]`)
                    .frameLocator("#active-frame");
                await studio.getByTitle("Connect to a SQL Server", { exact: true }).click();
                await page.getByRole("option", { name: /^e2e-grid/ }).click();
                await expect(studio.getByTitle("Change connection", { exact: true })).toBeVisible({
                    timeout: 60_000,
                });
                await studio.locator(".monaco-editor .view-lines").click();
                await page.keyboard.insertText(
                    "SELECT id, label, CASE WHEN id < 3 THEN geography::Point(lat, lon, 4326) END AS location FROM (VALUES (1, N'Seattle', 47.6, -122.3), (2, N'London', 51.5, -0.1), (3, N'No location', 0.0, 0.0)) AS places(id, label, lat, lon);",
                );
                await studio.getByTitle("Execute (F5 / Ctrl+E)", { exact: true }).click();
                await expect(
                    studio.getByText("Query executed successfully.", { exact: true }),
                ).toBeVisible({ timeout: 60_000 });
                await expect(studio.locator(".fluent-result-grid").first()).toHaveAttribute(
                    "data-row-count",
                    "3",
                );
                await studio.getByRole("button", { name: "Pin all results", exact: true }).click();
                pinned = page
                    .frameLocator(`.webview:not([name="${name}"])`)
                    .frameLocator("#active-frame");
                await expect(pinned.locator(".fluent-result-grid").first()).toHaveAttribute(
                    "data-row-count",
                    "3",
                    { timeout: 15_000 },
                );
            },
        });

        test("live and pinned results respect the preview flag", async () => {
            const { page } = getContext();
            if (!enabled) {
                for (const frame of [studio, pinned])
                    await expect(
                        frame.getByRole("tab", { name: "Spatial", exact: true }),
                    ).toHaveCount(0);
                return;
            }
            // The pinned document is focused initially; then return to its source.
            for (const [index, frame] of [pinned, studio].entries()) {
                if (index === 1)
                    await page
                        .getByRole("tab", { name: /Untitled-1/ })
                        .first()
                        .click();
                await frame.getByRole("tab", { name: "Spatial", exact: true }).click();
                await expect(
                    frame
                        .getByRole("listbox", { name: "Spatial features" })
                        .getByRole("option", { name: /Point$/ }),
                ).toHaveCount(2, { timeout: 20_000 });
                await expect(frame.locator(".qs-spatial-map-region canvas").first()).toBeVisible();
                const feature = frame.locator(".qs-spatial-list").getByRole("option").first();
                await feature.click();
                await expect(feature).toHaveAttribute("aria-selected", "true");
                await expect(frame.locator(".qs-spatial-details")).toContainText("4326");
                await frame
                    .getByRole("combobox", { name: "Layers", exact: true })
                    .selectOption("worldOutline");
                await expect(frame.locator(".qs-spatial-facts")).toContainText("World outline");
                await frame.getByRole("button", { name: "Fit", exact: true }).click();
                await frame.getByRole("tab", { name: /^Results/ }).click();
                await expect(frame.locator(".fluent-result-grid").first()).toHaveAttribute(
                    "data-row-count",
                    "3",
                );
            }
        });
    });
}
