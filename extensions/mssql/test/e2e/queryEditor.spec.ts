/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { openNewQueryEditor } from "./utils/testHelpers";

test.describe("MSSQL Extension - Query Editor", () => {
    const getContext = useSharedVsCodeLifecycle();

    test("a new query opens in the active editor group", async () => {
        const { page } = getContext();
        async function openUnconnectedQuery(): Promise<void> {
            await openNewQueryEditor(page);
            // No profile is configured for this editor-only test. Wait for the connection
            // picker before dismissing it, so it cannot arrive over the next command palette.
            await expect(
                page.getByRole("textbox", {
                    name: "Choose a connection profile from the list below",
                }),
            ).toBeVisible();
            await new QuickInput(page).close();
        }
        await openUnconnectedQuery();
        await new QuickInput(page).runCommand("Split Editor Right", "View: Split Editor Right");
        const groups = page.locator(".editor-group-container");
        await expect(groups).toHaveCount(2);
        const first = groups.nth(0);
        const second = groups.nth(1);
        await second.getByRole("tab", { name: /Untitled-1/ }).click();
        await openUnconnectedQuery();
        await expect(second.getByRole("tab", { name: /Untitled-2/ })).toBeVisible();
        await expect(first.getByRole("tab", { name: /Untitled-2/ })).toHaveCount(0);
        await expect(second.locator('.tab[aria-selected="true"]')).toContainText("Untitled-2");
    });
});
