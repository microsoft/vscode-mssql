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
                "mssql.connectionGroups": [{ id: "ROOT", name: "ROOT" }],
                "mssql.connections": [
                    ...Array.from({ length: 60 }, (_, index) => ({
                        id: `local-deployment-${index}`,
                        profileName: `Local development ${index}`,
                        groupId: "ROOT",
                        server: `localhost,${1433 + index}`,
                        database: `InventoryDb${index}`,
                        authenticationType: "SqlLogin",
                        user: "sa",
                        password: "Test-only-invalid-password1!",
                        connectTimeout: 1,
                        savePassword: false,
                    })),
                    {
                        id: "server-only-deployment",
                        profileName: "Server-only local connection",
                        groupId: "ROOT",
                        server: "localhost,1600",
                        database: "",
                        authenticationType: "SqlLogin",
                        user: "sa",
                        savePassword: false,
                    },
                    {
                        id: "remote-deployment",
                        profileName: "Remote connection",
                        groupId: "ROOT",
                        server: "remote.database.windows.net",
                        database: "RemoteDb",
                        authenticationType: "SqlLogin",
                        user: "sa",
                        savePassword: false,
                    },
                ],
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
        await expect(
            deployment.getByRole("heading", { name: "Select a local database" }),
        ).toBeVisible();
        await expect(deployment.locator('[aria-current="step"]')).toHaveText("1Source");
        const connections = deployment.getByRole("group", { name: "Select a local database" });
        const firstSource = connections.getByRole("button").first();
        await expect(firstSource).toContainText("InventoryDb0");
        await expect(firstSource).toContainText("Local development 0 - localhost, 1433");
        await firstSource.click();
        const details = deployment.getByRole("region", { name: "Local database", exact: true });
        await expect(details.getByText("InventoryDb0", { exact: true })).toBeVisible();
        await expect(details.getByText("Local development 0", { exact: true })).toBeVisible();
        await expect(details.getByText("Not connected", { exact: true })).toBeVisible();
        await expect(details.getByText("Not available", { exact: true })).toBeVisible();
        await expect(
            deployment.getByRole("button", { name: "Continue", exact: true }),
        ).toBeDisabled();
        const errorColor = await details.evaluate((element) => {
            const sample = document.createElement("span");
            sample.style.color = "var(--vscode-errorForeground)";
            element.append(sample);
            const color = getComputedStyle(sample).color;
            sample.remove();
            return color;
        });
        await expect(details.getByText("Not connected", { exact: true })).toHaveCSS(
            "color",
            errorColor,
        );
        const schemaAndData = deployment.getByRole("radio", {
            name: "Schema and data",
            exact: true,
        });
        const schemaOnly = deployment.getByRole("radio", { name: "Schema only", exact: true });
        await expect(schemaAndData).toBeChecked();
        await schemaOnly.check();
        await expect(schemaOnly).toBeChecked();
        await expect(schemaAndData).not.toBeChecked();
        const viewport = page.viewportSize();
        await page.setViewportSize({ width: 1280, height: 600 });
        const currentStep = deployment.locator('[aria-current="step"]');
        const headerBeforeScroll = await currentStep.boundingBox();
        const detailsBeforeScroll = await details.boundingBox();
        await schemaOnly.scrollIntoViewIfNeeded();
        const headerAfterScroll = await currentStep.boundingBox();
        const detailsAfterScroll = await details.boundingBox();
        expect(headerBeforeScroll).not.toBeNull();
        expect(headerAfterScroll).not.toBeNull();
        expect(headerAfterScroll!.y).toBeCloseTo(headerBeforeScroll!.y, 0);
        expect(detailsAfterScroll!.y).toBeLessThan(detailsBeforeScroll!.y);
        await expect(currentStep).toBeVisible();
        await deployment.getByRole("button", { name: "Change", exact: true }).click();
        await expect(connections).toBeVisible();
        if (viewport) {
            await page.setViewportSize(viewport);
        }
        await expect(connections.getByRole("button")).not.toHaveCount(60);
        await firstSource.focus();
        await firstSource.press("End");
        await expect(connections.locator('button[data-index="59"]')).toBeFocused();
        const search = deployment.getByRole("searchbox", { name: "Search local connections" });
        await search.fill("LOCAL DEVELOPMENT 42");
        const matchingSource = connections.getByRole("button", { name: /InventoryDb42/ });
        await expect(matchingSource).toBeVisible();
        await matchingSource.press("Space");
        await expect(details.getByText("InventoryDb42", { exact: true })).toBeVisible();
        await expect(
            deployment.getByText(/Copy the structure of InventoryDb42 and the rows/),
        ).toBeVisible();
        await deployment.getByRole("button", { name: "Change", exact: true }).click();
        await expect(search).toHaveValue("LOCAL DEVELOPMENT 42");
        await search.fill("inventorydb42");
        await expect(matchingSource).toBeVisible();
        await search.fill("localhost,1475");
        await expect(matchingSource).toBeVisible();
        await search.fill("remote");
        await expect(deployment.getByRole("status")).toHaveText(
            "No local connections match your search.",
        );
        await search.fill("Server-only");
        await expect(deployment.getByRole("status")).toHaveText(
            "No local connections match your search.",
        );
        await search.fill("");
        await expect(firstSource).toBeVisible();
        expect(
            await connections.evaluate((element) => element.scrollHeight > element.clientHeight),
        ).toBe(true);
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();

        await deployLocal.focus();
        await deployLocal.press("Space");
        await expect(
            deployment.getByRole("heading", { name: "Select a local database" }),
        ).toBeVisible();
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
