/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("Object Explorer v2 view parity", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: {
                "mssql.showChangelogOnUpdate": false,
                "mssql.enableExperimentalFeatures": true,
                "mssql.sqlDataPlane.enabled": true,
                "mssql.objectExplorer.v2.enabled": true,
                "mssql.connectionGroups": [
                    { id: "ROOT", name: "ROOT" },
                    { id: "team", name: "Team", parentId: "ROOT", color: "#e2a400" },
                    { id: "nested", name: "Nested", parentId: "team" },
                ],
                "mssql.connections": [
                    {
                        id: "parity-server",
                        server: "localhost",
                        profileName: "Parity server",
                        authenticationType: "Integrated",
                        groupId: "nested",
                    },
                ],
            },
        },
    });

    test("matches the classic toolbar, group expansion, and Getting Started actions", async ({}, testInfo) => {
        const { page } = getContext();
        const classic = page.locator(".pane").filter({
            has: page.getByRole("heading", { name: "Connections", exact: true }),
        });
        const preview = page.locator(".pane").filter({
            has: page.getByRole("heading", { name: "Connections (Private Preview)", exact: true }),
        });
        const gettingStarted = (pane: typeof classic) =>
            pane.getByRole("treeitem").filter({ hasText: "Getting Started" });
        await expect(gettingStarted(preview)).toBeVisible();
        for (const name of ["Team", "Nested"]) {
            await expect(preview.getByRole("treeitem", { name, exact: true })).toHaveAttribute(
                "aria-expanded",
                "true",
            );
        }
        await expect(preview.getByRole("treeitem", { name: /Parity server/ })).toHaveAttribute(
            "aria-expanded",
            "false",
        );

        const toolbar = (pane: typeof classic) =>
            pane.locator(".pane-header .actions .action-label");
        const labels = (pane: typeof classic) =>
            toolbar(pane).evaluateAll((items) =>
                items.map((item) => item.getAttribute("aria-label")),
            );
        await classic.locator(".pane-header").hover();
        const classicLabels = await labels(classic);
        expect(classicLabels.length).toBeGreaterThanOrEqual(6);
        await preview.locator(".pane-header").hover();
        expect(await labels(preview)).toEqual(classicLabels);
        const icons = (pane: typeof classic) =>
            toolbar(pane).evaluateAll((items) =>
                items.map((item) => ({
                    image: getComputedStyle(item).backgroundImage,
                    mask: getComputedStyle(item).maskImage,
                    glyph: getComputedStyle(item, "::before").content,
                })),
            );
        expect(await icons(preview)).toEqual(await icons(classic));
        for (const pane of [classic, preview]) {
            await pane.locator(".pane-header").hover();
            await pane.getByRole("button", { name: "Enable Group By Schema", exact: true }).click();
            await expect(
                pane.getByRole("button", { name: "Disable Group By Schema", exact: true }),
            ).toBeVisible();
        }
        expect(await labels(preview)).toEqual(await labels(classic));
        expect(await icons(preview)).toEqual(await icons(classic));
        await page.screenshot({ path: testInfo.outputPath("object-explorer-parity.png") });

        await gettingStarted(preview).click();
        await expect(page.getByRole("tab", { name: /SQL Server \(mssql\)/ })).toBeVisible();
        await gettingStarted(preview).click({ button: "right" });
        await page.getByRole("menuitem", { name: "Hide", exact: true }).click();
        await expect(gettingStarted(preview)).toHaveCount(0);
        await expect(gettingStarted(classic)).toHaveCount(0);
        await preview.locator(".pane-header").hover();
        await preview
            .locator(".pane-header")
            .getByRole("button", { name: /More Actions/ })
            .click();
        await page.getByRole("menuitem", { name: "Show Getting Started", exact: true }).click();
        await expect(gettingStarted(preview)).toBeVisible();
        await expect(gettingStarted(classic)).toBeVisible();
    });

    test("opens the shared deployment wizard from the v2 toolbar", async () => {
        const { page } = getContext();
        const preview = page.locator(".pane").filter({
            has: page.getByRole("heading", { name: "Connections (Private Preview)", exact: true }),
        });
        await preview.locator(".pane-header").hover();
        await preview.getByRole("button", { name: "New Deployment", exact: true }).click();
        await expect(page.getByRole("tab", { name: "New Deployment", exact: true })).toBeVisible();
        const wizard = page.frameLocator(".webview:visible").frameLocator("#active-frame");
        await expect(
            wizard.getByRole("button", { name: /Create a Local Docker SQL Server/ }),
        ).toBeVisible();
    });
});
