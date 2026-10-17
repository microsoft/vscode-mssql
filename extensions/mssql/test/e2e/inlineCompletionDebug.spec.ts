/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getWebviewByTitle, runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

for (const standalone of [false, true]) {
    test.describe(`AI completion debug (${standalone ? "standalone" : "console"})`, () => {
        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: {
                    "mssql.enableExperimentalFeatures": true,
                    "mssql.copilot.inlineCompletions.enabled": true,
                    "mssql.debugConsole.enabled": true,
                    "mssql.copilot.inlineCompletions.debug.standalonePanel": standalone,
                    "mssql.copilot.inlineCompletions.trace.captureEnabled": false,
                    "github.copilot.enable": { sql: false },
                },
            },
        });

        test("opens live experiments and saved sessions", async () => {
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
            await viewer.getByRole("tab", { name: /^Sessions/ }).click();
            await expect(
                viewer.getByText("Trace collection is off", { exact: true }),
            ).toBeVisible();
            await expect(
                viewer.getByRole("button", { name: "Add file", exact: true }),
            ).toBeVisible();
            await live.click();
            await expect(
                viewer.getByRole("combobox", { name: "Profile", exact: true }),
            ).toBeVisible();
        });
    });
}
