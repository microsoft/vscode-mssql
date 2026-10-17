/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getWebviewByTitle, runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { completionDebugTrace } from "./fixtures/completionDebugTrace";

for (const standalone of [false, true]) {
    test.describe(`AI completion debug (${standalone ? "standalone" : "console"})`, () => {
        const traceFolder = path.join(os.tmpdir(), `mssql-completion-debug-${randomUUID()}`);
        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: {
                    "mssql.showChangelogOnUpdate": false,
                    "mssql.enableExperimentalFeatures": true,
                    "mssql.copilot.inlineCompletions.enabled": true,
                    "mssql.debugConsole.enabled": true,
                    "mssql.copilot.inlineCompletions.debug.standalonePanel": standalone,
                    "mssql.copilot.inlineCompletions.trace.captureEnabled": false,
                    "mssql.copilot.inlineCompletions.trace.folder": traceFolder,
                    "github.copilot.enable": { sql: false },
                },
            },
            afterLaunch: async () => {
                await fs.mkdir(traceFolder, { recursive: true });
            },
            beforeClose: async () => {
                await fs.rm(traceFolder, { recursive: true, force: true });
            },
        });

        test("opens live experiments and saved sessions", async ({}, testInfo) => {
            const { page } = getContext();
            await runCommandFromPalette(
                page,
                "MSSQL: Open Inline Completion Debug",
                "MSSQL: Open Inline Completion Debug",
            );
            const viewer = await getWebviewByTitle(
                page,
                standalone ? "Copilot Completion Debug" : "MSSQL Debug Console",
            );
            const live = viewer.getByRole("tab", { name: /^Live/ });
            await expect(live).toBeVisible();
            await expect(
                viewer.getByRole("combobox", { name: "Profile", exact: true }),
            ).toBeVisible();
            await expect(
                viewer.getByRole("combobox", { name: "Model", exact: true }),
            ).toBeVisible();
            const profile = viewer.getByRole("combobox", { name: "Profile", exact: true });
            // A clipped child can pass toBeVisible even when its parent is zero-height.
            await expect(profile).toBeInViewport();
            await profile.click();
            await expect(
                viewer.getByRole("option", { name: "Balanced", exact: true }),
            ).toBeInViewport();
            await viewer.getByRole("option", { name: "Balanced", exact: true }).click();
            const grid = viewer
                .locator('[id^="inlineCompletionDebugGrid"][id$="Container"]')
                .first();
            await expect(grid).toBeInViewport();
            await expect
                .poll(async () => (await grid.boundingBox())?.height ?? 0)
                .toBeGreaterThan(100);
            if (!standalone) {
                await expect(viewer.locator(".dc-topbar")).toBeInViewport();
                await expect(viewer.locator(".dc-leftnav")).toBeInViewport();
                await expect(viewer.getByText("Enablement", { exact: true })).toHaveCount(0);
                await viewer
                    .locator(".dc-leftnav")
                    .getByRole("button", { name: "Overview", exact: true })
                    .click();
                await expect(
                    viewer.getByRole("heading", { name: "Overview", exact: true }),
                ).toBeVisible();
                await viewer
                    .locator(".dc-leftnav")
                    .getByRole("button", { name: "Completions", exact: true })
                    .click();
                await expect(profile).toBeInViewport();
            }
            await page.screenshot({ path: testInfo.outputPath("live.png") });
            await viewer.getByRole("tab", { name: /^Sessions/ }).click();
            await expect(
                viewer.getByText("Trace collection is off", { exact: true }),
            ).toBeVisible();
            await expect(
                viewer.getByRole("button", { name: "Add file", exact: true }),
            ).toBeVisible();
            const record = viewer.getByRole("button", {
                name: "Enable Trace Collection",
                exact: true,
            });
            await expect(record).toBeInViewport();
            await record.click();
            await page.getByRole("button", { name: "Use this folder", exact: true }).click();
            await expect(viewer.getByText("Trace collection is off", { exact: true })).toBeHidden();

            await fs.writeFile(
                path.join(traceFolder, "mssql-copilot-trace-render-test.json"),
                JSON.stringify(completionDebugTrace),
            );
            await viewer.getByRole("button", { name: "Refresh", exact: true }).click();
            await expect(viewer.getByRole("tab", { name: /^Sessions/ })).toContainText("1 traces");
            await viewer.getByRole("button", { name: "Show trace files", exact: true }).click();
            await viewer.getByRole("button", { name: "Add", exact: true }).click();
            await viewer
                .getByRole("button", { name: "Open the replay trace builder", exact: true })
                .click();
            await expect(
                viewer.getByText("Replay Trace Builder", { exact: true }),
            ).toBeInViewport();
            await viewer.getByRole("button", { name: "Matrix...", exact: true }).click();
            await expect(viewer.getByText("Run config matrix", { exact: true })).toBeInViewport();
            await page.screenshot({ path: testInfo.outputPath("experiments.png") });
            // Exercise keyboard dismissal as well as mouse activation of the drawer.
            await viewer.getByLabel("Cancel", { exact: true }).press("Enter");
            await expect(viewer.getByText("Run config matrix", { exact: true })).toBeHidden();
            await page.screenshot({ path: testInfo.outputPath("sessions.png") });
            await live.press("Enter");
            await expect(
                viewer.getByRole("combobox", { name: "Profile", exact: true }),
            ).toBeVisible();
            await page.setViewportSize({ width: 1100, height: 760 });
            await profile.scrollIntoViewIfNeeded();
            await expect(profile).toBeInViewport();
            await expect
                .poll(async () => (await grid.boundingBox())?.height ?? 0)
                .toBeGreaterThan(100);
            await page.screenshot({ path: testInfo.outputPath("compact.png") });
        });
    });
}
