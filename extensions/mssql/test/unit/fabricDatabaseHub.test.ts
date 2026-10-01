/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    FabricDatabaseHubDatabaseType,
    FabricEnvironment,
    getFabricDatabaseHubLink,
    getFabricEnvironment,
    getFabricSqlDatabaseDisplayName,
    isSystemDatabaseName,
    parseFabricEnvironment,
} from "../../src/fabric/fabricDatabaseHub";

suite("Fabric Database Hub", () => {
    suite("getFabricEnvironment", () => {
        test("resolves the portal environment from a Fabric SQL host", () => {
            expect(getFabricEnvironment("db.database.fabric.microsoft.com,1433")).to.equal(
                FabricEnvironment.Prod,
            );
            expect(getFabricEnvironment("db.msit-database.fabric.microsoft.com,1433")).to.equal(
                FabricEnvironment.Msit,
            );
            expect(getFabricEnvironment("db.daily-database.fabric.microsoft.com")).to.equal(
                FabricEnvironment.Daily,
            );
            expect(getFabricEnvironment("db.DXT-Database.Fabric.Microsoft.Com")).to.equal(
                FabricEnvironment.Dxt,
            );
        });

        test("returns undefined for hosts that are not Fabric SQL endpoints", () => {
            expect(getFabricEnvironment("server.database.windows.net")).to.be.undefined;
            expect(getFabricEnvironment("db.database.fabric.microsoft.com.evil")).to.be.undefined;
            expect(getFabricEnvironment("localhost")).to.be.undefined;
            expect(getFabricEnvironment(undefined)).to.be.undefined;
        });

        test("returns undefined for an unrecognized pre-production ring", () => {
            expect(getFabricEnvironment("db.future-database.fabric.microsoft.com")).to.be.undefined;
        });
    });

    suite("parseFabricEnvironment", () => {
        test("resolves known environment names regardless of casing", () => {
            expect(parseFabricEnvironment("msit")).to.equal(FabricEnvironment.Msit);
            expect(parseFabricEnvironment("PROD")).to.equal(FabricEnvironment.Prod);
        });

        test("returns undefined for unknown or missing names", () => {
            expect(parseFabricEnvironment("nowhere")).to.be.undefined;
            expect(parseFabricEnvironment(undefined)).to.be.undefined;
        });
    });

    suite("getFabricSqlDatabaseDisplayName", () => {
        test("drops the item GUID that Fabric SQL catalogs carry", () => {
            expect(
                getFabricSqlDatabaseDisplayName(
                    "Test Database-0d373898-c2da-4729-ac46-80c1ef8ed940",
                ),
            ).to.equal("Test Database");
        });

        test("leaves names without an item GUID alone", () => {
            expect(getFabricSqlDatabaseDisplayName(" Sales ")).to.equal("Sales");
            expect(getFabricSqlDatabaseDisplayName("")).to.be.undefined;
            expect(getFabricSqlDatabaseDisplayName(undefined)).to.be.undefined;
        });
    });

    suite("isSystemDatabaseName", () => {
        test("recognizes the databases the Hub excludes from its inventory", () => {
            expect(isSystemDatabaseName("master")).to.be.true;
            expect(isSystemDatabaseName(" TempDB ")).to.be.true;
            expect(isSystemDatabaseName("azure_maintenance")).to.be.true;
        });

        test("leaves user databases alone", () => {
            expect(isSystemDatabaseName("testDatabase")).to.be.false;
            expect(isSystemDatabaseName("mastermind")).to.be.false;
            expect(isSystemDatabaseName("")).to.be.false;
            expect(isSystemDatabaseName(undefined)).to.be.false;
        });
    });

    suite("getFabricDatabaseHubLink", () => {
        test("builds an Azure SQL estate link against the production portal", () => {
            const url = new URL(getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql)!);

            expect(url.origin).to.equal("https://app.fabric.microsoft.com");
            expect(url.pathname).to.equal("/workloads/fdh/databaseHub/estate");
            expect(url.searchParams.get("databaseType")).to.equal("azure-sql");
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(JSON.parse(url.searchParams.get("estateView")!)).to.deep.equal({
                schemaVersion: 1,
                state: {
                    filters: [{ key: "resourceType", operator: "in", value: ["AzureSql"] }],
                    category: ["all"],
                    relevance: ["all"],
                    sort: null,
                },
            });
        });

        test("narrows the grid to a single database without opening its details dialog", () => {
            const url = new URL(
                getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
                    databaseName: "testDatabase",
                    subscriptionId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
                    resourceGroupName: "DefaultResourceGroup",
                })!,
            );

            // `databaseResourceId` is what makes the Hub open the database card on arrival.
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(JSON.parse(url.searchParams.get("estateView")!).state.filters).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                {
                    key: "subscription",
                    operator: "in",
                    value: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
                },
                {
                    key: "resourceGroup",
                    operator: "in",
                    value: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/defaultresourcegroup"],
                },
                { key: "search", operator: "contains", value: "testDatabase" },
            ]);
        });

        test("filters by subscription alone when no resource group is given", () => {
            const url = new URL(
                getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
                    subscriptionId: "sub-id",
                })!,
            );

            expect(JSON.parse(url.searchParams.get("estateView")!).state.filters).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "subscription", operator: "in", value: ["sub-id"] },
            ]);
        });

        test("drops a resource group that has no subscription to scope it", () => {
            const url = new URL(
                getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
                    resourceGroupName: "DefaultResourceGroup",
                })!,
            );

            expect(JSON.parse(url.searchParams.get("estateView")!).state.filters).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
            ]);
        });

        test("targets the portal of the requested pre-production environment", () => {
            const url = new URL(
                getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.FabricSql, {
                    environment: FabricEnvironment.Msit,
                })!,
            );

            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(url.searchParams.get("databaseType")).to.equal("fabric-sql");
            expect(JSON.parse(url.searchParams.get("estateView")!).state.filters).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
            ]);
        });
    });
});
