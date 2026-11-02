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
        const local = deployment.getByRole("region", { name: "Local provisioning", exact: true });
        const remote = deployment.getByRole("region", { name: "Remote provisioning", exact: true });
        const migration = deployment.getByRole("region", { name: "Deployment", exact: true });
        await expect(local.getByRole("button")).toHaveCount(2);
        await expect(remote.getByRole("button")).toHaveCount(2);
        await expect(migration.getByRole("button")).toHaveCount(1);
        const sqlServer = local.getByRole("button", {
            name: /^Create a Local Docker SQL Server/,
        });
        const azureContainer = local.getByRole("button", {
            name: /^Azure SQL Database container \(Preview\)/,
        });
        const fabric = remote.getByRole("button", {
            name: /^Create a SQL database in Fabric/,
        });
        const azure = remote.getByRole("button", {
            name: /^Create an Azure SQL Database/,
        });
        const localToCloud = migration.getByRole("button", {
            name: /^Deploy a local database/,
        });

        await expect(sqlServer).toBeVisible();
        await expect(azureContainer).toBeVisible();
        await expect(fabric).toBeVisible();
        await expect(azure).toBeVisible();
        await expect(localToCloud).toBeVisible();
        await localToCloud.click();
        await expect(
            deployment.getByText("Select a local database", { exact: true }),
        ).toBeVisible();
        await expect(deployment.getByLabel("Deployment steps").getByRole("listitem")).toHaveCount(
            5,
        );
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(localToCloud).toBeVisible();
        await azureContainer.click();
        await expect(
            deployment.getByText("Azure SQL Database container", { exact: true }),
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
