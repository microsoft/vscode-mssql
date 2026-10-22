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
                "mssql.preview.azureSqlContainers": true,
            },
        },
    });

    test("opens each deployment directly from its card", async () => {
        const { page } = getContext();
        await runCommandFromPalette(page, "MS SQL: New Deployment", "MS SQL: New Deployment");
        const deployment = await getWebviewByTitle(page, "New Deployment");
        await deployment.getByRole("button", { name: /^Create an Azure SQL Database/ }).click();

        const localContainer = deployment.getByRole("button", { name: /^Local container/ });
        const free = deployment.getByRole("button", { name: /^Free/ });
        const deployLocal = deployment.getByRole("button", {
            name: /^Deploy a local database/,
        });
        await expect(free).toBeVisible();
        await expect(deployment.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);

        await deployLocal.click();
        await expect(deployment.getByText("TBD", { exact: true })).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();

        await deployLocal.focus();
        await deployLocal.press("Space");
        await expect(deployment.getByText("TBD", { exact: true })).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();

        await localContainer.click();
        await expect(
            deployment.getByText("Azure SQL Database developer container", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();

        await free.click();
        await expect(
            deployment.getByText("Create an Azure SQL Database", { exact: true }),
        ).toBeVisible();
    });
});
