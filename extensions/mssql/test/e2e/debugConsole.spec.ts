/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getWebviewByTitle, runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("Debug Console navigation", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: {
                "mssql.showChangelogOnUpdate": false,
                "mssql.enableExperimentalFeatures": true,
                "mssql.debugConsole.enabled": true,
            },
        },
    });

    test("starts on Consolidated Trace and exposes the supported pages", async () => {
        const { page } = getContext();
        await runCommandFromPalette(
            page,
            "MS SQL: Open Debug Console",
            "MS SQL: Open Debug Console",
        );
        const consoleView = await getWebviewByTitle(page, "MSSQL Debug Console");
        const navigation = consoleView.locator(".dc-leftnav");
        await expect(
            consoleView.getByRole("heading", { name: "Consolidated Trace", exact: true }),
        ).toBeInViewport();
        for (const removed of [
            "Overview",
            "Perf Test History",
            "SQL Activity",
            "Connections",
            "Query & Results",
            "Object Explorer",
        ]) {
            await expect(
                navigation.getByRole("button", { name: removed, exact: true }),
            ).toHaveCount(0);
        }
        for (const [name, heading] of [
            ["Waterfall", "Cross-Process Waterfall"],
            ["Session History", "History"],
            ["Exports", "Exports"],
            ["Settings", "Settings"],
            ["Consolidated Trace", "Consolidated Trace"],
        ]) {
            await navigation.getByRole("button", { name, exact: true }).click();
            await expect(
                consoleView.getByRole("heading", {
                    name: heading,
                    exact: true,
                }),
            ).toBeInViewport();
        }
        await expect(consoleView.getByText(/Import perf run.*Overview/)).toHaveCount(0);
    });
});
