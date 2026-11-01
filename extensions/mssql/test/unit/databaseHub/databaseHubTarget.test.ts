/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    DatabaseHubConnection,
    DatabaseHubPlatform,
    DatabaseHubServerFacts,
    classifyDatabaseHubTarget,
    getAzureSqlServerName,
    getManagedInstanceName,
} from "../../../src/databaseHub/databaseHubTarget";

suite("Database Hub target", () => {
    const classify = (
        connection: DatabaseHubConnection,
        database?: string,
        facts?: Partial<DatabaseHubServerFacts>,
    ) =>
        classifyDatabaseHubTarget(
            connection,
            database,
            facts ? { server: connection.server, ...facts } : undefined,
        );

    suite("before the first connection", () => {
        test("hides containers", () => {
            expect(
                classify({ server: "localhost,1433", containerName: "sql1" }, "db"),
            ).to.deep.equal({ platform: DatabaseHubPlatform.Container, eligibility: "no" });
        });

        test("shows Azure SQL user databases only", () => {
            const server = "srv.database.windows.net";
            expect(classify({ server }, "orders")).to.deep.equal({
                platform: DatabaseHubPlatform.AzureSqlDatabase,
                eligibility: "yes",
            });
            expect(classify({ server }, "master").eligibility).to.equal("no");
            expect(classify({ server }, undefined).eligibility).to.equal("no");
        });

        test("shows a managed instance and every database under it", () => {
            const server = "mi.abc123.database.windows.net";
            expect(classify({ server }, undefined)).to.deep.equal({
                platform: DatabaseHubPlatform.ManagedInstance,
                eligibility: "yes",
            });
            expect(classify({ server }, "master").eligibility).to.equal("yes");
        });

        test("shows Fabric SQL databases, including pre-production rings", () => {
            expect(
                classify({ server: "x.database.fabric.microsoft.com" }, "Orders-guid"),
            ).to.deep.equal({
                platform: DatabaseHubPlatform.FabricSqlDatabase,
                eligibility: "yes",
            });
            expect(
                classify({ server: "x.msit-database.fabric.microsoft.com" }, "Orders").eligibility,
            ).to.equal("yes");
        });

        test("hides databases that have no Hub row and can't use Arc", () => {
            for (const server of [
                "ws.sql.azuresynapse.net",
                "x.datawarehouse.fabric.microsoft.com",
                "org.crm.dynamics.com",
                "db.abc.us-east-1.rds.amazonaws.com",
                "(localdb)\\MSSQLLocalDB",
            ]) {
                expect(classify({ server }, "db"), server).to.deep.equal({
                    platform: DatabaseHubPlatform.Unsupported,
                    eligibility: "no",
                });
            }
        });

        test("may show a local or unknown SQL Server, which could use Arc", () => {
            for (const server of ["localhost", "box01\\SQLEXPRESS", "10.0.0.4,1433"]) {
                expect(classify({ server }, undefined), server).to.deep.equal({
                    platform: DatabaseHubPlatform.SqlServer,
                    eligibility: "maybe",
                });
            }
        });

        test("shows a connection with a saved resource ID", () => {
            expect(
                classify(
                    {
                        server: "alias.contoso.com",
                        resourceId:
                            "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/managedInstances/mi",
                    },
                    undefined,
                ),
            ).to.deep.equal({ platform: DatabaseHubPlatform.ManagedInstance, eligibility: "yes" });
        });
    });

    suite("after a connection", () => {
        test("hides the Azure SQL Database container, which reports edition 5", () => {
            expect(
                classify({ server: "localhost,1434" }, "db", { engineEdition: 5 }),
            ).to.deep.equal({ platform: DatabaseHubPlatform.Container, eligibility: "no" });
        });

        test("hides a SQL Server whose machine name is a container ID", () => {
            expect(
                classify({ server: "localhost" }, undefined, { isContainer: true }).eligibility,
            ).to.equal("no");
        });

        test("shows a SQL Server once the Arc table names its resource", () => {
            expect(
                classify({ server: "box01" }, undefined, {
                    engineEdition: 3,
                    arc: { state: "registered", resourceId: "/arc/id", onAzureVm: false },
                }).eligibility,
            ).to.equal("yes");
            expect(
                classify({ server: "box01" }, undefined, {
                    engineEdition: 3,
                    arc: { state: "notRegistered" },
                }).eligibility,
            ).to.equal("maybe");
        });

        test("recognizes Azure SQL through an alias by its engine edition", () => {
            expect(
                classify({ server: "db.contoso.com" }, "orders", { engineEdition: 5 }),
            ).to.deep.equal({ platform: DatabaseHubPlatform.AzureSqlDatabase, eligibility: "yes" });
        });

        test("hides dedicated SQL pools and Fabric warehouses by their engine edition", () => {
            const server = "srv.database.windows.net";
            expect(classify({ server }, "pool", { engineEdition: 6 }).eligibility).to.equal("no");
            expect(
                classify({ server: "x.contoso.com" }, "wh", { engineEdition: 11 }).eligibility,
            ).to.equal("no");
        });
    });

    suite("host names", () => {
        test("tells logical servers and managed instances apart", () => {
            expect(getAzureSqlServerName("tcp:srv.database.windows.net,1433")).to.equal("srv");
            expect(getAzureSqlServerName("srv.privatelink.database.windows.net")).to.equal("srv");
            expect(getAzureSqlServerName("mi.zone.database.windows.net")).to.be.undefined;
            expect(getManagedInstanceName("mi.zone.database.windows.net")).to.equal("mi");
            expect(getManagedInstanceName("mi.public.zone.database.windows.net,3342")).to.equal(
                "mi",
            );
            expect(getManagedInstanceName("srv.database.windows.net")).to.be.undefined;
            expect(getManagedInstanceName("srv.privatelink.database.windows.net")).to.be.undefined;
        });
    });
});
