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
        const localSection = deployment.getByRole("region", { name: "Run locally", exact: true });
        const cloudSection = deployment.getByRole("region", {
            name: "Run in the cloud",
            exact: true,
        });
        const deploySection = deployment.getByRole("region", {
            name: "Deploy to the cloud",
            exact: true,
        });
        await expect(
            localSection.getByRole("heading", { name: "Run locally", level: 2 }),
        ).toBeVisible();
        await expect(
            cloudSection.getByRole("heading", { name: "Run in the cloud", level: 2 }),
        ).toBeVisible();
        const sqlServer = localSection.getByRole("button", {
            name: /^SQL Server container/,
        });
        const azureContainer = localSection.getByRole("button", {
            name: /^Azure SQL Database container \(Preview\)/,
        });
        const fabric = cloudSection.getByRole("button", {
            name: /^SQL database in Fabric/,
        });
        const azure = cloudSection.getByRole("button", {
            name: /^Azure SQL Database(?! container)/,
        });
        const deployLocalDatabase = deploySection.getByRole("button", {
            name: /^Local database to Azure SQL Database/,
        });

        await expect(sqlServer).toBeVisible();
        await expect(azureContainer).toBeVisible();
        await expect(fabric).toBeVisible();
        await expect(azure).toBeVisible();
        await expect(deployLocalDatabase).toBeVisible();
        await expect(localSection.getByRole("button")).toHaveText([
            /Azure SQL Database container \(Preview\)/,
            /SQL Server container/,
        ]);
        await expect(cloudSection.getByRole("button")).toHaveText([
            /Azure SQL Database/,
            /SQL database in Fabric/,
        ]);
        const [containerLeft, deploymentLeft] = await Promise.all([
            azureContainer.evaluate((card) => card.getBoundingClientRect().left),
            deployLocalDatabase.evaluate((card) => card.getBoundingClientRect().left),
        ]);
        expect(Math.abs(deploymentLeft - containerLeft)).toBeLessThan(1);
        await azureContainer.click();
        await expect(
            deployment.getByText("Azure SQL Database developer container", { exact: true }),
        ).toBeVisible();
        const next = deployment.getByRole("button", { name: "Next", exact: true });
        await next.click();
        await expect(next).toBeEnabled({ timeout: 60_000 });
        await next.click();
        await deployment.getByRole("combobox", { name: "Authentication Type" }).click();
        await expect(deployment.getByRole("option")).toHaveText([
            "SQL Login",
            "Microsoft Entra ID - Universal with MFA support",
        ]);
        await deployment
            .getByRole("option", {
                name: "Microsoft Entra ID - Universal with MFA support",
                exact: true,
            })
            .click();
        await expect(deployment.getByRole("combobox", { name: "Azure Account" })).toBeVisible();
        await expect(
            deployment.getByRole("combobox", { name: "Tenant ID", exact: true }),
        ).toBeVisible();
        await deployment
            .getByRole("textbox", { name: "Application (client) ID", exact: true })
            .fill("22222222-2222-2222-2222-222222222222");
        await expect(
            deployment.getByRole("textbox", {
                name: "Microsoft Entra administrator object ID",
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(
            deployment.getByRole("textbox", {
                name: "Microsoft Entra administrator name",
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(deployment.getByText("Client secret", { exact: true })).toHaveCount(0);
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(next).toBeEnabled();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
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

        await deployLocalDatabase.click();
        await expect(deployment.getByText("Source", { exact: true })).toBeVisible();
        await expect(deployment.getByText("Step 1 of 5", { exact: true })).toBeVisible();
        await expect(deployment.getByRole("list", { name: "Deployment steps" })).toHaveCount(0);
        await expect(
            deployment.getByRole("heading", {
                name: "Deploy a database to Azure SQL",
                exact: true,
            }),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
        await expect(deployLocalDatabase).toBeVisible();
    });
});
