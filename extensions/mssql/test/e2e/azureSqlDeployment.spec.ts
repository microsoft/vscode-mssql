/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getWebviewByTitle, runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { ContainerEngine } from "../../src/sharedInterfaces/azureSqlDatabase";

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
        const body = await deployment.locator("body").elementHandle();
        const frame = await body!.ownerFrame();
        await frame!.evaluate((engines) => {
            let attempt = 0;
            const original = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data")!;
            const responses = new WeakMap<MessageEvent, unknown>();
            // Replace detection responses as the RPC reader reads them, before it resolves requests.
            Object.defineProperty(MessageEvent.prototype, "data", {
                ...original,
                get(this: MessageEvent) {
                    if (responses.has(this)) {
                        return responses.get(this);
                    }
                    const message = original.get!.call(this) as {
                        id?: number | string;
                        result?: Record<string, { success?: boolean }>;
                    };
                    if (
                        !message?.result ||
                        !engines.every(
                            (engine) => typeof message.result?.[engine]?.success === "boolean",
                        )
                    ) {
                        return message;
                    }
                    attempt++;
                    if (attempt > 2) {
                        Object.defineProperty(MessageEvent.prototype, "data", original);
                        return message;
                    }
                    const response =
                        attempt === 1
                            ? {
                                  ...message,
                                  result: Object.fromEntries(
                                      engines.map((engine) => [engine, { success: false }]),
                                  ),
                              }
                            : {
                                  jsonrpc: "2.0",
                                  id: message.id,
                                  error: {
                                      code: -32603,
                                      message: "Temporary engine detection failure",
                                  },
                              };
                    responses.set(this, response);
                    return response;
                },
            });
        }, Object.values(ContainerEngine));
        const localSection = deployment.getByRole("region", { name: "Run locally", exact: true });
        const cloudSection = deployment.getByRole("region", {
            name: "Run in the cloud",
            exact: true,
        });
        // The iframe exists before the cold, coverage-instrumented webview finishes bootstrapping.
        await expect(
            localSection.getByRole("heading", { name: "Run locally", level: 2 }),
        ).toBeVisible({ timeout: 30_000 });
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

        await expect(sqlServer).toBeVisible();
        await expect(azureContainer).toBeVisible();
        await expect(fabric).toBeVisible();
        await expect(azure).toBeVisible();
        await expect(localSection.getByRole("button")).toHaveText([
            /Azure SQL Database container \(Preview\)/,
            /SQL Server container/,
        ]);
        await expect(cloudSection.getByRole("button")).toHaveText([
            /Azure SQL Database/,
            /SQL database in Fabric/,
        ]);
        await azureContainer.click();
        await expect(
            deployment.getByText("Azure SQL Database developer container", { exact: true }),
        ).toBeVisible();
        const next = deployment.getByRole("button", { name: "Next", exact: true });
        await next.click();
        await expect(
            deployment.getByText("Install a container engine to continue", { exact: true }),
        ).toBeVisible();
        await expect(next).toBeDisabled();
        const retryDetection = deployment.getByRole("button", { name: "Retry", exact: true });
        await retryDetection.click();
        await expect(
            deployment.getByText("Container engine detection failed.", { exact: true }),
        ).toBeVisible();
        await expect(next).toBeDisabled();
        await retryDetection.click();
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
        await next.click();
        await expect(deployment.getByText("Free tier applied", { exact: true })).toBeVisible();
        const freeTierSettings = deployment.getByText(/^Settings are fixed for free tier\./);
        const freeTierLink = freeTierSettings.getByRole("link", {
            name: "Learn more about Azure SQL Database free tier",
            exact: true,
        });
        await expect(freeTierLink).toHaveText("Learn more");
        await expect(freeTierLink).toHaveAttribute("href", "https://aka.ms/sqlfreeoffer");
        await expect(freeTierLink).toHaveAttribute("target", "_blank");
        await expect(freeTierLink.locator("svg")).toBeVisible();
        await deployment.getByRole("button", { name: "Previous", exact: true }).click();
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
        await deployment.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("opens each Create option from Getting Started in the requested order", async () => {
        const { page } = getContext();
        const options = [
            {
                name: "Local Azure SQL Database container (Preview)",
                title: "Azure SQL Database developer container",
            },
            {
                name: "Local SQL Server container",
                title: "Create a Local Docker SQL Server",
            },
            { name: /Azure SQL Database\s*Free$/, title: "Create an Azure SQL Database" },
            { name: "SQL database in Fabric", title: "Create a SQL database in Fabric" },
            {
                name: /Deploy local database to Azure SQL \(Preview\)$/,
                title: "Deploy a database to Azure SQL (Preview)",
            },
        ];

        for (const option of options) {
            await runCommandFromPalette(
                page,
                "MS SQL: Open Getting Started",
                "MS SQL: Open Getting Started",
            );
            const overview = await getWebviewByTitle(page, "SQL Server (mssql)");
            await overview
                .getByRole("button", { name: "More create options", exact: true })
                .click();
            await expect(overview.getByRole("menuitem")).toHaveText(
                options.map(({ name }) => name),
            );
            await overview.getByRole("menuitem", { name: option.name, exact: true }).click();

            const deployment = await getWebviewByTitle(page, "New Deployment");
            await expect(deployment.getByText(option.title, { exact: true })).toBeVisible({
                timeout: 30_000,
            });
            await deployment.getByRole("button", { name: "Previous", exact: true }).click();
            await expect(
                deployment.getByRole("heading", { name: "Run locally", level: 2 }),
            ).toBeVisible();
            await deployment.getByRole("button", { name: "Cancel", exact: true }).click();
        }

        await runCommandFromPalette(
            page,
            "MS SQL: Open Getting Started",
            "MS SQL: Open Getting Started",
        );
        const overview = await getWebviewByTitle(page, "SQL Server (mssql)");
        await overview.getByRole("button", { name: "Create", exact: true }).click();
        const deployment = await getWebviewByTitle(page, "New Deployment");
        await expect(
            deployment.getByRole("heading", { name: "Run locally", level: 2 }),
        ).toBeVisible({ timeout: 30_000 });
        await deployment.getByRole("button", { name: "Cancel", exact: true }).click();
    });
});
