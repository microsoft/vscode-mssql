/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
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
                    "SELECT id, label, CASE WHEN id < 3 THEN geography::Point(lat, lon, 4326) END AS location, geography::Point(lon / 2, lat, 4326) AS alternate FROM (VALUES (1, N'Seattle', 47.6, -122.3), (2, N'London', 51.5, -0.1), (3, N'No location', 0.0, 0.0)) AS places(id, label, lat, lon); SELECT geography::Point(10, 20, 4326) AS only_location;",
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

        if (enabled)
            test("column/color changes and quick tab switches load fresh map data", async () => {
                const { page } = getContext();
                await page
                    .getByRole("tab", { name: /Untitled-1/ })
                    .first()
                    .click();
                await studio.getByRole("tab", { name: "Spatial", exact: true }).click();
                const list = studio.getByRole("listbox", { name: "Spatial features" });
                await expect(list.getByRole("option", { name: /Point$/ })).toHaveCount(2, {
                    timeout: 20000,
                });
                await studio
                    .getByRole("combobox", { name: "Layers", exact: true })
                    .selectOption("none");
                const label = studio.getByRole("combobox", { name: "Label", exact: true });
                const color = studio.getByRole("combobox", { name: "Color by", exact: true });
                const column = studio.getByRole("combobox", {
                    name: "Spatial column",
                    exact: true,
                });
                const image = () =>
                    studio
                        .locator(".qs-spatial-map-region canvas")
                        .evaluateAll((canvases) =>
                            canvases
                                .map((canvas) => (canvas as HTMLCanvasElement).toDataURL())
                                .join("|"),
                        );
                const before = await image();
                await color.selectOption("1");
                await expect.poll(image, { timeout: 20000 }).not.toEqual(before);
                await label.selectOption("1");
                const alternate = await column
                    .locator("option")
                    .filter({ hasText: / · alternate$/ })
                    .getAttribute("value");
                await column.selectOption(alternate!);
                await expect(list.getByRole("option")).toHaveCount(3, { timeout: 20000 });
                await expect(studio.locator(".qs-spatial-details")).not.toContainText(
                    "sessionOpenFailed",
                );
                const narrow = await column
                    .locator("option")
                    .filter({ hasText: / · only_location$/ })
                    .getAttribute("value");
                await column.selectOption(narrow!);
                await expect(label).toHaveValue("");
                await expect(color).toHaveValue("");
                await expect(list.getByRole("option")).toHaveCount(1, { timeout: 20000 });
                for (let i = 0; i < 3; i++) {
                    await studio.getByRole("tab", { name: /^Results/ }).click();
                    await studio.getByRole("tab", { name: "Spatial", exact: true }).click();
                }
                await expect(list.getByRole("option", { name: /Point$/ })).toHaveCount(1, {
                    timeout: 20000,
                });
                await expect(studio.locator(".qs-spatial-map-region canvas").first()).toBeVisible();
            });
        if (enabled)
            test("disabling spatial releases live and pinned map resources", async () => {
                const { userDataDir } = getContext();
                for (const frame of [studio, pinned])
                    await expect(frame.locator(".qs-spatial-map-region")).toHaveCount(1);
                const userDir = path.join(userDataDir, "User");
                const profiles = path.join(userDir, "profiles");
                const settingsPaths = [path.join(userDir, "settings.json")];
                if (fs.existsSync(profiles))
                    for (const profile of fs.readdirSync(profiles)) {
                        const file = path.join(profiles, profile, "settings.json");
                        if (fs.existsSync(file)) settingsPaths.push(file);
                    }
                for (const file of settingsPaths) {
                    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
                    settings["mssql.queryStudio.spatial.enabled"] = false;
                    fs.writeFileSync(file, JSON.stringify(settings, undefined, 4));
                }
                for (const frame of [studio, pinned])
                    await expect(frame.locator(".qs-spatial-map-region")).toHaveCount(0, {
                        timeout: 30000,
                    });
            });
    });
}
