/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import { QuickInput } from "../pageObjects";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import { clickCell, resetGrid, stageQuery } from "./gridActions";
import { MIXED_TYPES_QUERY, MIXED_TYPES_ROW_COUNT } from "./gridFixtures";

test.describe("MSSQL Extension - Preview Grid Export", () => {
    let grid: Locator;
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-grid-export-"));

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig({
                "mssql.results.openAfterSave": false,
                "mssql.saveAsCsv.includeHeaders": false,
                "mssql.saveAsCsv.delimiter": ";",
                "mssql.saveAsCsv.encoding": "utf-16le",
            }),
        },
        afterLaunch: async ({ electronApp, page }) => {
            grid = (
                await stageQuery(electronApp, page, MIXED_TYPES_QUERY, {
                    minRows: MIXED_TYPES_ROW_COUNT,
                })
            ).grid;
        },
    });

    test.afterAll(() => {
        if (path.dirname(exportDir) !== os.tmpdir()) {
            throw new Error(`Refusing to clean up unexpected export directory: ${exportDir}`);
        }
        fs.rmSync(exportDir, { recursive: true, force: true });
    });

    test.afterEach(async () => {
        await resetGrid(grid, MIXED_TYPES_ROW_COUNT);
    });

    async function saveFromToolbar(buttonName: string, fileName: string): Promise<string> {
        const { page } = getContext();
        const filePath = path.join(exportDir, fileName);
        await grid.getByRole("button", { name: buttonName }).click();
        const picker = new QuickInput(page);
        await expect(picker.widget).toBeVisible();
        await picker.input.fill(filePath);
        await picker.input.press("Enter");
        // The save dialog closes before the asynchronous export writes the file. A path can
        // already exist while its contents are still empty, especially for XLSX on CI.
        await expect
            .poll(() => (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0), {
                timeout: 15_000,
            })
            .toBeGreaterThan(2);
        return filePath;
    }

    test("Save as CSV writes the result to the chosen path", async () => {
        const filePath = await saveFromToolbar("Save as CSV", "results.csv");
        await expect
            .poll(() => fs.readFileSync(filePath, "utf16le"), { timeout: 15_000 })
            .toContain("Eli");
        const content = fs.readFileSync(filePath, "utf16le");
        expect(content).toContain("Ada");
        expect(content).toContain("Eli");
        expect(content).toContain(";");
        expect(content).not.toContain("id;name");
    });

    test("Save as JSON writes a parseable result file", async () => {
        const filePath = await saveFromToolbar("Save as JSON", "results.json");
        await expect
            .poll(
                () => {
                    try {
                        return JSON.parse(fs.readFileSync(filePath, "utf8")) !== null;
                    } catch {
                        return false;
                    }
                },
                { timeout: 15_000 },
            )
            .toBe(true);
        const content = fs.readFileSync(filePath, "utf8");
        expect(JSON.stringify(JSON.parse(content))).toContain("Ada");
        expect(content).toContain("Eli");
    });

    test("Save as Excel writes an XLSX workbook", async () => {
        const filePath = await saveFromToolbar("Save as Excel", "results.xlsx");
        // The ZIP end-of-central-directory marker arrives after the workbook has been written.
        await expect
            .poll(
                () => fs.readFileSync(filePath).lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])),
                { timeout: 15_000 },
            )
            .toBeGreaterThan(0);
        const content = fs.readFileSync(filePath);
        expect(content.subarray(0, 2).toString("ascii")).toBe("PK");
    });

    test("Save as INSERT INTO writes SQL statements", async () => {
        const filePath = await saveFromToolbar("Save as INSERT INTO", "results.sql");
        await expect
            .poll(() => fs.readFileSync(filePath, "utf8"), { timeout: 15_000 })
            .toContain("Ada");
        const content = fs.readFileSync(filePath, "utf8");
        expect(content).toContain("INSERT");
        expect(content).toContain("Ada");
    });

    test("exporting a selected range saves only that selection", async () => {
        await clickCell(grid, 0, 1);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
        await expect(grid.locator(".slick-cell.selected")).toHaveCount(2);
        const filePath = await saveFromToolbar("Save as CSV", "selection.csv");
        // The picker closes when the write starts; file creation can precede its contents.
        await expect
            .poll(() => fs.readFileSync(filePath, "utf16le"), { timeout: 15_000 })
            .toContain("Bo");
        const content = fs.readFileSync(filePath, "utf16le");
        expect(content).toContain("Ada");
        expect(content).toContain("Bo");
        expect(content).not.toContain("Eli");
    });
});

test.describe("MSSQL Extension - Preview Grid Open After Save", () => {
    let grid: Locator;
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-grid-open-after-save-"));
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig({ "mssql.results.openAfterSave": true }),
        },
        afterLaunch: async ({ electronApp, page }) => {
            grid = (
                await stageQuery(electronApp, page, MIXED_TYPES_QUERY, {
                    minRows: MIXED_TYPES_ROW_COUNT,
                })
            ).grid;
        },
    });

    test.afterAll(() => {
        if (path.dirname(exportDir) !== os.tmpdir()) {
            throw new Error(`Refusing to clean up unexpected export directory: ${exportDir}`);
        }
        fs.rmSync(exportDir, { recursive: true, force: true });
    });

    test("openAfterSave opens the exported text document", async () => {
        const { page } = getContext();
        const filePath = path.join(exportDir, "opened-results.csv");
        await grid.getByRole("button", { name: "Save as CSV" }).click();
        const picker = new QuickInput(page);
        await expect(picker.widget).toBeVisible();
        await picker.input.fill(filePath);
        await picker.input.press("Enter");
        await expect.poll(() => fs.existsSync(filePath)).toBe(true);
        await expect(page.locator(".tab").filter({ hasText: "opened-results.csv" })).toBeVisible();
    });
});
