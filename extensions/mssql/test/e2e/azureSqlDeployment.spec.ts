/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getWebviewByTitle, runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("Azure SQL deployment options", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: {
                "mssql.showChangelogOnUpdate": false,
                "mssql.enableExperimentalFeatures": false,
            },
        },
    });

    test("opens local and free deployment flows without preview flags", async () => {
        const { page } = getContext();
        await runCommandFromPalette(page, "MS SQL: New Deployment", "MS SQL: New Deployment");
        const deployment = await getWebviewByTitle(page, "New Deployment");
        await deployment.getByRole("button", { name: /^Create an Azure SQL Database/ }).click();

        await expect(deployment.getByRole("button", { name: /^Free/ })).toBeVisible();
        await deployment.getByRole("button", { name: /^Local container/ }).click();
        await expect(
            deployment.getByText("Azure SQL Database developer container", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();

        await deployment.getByRole("button", { name: /^Free/ }).click();
        await expect(
            deployment.getByText("Create an Azure SQL Database", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(deployment.getByRole("button", { name: /^Local container/ })).toBeVisible();
    });
});
