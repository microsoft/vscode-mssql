/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { QuickInput } from "./pageObjects";

async function openFile(page: Page, filename: string): Promise<void> {
    await page.keyboard.press("ControlOrMeta+p");
    const input = page.locator('input[aria-controls="quickInput_list"]');
    await input.fill(filename);
    await page.getByRole("option").filter({ hasText: filename }).first().waitFor();
    await page.keyboard.press("Enter");
    await expect(input).toBeHidden();
}

for (const enabled of [false, true]) {
    test.describe(`Query Studio preview ${enabled ? "enabled" : "disabled"}`, () => {
        const workspace = path.join(os.tmpdir(), `mssql-qs-${randomUUID()}`);
        test.beforeAll(async () => {
            await fs.mkdir(workspace, { recursive: true });
            await fs.writeFile(path.join(workspace, "classic.sql"), "SELECT 11 AS classic;");
            await fs.writeFile(path.join(workspace, "studio.mssql"), "SELECT 22 AS studio;");
        });
        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                extraLaunchArgs: [workspace],
                initialConfig: {
                    "mssql.showChangelogOnUpdate": false,
                    "mssql.enableExperimentalFeatures": enabled,
                    "mssql.sqlDataPlane.enabled": enabled,
                    "mssql.queryStudio.enabled": enabled,
                    "editor.inlineSuggest.enabled": false,
                    "files.simpleDialog.enable": true,
                },
            },
        });
        test.afterAll(async () => {
            if (path.dirname(workspace) !== os.tmpdir()) {
                throw new Error("Unexpected temporary workspace path");
            }
            await fs.rm(workspace, { recursive: true, force: true });
        });

        test("keeps .sql in the text editor and honors the .mssql preview boundary", async () => {
            const { page } = getContext();
            await openFile(page, "classic.sql");
            await expect(
                page.locator(".monaco-editor .view-lines").filter({ hasText: "SELECT 11" }),
            ).toBeVisible();
            await expect(
                page
                    .locator(".monaco-workbench .statusbar-item")
                    .filter({ hasText: "SQL" })
                    .first(),
            ).toBeVisible();
            await openFile(page, "studio.mssql");
            if (!enabled) {
                await expect(
                    page.locator(".monaco-editor .view-lines").filter({ hasText: "SELECT 22" }),
                ).toBeVisible();
                return;
            }
            const studio = page.frameLocator(".webview:visible").frameLocator("#active-frame");
            // A cold, coverage-instrumented webview can take longer than the
            // default assertion timeout to load Monaco and mount its toolbar.
            await expect(
                studio.getByRole("toolbar", { name: "Query Studio toolbar" }),
            ).toBeInViewport({ timeout: 30_000 });
            await expect(
                studio.getByTitle("Connect to a SQL Server", { exact: true }),
            ).toBeInViewport();
            const editor = studio.locator(".monaco-editor .view-lines");
            await expect(editor).toContainText("SELECT 22");
            await editor.click();
            await page.keyboard.press("ControlOrMeta+End");
            await page.keyboard.type("\n-- saved from Query Studio");
            await page.keyboard.press("ControlOrMeta+s");
            await expect
                .poll(() => fs.readFile(path.join(workspace, "studio.mssql"), "utf8"))
                .toContain("-- saved from Query Studio");
            await page.keyboard.press("ControlOrMeta+z");
            await page.keyboard.press("ControlOrMeta+s");
            await expect
                .poll(() => fs.readFile(path.join(workspace, "studio.mssql"), "utf8"))
                .not.toContain("-- saved from Query Studio");
            await runCommandFromPalette(
                page,
                "MS SQL: Query Studio: New Query",
                "MS SQL: Query Studio: New Query",
            );
            await expect(
                page.locator('[role="tab"]').filter({ hasText: "Untitled" }).first(),
            ).toBeVisible();
            await studio.locator(".monaco-editor .view-lines").click();
            await page.keyboard.type("SELECT 33 AS saved;");
            await page.keyboard.press("ControlOrMeta+s");
            const picker = new QuickInput(page);
            await expect(picker.widget).toBeVisible();
            const savedPath = path.join(workspace, "saved.mssql");
            await picker.input.fill(savedPath);
            await picker.input.press("Enter");
            await expect
                .poll(() => fs.readFile(savedPath, "utf8").catch(() => ""))
                .toContain("SELECT 33 AS saved;");
            // Save As replaces the untitled webview with a fresh editor.
            await expect(
                studio.getByRole("toolbar", { name: "Query Studio toolbar" }),
            ).toBeInViewport({ timeout: 30_000 });
            await expect(studio.locator(".monaco-editor .view-lines")).toContainText("SELECT 33");
        });

        if (enabled) {
            test("SQL completion popups stay out of comments and strings", async () => {
                const { page } = getContext();
                await openFile(page, "studio.mssql");
                const studio = page.frameLocator(".webview:visible").frameLocator("#active-frame");
                const editor = studio.locator(".monaco-editor .view-lines");
                const suggestions = studio.locator(".suggest-widget.visible");
                for (const prefix of ["-- ", "/* ", "SELECT '"]) {
                    await editor.click();
                    await page.keyboard.press("ControlOrMeta+a");
                    await page.keyboard.insertText(
                        "SELECT 1 AS customers, 2 AS products;\n" + prefix,
                    );
                    // Spaces and dots exercise provider triggers as well as word suggestions.
                    await page.keyboard.type("which customers bought which products. ", {
                        delay: 25,
                    });
                    await expect(suggestions).toBeHidden();
                    await page.keyboard.press("Control+Space");
                    await expect(suggestions).toContainText("No suggestions.");
                    await expect(suggestions.locator(".monaco-list-row")).toHaveCount(0);
                    await page.keyboard.press("Escape");
                }
            });
        }
    });
}
