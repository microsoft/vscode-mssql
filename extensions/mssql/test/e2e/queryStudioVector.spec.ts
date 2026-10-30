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

// SQL Server 2025+ fixture described in docs/query-studio-vector.md.
// The test reads existing synthetic rows; it never creates models or indexes.
const database = process.env.VECTOR_WORKBENCH_TEST_DATABASE;
test.describe("Query Studio vector workbench", () => {
    test.skip(!database, "Requires the isolated vector demo fixture on SQL Server 2025+");
    test.setTimeout(90_000);
    let studio: FrameLocator;
    let pinned: FrameLocator;
    let studioName: string;
    const config = getGridLaunchConfig({
        "mssql.enableExperimentalFeatures": true,
        "mssql.sqlDataPlane.enabled": true,
        "mssql.queryStudio.enabled": true,
        "mssql.queryStudio.vectorWorkbench.enabled": true,
        "workbench.colorTheme": "Default Dark Modern",
    });
    config["mssql.connections"][0].database = database ?? "master";
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: config },
        afterLaunch: async ({ page, electronApp }) => {
            await electronApp.evaluate(({ BrowserWindow }) => {
                BrowserWindow.getAllWindows()[0].setSize(1440, 1100);
            });
            await runCommandFromPalette(
                page,
                "MS SQL: Query Studio: New Query",
                "MS SQL: Query Studio: New Query",
            );
            const frame = page.locator(".webview:visible");
            await expect(frame).toHaveCount(1);
            studioName = (await frame.getAttribute("name"))!;
            studio = page
                .frameLocator(`.webview[name="${studioName}"]`)
                .frameLocator("#active-frame");
            await studio.getByTitle("Connect to a SQL Server", { exact: true }).click();
            await page.getByRole("option", { name: /^e2e-grid/ }).click();
            await expect(studio.getByTitle("Change connection", { exact: true })).toBeVisible({
                timeout: 60_000,
            });
            await studio.locator(".monaco-editor .view-lines").click();
            await page.keyboard.insertText(
                "-- Synthetic vectors for exploring the workbench\nSELECT id, title, category, body, embedding\nFROM dbo.VectorSamples\nORDER BY id;",
            );
            await studio.getByTitle("Execute (F5 / Ctrl+E)", { exact: true }).click();
            await expect(
                studio.getByText("Query executed successfully.", { exact: true }),
            ).toBeVisible({ timeout: 60_000 });
            await expect(studio.locator(".fluent-result-grid").first()).toHaveAttribute(
                "data-row-count",
                "128",
            );
            await studio.getByRole("tab", { name: "Vector", exact: true }).click();
            await studio.getByTitle("Maximize results pane", { exact: true }).press("Enter");
            await runCommandFromPalette(
                page,
                "Notifications: Clear All Notifications",
                "Notifications: Clear All Notifications",
            );
        },
    });
    async function capture(name: string): Promise<void> {
        const destination = process.env.VECTOR_WORKBENCH_SCREENSHOTS;
        if (!destination) return;
        fs.mkdirSync(destination, { recursive: true });
        await studio
            .locator(".qs-vec-root")
            .screenshot({ path: path.join(destination, `${name}.png`) });
    }
    async function workspace(name: string): Promise<void> {
        await studio
            .getByRole("tablist", { name: "Vector workspaces" })
            .getByRole("tab", { name, exact: true })
            .click();
    }
    test("Profile analyzes native vectors", async () => {
        await expect(studio.locator(".qs-vec-profile")).toContainText("Dimensions", {
            timeout: 30_000,
        });
        await expect(studio.locator(".qs-vec-facts")).toContainText("64");
        await capture("profile");
    });
    test("Search executes a bounded exact neighbor query", async () => {
        await workspace("Search");
        await expect(
            studio.getByRole("combobox", { name: "Search target", exact: true }),
        ).toContainText("VectorSamples", { timeout: 30_000 });
        const approximate = studio.getByRole("checkbox", { name: /^Approx/ });
        if (await approximate.isEnabled()) await approximate.check();
        await studio.getByRole("button", { name: "Run comparison", exact: true }).press("Enter");
        await expect(
            studio.getByRole("table", { name: "Rank comparison", exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await capture("search");
    });
    test("Compare computes pairwise distances for selected rows", async () => {
        await workspace("Compare");
        await studio
            .getByRole("textbox", { name: "Result-row ordinals to compare" })
            .fill("0, 1, 4");
        await studio.getByRole("button", { name: "Compare", exact: true }).click();
        await expect(studio.getByRole("table", { name: /Pairwise/ })).toBeVisible({
            timeout: 30_000,
        });
        await capture("compare");
    });
    test("Projection displays interactive PCA points", async () => {
        await workspace("Projection");
        await expect(studio.locator(".qs-vec6-projection canvas")).toBeVisible({ timeout: 30_000 });
        await expect(studio.getByRole("listbox", { name: "Projected points" })).toBeVisible();
        const canvas = studio.locator(".qs-vec6-projection canvas");
        await expect
            .poll(async () =>
                canvas.evaluate((element: HTMLCanvasElement) => {
                    const workspace = element.closest(".qs-vec-workspace")!;
                    const rectangle = element.getBoundingClientRect();
                    if (rectangle.height > workspace.clientHeight) return 0;
                    const pixels = element
                        .getContext("2d")!
                        .getImageData(0, 0, element.width, element.height).data;
                    let bluePixels = 0;
                    for (let i = 0; i < pixels.length; i += 4) {
                        if (pixels[i + 2] > pixels[i] + 30 && pixels[i + 2] > pixels[i + 1] + 15)
                            bluePixels++;
                    }
                    return bluePixels;
                }),
            )
            .toBeGreaterThan(30);
        await studio
            .getByRole("listbox", { name: "Projected points" })
            .getByRole("option")
            .first()
            .click();
        await capture("projection");
    });
    test("Index reports capabilities and offers scripts without executing DDL", async () => {
        await workspace("Index");
        await expect(studio.getByRole("combobox", { name: "Verified target" })).toContainText(
            "VectorSamples",
            { timeout: 30_000 },
        );
        const target = studio.getByRole("combobox", { name: "Verified target" });
        const value = await target
            .locator("option")
            .filter({ hasText: "VectorSamples" })
            .getAttribute("value");
        await target.selectOption(value!);
        await expect(studio.getByRole("list", { name: "Generated scripts" })).toBeVisible({
            timeout: 30_000,
        });
        await capture("index");
    });
    test("Pipeline previews text chunks without an external model call", async () => {
        await workspace("Pipeline");
        await studio
            .getByRole("combobox", { name: "Source text column" })
            .selectOption({ label: "body" });
        await studio.getByRole("button", { name: "Preview chunks", exact: true }).click();
        await expect(studio.getByRole("list", { name: "Chunk preview" })).toBeVisible({
            timeout: 30_000,
        });
        await capture("pipeline");
    });
    test("Pinned results keep local analysis and disable connection workspaces", async () => {
        await studio.getByRole("tab", { name: /^Results/ }).click();
        await studio.getByRole("button", { name: "Pin all results", exact: true }).press("Enter");
        const { page } = getContext();
        pinned = page
            .frameLocator(`.webview:not([name="${studioName}"])`)
            .frameLocator("#active-frame");
        await pinned.getByRole("tab", { name: "Vector", exact: true }).click();
        await expect(pinned.locator(".qs-vec-profile")).toBeVisible({ timeout: 30_000 });
        for (const name of ["Search", "Index", "Pipeline"]) {
            await expect(
                pinned.locator(`[data-workspace="${name.toLowerCase()}"]`),
            ).toHaveAttribute("aria-disabled", "true");
        }
    });
    test("turning off preview unmounts live and pinned vector panes", async () => {
        const { userDataDir } = getContext();
        const user = path.join(userDataDir, "User");
        const profiles = path.join(user, "profiles");
        const files = [path.join(user, "settings.json")];
        if (fs.existsSync(profiles)) {
            for (const profile of fs.readdirSync(profiles)) {
                const file = path.join(profiles, profile, "settings.json");
                if (fs.existsSync(file)) files.push(file);
            }
        }
        for (const file of files) {
            const settings = JSON.parse(fs.readFileSync(file, "utf8"));
            settings["mssql.queryStudio.vectorWorkbench.enabled"] = false;
            fs.writeFileSync(file, JSON.stringify(settings, undefined, 4));
        }
        for (const frame of [studio, pinned]) {
            await expect(frame.locator(".qs-vec-root")).toHaveCount(0, { timeout: 30_000 });
            await expect(frame.getByRole("tab", { name: "Vector", exact: true })).toHaveCount(0);
        }
    });
});
