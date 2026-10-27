/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "./baseFixtures";
import { getGridLaunchConfig } from "./grid/gridLaunchConfig";
import {
    clickMenuItem,
    getCell,
    GRID_COMMAND_LABELS,
    openCellContextMenu,
    openHeaderContextMenu,
} from "./grid/gridActions";
import {
    clearClipboard,
    getModifierKey,
    readClipboard,
    runCommandFromPalette,
    withClipboardLock,
} from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("Query Studio grid parity", () => {
    test.setTimeout(60_000);
    const guid = "aBcdef01-2345-6789-abcd-0123456789aB";
    let studio: FrameLocator;
    let pinned: FrameLocator;
    let grid: Locator;
    let pinnedGrid: Locator;
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig({
                "mssql.enableExperimentalFeatures": true,
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
                "mssql.resultsGrid.rightAlignNumbers": true,
                "mssql.resultsGrid.freezeFirstColumnByDefault": true,
                "mssql.copyIncludeHeaders": true,
                "mssql.results.showBatchMessages": false,
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
            studio = page.frameLocator(`.webview[name="${name}"]`).frameLocator("#active-frame");
            await studio.getByTitle("Connect to a SQL Server", { exact: true }).click();
            await page.getByRole("option", { name: /^e2e-grid/ }).click();
            await expect(studio.getByTitle("Change connection", { exact: true })).toBeVisible({
                timeout: 60_000,
            });
            await studio.locator(".monaco-editor .view-lines").click();
            // Read-only, typed values exercise the real SQL metadata and native row pipeline.
            await page.keyboard.insertText(
                "PRINT 'user message';\n" +
                    "SELECT id, label, CAST(id + 0.25 AS decimal(10,2)) AS amount, " +
                    "CAST(1 AS bit) AS enabled FROM (VALUES " +
                    "(1, N'  spaced  value'), (2, N'123'), (3, N'last')) AS v(id, label);\n" +
                    `SELECT CAST('${guid}' AS uniqueidentifier) AS guid, N'${guid}' AS text;`,
            );
            await studio.getByTitle("Execute (F5 / Ctrl+E)", { exact: true }).click();
            await expect(
                studio.getByText("Query executed successfully.", { exact: true }),
            ).toBeVisible({
                timeout: 60_000,
            });
            await studio.getByRole("tab", { name: /^Results/ }).click();
            grid = studio.locator(".fluent-result-grid").first();
            await expect(grid).toHaveAttribute("data-row-count", "3");
            await studio.getByRole("button", { name: "Pin all results", exact: true }).click();
            pinned = page
                .frameLocator(`.webview:not([name="${name}"])`)
                .frameLocator("#active-frame");
            pinnedGrid = pinned.locator(".fluent-result-grid").first();
            await expect(pinnedGrid).toHaveAttribute("data-row-count", "3");
        },
    });

    test("live and pinned grids honor numeric alignment and the default frozen column", async () => {
        for (const resultGrid of [grid, pinnedGrid]) {
            await expect(resultGrid).toHaveAttribute("data-frozen-index", "1");
            await expect(getCell(resultGrid, 0, 0)).toHaveCSS("justify-content", "flex-end");
            await expect(getCell(resultGrid, 0, 2)).toHaveCSS("justify-content", "flex-end");
            await expect(getCell(resultGrid, 1, 1)).not.toHaveCSS("justify-content", "flex-end");
            await expect(getCell(resultGrid, 0, 3)).not.toHaveCSS("justify-content", "flex-end");
        }
    });

    test("live and pinned cells preserve leading and repeated spaces", async () => {
        for (const resultGrid of [grid, pinnedGrid]) {
            const cell = getCell(resultGrid, 0, 1).locator(".grid-cell-value-container");
            expect(await cell.textContent()).toBe("  spaced  value");
            await expect(cell).toHaveCSS("white-space", "pre");
        }
    });

    test("Ctrl+Insert honors copyIncludeHeaders in live and pinned grids", async () => {
        const { electronApp, page } = getContext();
        await withClipboardLock(async () => {
            for (const resultGrid of [grid, pinnedGrid]) {
                await clearClipboard(electronApp);
                await getCell(resultGrid, 0, 0).click();
                await page.keyboard.press("Control+Insert");
                await expect
                    .poll(async () => (await readClipboard(electronApp)).replace(/\r\n/g, "\n"))
                    .toBe("id\n1");
            }
        });
    });

    for (const method of ["drag", "shift-click", "keyboard"] as const) {
        test(`Ctrl+C copies a rectangular subset selected by ${method} in live and pinned grids`, async () => {
            const { electronApp, page } = getContext();
            await withClipboardLock(async () => {
                for (const { resultGrid, resultFrame } of [
                    { resultGrid: grid, resultFrame: studio },
                    { resultGrid: pinnedGrid, resultFrame: pinned },
                ]) {
                    // Begin outside the grid, as a user returning from SQL editing would.
                    await studio.locator(".monaco-editor .view-lines").click();
                    await page.keyboard.press(
                        getModifierKey() === "Meta" ? "Meta+ArrowUp" : "Control+Home",
                    );
                    for (let i = 0; i < "PRINT".length; i++) {
                        await page.keyboard.press("Shift+ArrowRight");
                    }
                    await clearClipboard(electronApp);
                    const start = getCell(resultGrid, 0, 1);
                    const end = getCell(resultGrid, 1, 2);
                    if (method === "drag") {
                        await start.dragTo(end);
                    } else {
                        await start.click();
                        if (method === "shift-click") {
                            await end.click({ modifiers: ["Shift"] });
                        } else {
                            await page.keyboard.press("Shift+ArrowRight");
                            await page.keyboard.press("Shift+ArrowDown");
                        }
                    }
                    await expect(resultGrid.locator(".slick-cell.selected")).toHaveCount(4);
                    await expect
                        .poll(() =>
                            resultGrid.evaluate((element) =>
                                element.contains(document.activeElement),
                            ),
                        )
                        .toBe(true);
                    await page.keyboard.press(`${getModifierKey()}+C`);
                    await expect
                        .poll(async () => (await readClipboard(electronApp)).replace(/\r\n/g, "\n"))
                        .toBe("label\tamount\n  spaced  value\t1.25\n123\t2.25");

                    await clearClipboard(electronApp);
                    await openCellContextMenu(resultGrid, 0, 1);
                    await clickMenuItem(resultFrame, GRID_COMMAND_LABELS.copy);
                    await expect
                        .poll(async () => (await readClipboard(electronApp)).replace(/\r\n/g, "\n"))
                        .toBe("label\tamount\n  spaced  value\t1.25\n123\t2.25");

                    // Clearing the stale DOM selection must preserve Monaco's SQL selection.
                    await studio.locator('.monaco-editor [role="textbox"]').focus();
                    await page.keyboard.press(`${getModifierKey()}+C`);
                    await expect.poll(() => readClipboard(electronApp)).toBe("PRINT");
                    // Leave no SQL selection for later tests that rerun the full fixture.
                    await page.keyboard.press("ArrowRight");
                }
            });
        });
    }

    test("GUID values display and copy in uppercase by default while text preserves its case", async () => {
        const { electronApp, page } = getContext();
        await withClipboardLock(async () => {
            for (const resultFrame of [studio, pinned]) {
                const guidGrid = resultFrame.locator(".fluent-result-grid").nth(1);
                await expect(getCell(guidGrid, 0, 0)).toHaveText(guid.toUpperCase());
                await expect(getCell(guidGrid, 0, 1)).toHaveText(guid);
                await clearClipboard(electronApp);
                await getCell(guidGrid, 0, 0).click();
                await page.keyboard.press("Control+Insert");
                await expect
                    .poll(async () => (await readClipboard(electronApp)).replace(/\r\n/g, "\n"))
                    .toBe(`guid\n${guid.toUpperCase()}`);
            }
        });
    });

    for (const { layout, key, code, selectsAll } of [
        { layout: "AZERTY A", key: "a", code: "KeyQ", selectsAll: true },
        { layout: "AZERTY Q", key: "q", code: "KeyA", selectsAll: false },
        { layout: "Cyrillic physical A", key: "ф", code: "KeyA", selectsAll: true },
    ]) {
        test(`select-all follows the keyboard layout for ${layout}`, async () => {
            for (const resultGrid of [grid, pinnedGrid]) {
                await getCell(resultGrid, 0, 0).click();
                await resultGrid
                    .locator(".slick-cell.active")
                    .first()
                    .evaluate(
                        async (element, shortcut) => {
                            element.dispatchEvent(
                                new KeyboardEvent("keydown", {
                                    key: shortcut.key,
                                    code: shortcut.code,
                                    ctrlKey: !shortcut.isMac,
                                    metaKey: shortcut.isMac,
                                    bubbles: true,
                                    cancelable: true,
                                }),
                            );
                            await new Promise(requestAnimationFrame);
                        },
                        { key, code, isMac: getModifierKey() === "Meta" },
                    );
                await expect(resultGrid.locator(".slick-cell.selected")).toHaveCount(
                    selectsAll ? 12 : 1,
                );
            }
        });
    }

    test("batch-message preference retains user PRINT output in live and pinned messages", async () => {
        for (const resultFrame of [studio, pinned]) {
            await resultFrame.getByRole("tab", { name: /^Messages/ }).click();
            const messages = resultFrame.getByRole("log");
            await expect(messages).toContainText("user message");
            await expect(messages).not.toContainText("Started executing query at Line");
            await expect(messages).not.toContainText("Total execution time:");
            await expect(messages).not.toContainText("(3 rows affected)");
            await resultFrame.getByRole("tab", { name: /^Results/ }).click();
        }
    });

    test("a saved unfreeze choice survives tab changes despite the freeze-first default", async () => {
        for (const { resultGrid, resultFrame } of [
            { resultGrid: grid, resultFrame: studio },
            { resultGrid: pinnedGrid, resultFrame: pinned },
        ]) {
            await openHeaderContextMenu(resultGrid, "id");
            await clickMenuItem(resultFrame, "Unfreeze columns");
            await expect(resultGrid).toHaveAttribute("data-frozen-index", "0");
            await resultFrame.getByRole("tab", { name: /^Messages/ }).click();
            await resultFrame.getByRole("tab", { name: /^Results/ }).click();
            await expect(resultGrid).toHaveAttribute("data-frozen-index", "0");
        }
    });

    test("preference changes update both open grids without replacing their result data", async () => {
        const { userDataDir, electronApp, page } = getContext();
        // Change only this test host's settings. Development hosts may use a temporary
        // profile, while VSIX runs use the default profile.
        const userDir = path.join(userDataDir, "User");
        const profilesDir = path.join(userDir, "profiles");
        const settingsPaths = [path.join(userDir, "settings.json")];
        if (fs.existsSync(profilesDir)) {
            for (const profile of fs.readdirSync(profilesDir)) {
                const settings = path.join(profilesDir, profile, "settings.json");
                if (fs.existsSync(settings)) {
                    settingsPaths.push(settings);
                }
            }
        }
        for (const settingsPath of settingsPaths) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            settings["mssql.resultsGrid.rightAlignNumbers"] = false;
            settings["mssql.copyIncludeHeaders"] = false;
            settings["mssql.query.displayUniqueIdentifierInUppercase"] = false;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, undefined, 4));
        }
        await withClipboardLock(async () => {
            for (const resultGrid of [grid, pinnedGrid]) {
                await expect(getCell(resultGrid, 0, 0)).not.toHaveCSS(
                    "justify-content",
                    "flex-end",
                    {
                        timeout: 30_000,
                    },
                );
                await expect(resultGrid).toHaveAttribute("data-row-count", "3");
                await clearClipboard(electronApp);
                await getCell(resultGrid, 0, 0).click();
                await page.keyboard.press("Control+Insert");
                await expect.poll(() => readClipboard(electronApp)).toBe("1");
            }
        });
        // Formatting is captured per run: new rows use the current preference,
        // while a pinned snapshot keeps the values captured from the earlier run.
        await studio.getByTitle("Execute (F5 / Ctrl+E)", { exact: true }).click();
        await expect(getCell(studio.locator(".fluent-result-grid").nth(1), 0, 0)).toHaveText(
            guid.toLowerCase(),
            { timeout: 30_000 },
        );
        await expect(getCell(pinned.locator(".fluent-result-grid").nth(1), 0, 0)).toHaveText(
            guid.toUpperCase(),
        );
    });
});
