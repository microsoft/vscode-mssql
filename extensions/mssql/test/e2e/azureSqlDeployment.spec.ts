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

    test("opens each deployment flow directly from the first page without preview flags", async () => {
        const { page } = getContext();
        await runCommandFromPalette(page, "MS SQL: New Deployment", "MS SQL: New Deployment");
        const deployment = await getWebviewByTitle(page, "New Deployment");
        const sqlServer = deployment.getByRole("button", {
            name: /^Create a Local Docker SQL Server/,
        });
        const azureContainer = deployment.getByRole("button", {
            name: /^Azure SQL Database developer container \(Preview\)/,
        });
        const fabric = deployment.getByRole("button", {
            name: /^Create a SQL database in Fabric/,
        });
        const azure = deployment.getByRole("button", {
            name: /^Create an Azure SQL Database/,
        });

        await expect(sqlServer).toBeVisible();
        await expect(azureContainer).toBeVisible();
        await expect(fabric).toBeVisible();
        await expect(azure).toBeVisible();
        await azureContainer.click();
        await expect(
            deployment.getByText("Azure SQL Database developer container", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();

        await expect(azureContainer).toBeVisible();
        await azure.click();
        await expect(
            deployment.getByText("Create an Azure SQL Database", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(azureContainer).toBeVisible();

        await sqlServer.click();
        await expect(
            deployment.getByText("Create a Local Docker SQL Server", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(azure).toBeVisible();

        await fabric.click();
        await expect(
            deployment.getByText("Create a SQL database in Fabric", { exact: true }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(azureContainer).toBeVisible();
    });
});
