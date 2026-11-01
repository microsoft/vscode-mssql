/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    DatabaseHubResourceType,
    FabricEnvironment,
    getDatabaseHubLink,
    getFabricEnvironment,
    getFabricItemIdFromDatabaseName,
    getFabricSqlDatabaseDisplayName,
    getFabricWorkspaceIdCandidates,
    isDatabaseHubResourceId,
    isSystemDatabaseName,
    parseArmResourceId,
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

    suite("getFabricItemIdFromDatabaseName", () => {
        test("returns the item GUID at the end of a Fabric SQL catalog name", () => {
            expect(
                getFabricItemIdFromDatabaseName("Orders-0D373898-C2DA-4729-AC46-80C1EF8ED940"),
            ).to.equal("0d373898-c2da-4729-ac46-80c1ef8ed940");
            expect(getFabricItemIdFromDatabaseName("Orders")).to.be.undefined;
            expect(getFabricItemIdFromDatabaseName(undefined)).to.be.undefined;
        });
    });

    suite("parseArmResourceId", () => {
        test("parses a top-level resource and a child resource", () => {
            expect(
                parseArmResourceId(
                    "/subscriptions/sub/resourcegroups/rg/providers/Microsoft.Sql/managedInstances/mi",
                ),
            ).to.deep.equal({
                subscriptionId: "sub",
                resourceGroup: "rg",
                resourceType: "microsoft.sql/managedinstances",
                name: "mi",
            });
            expect(
                parseArmResourceId(
                    "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/databases/db",
                ),
            ).to.include({ name: "srv", childType: "databases", childName: "db" });
        });

        test("decodes a percent-encoded ID", () => {
            expect(
                parseArmResourceId(
                    "%2Fsubscriptions%2Fsub%2FresourceGroups%2Frg%2Fproviders%2FMicrosoft.Sql%2Fservers%2Fsrv",
                )?.name,
            ).to.equal("srv");
        });

        test("rejects IDs of any other shape", () => {
            expect(parseArmResourceId("/subscriptions/sub/resourceGroups/rg")).to.be.undefined;
            expect(parseArmResourceId("srv.database.windows.net")).to.be.undefined;
            expect(parseArmResourceId(undefined)).to.be.undefined;
        });
    });

    suite("isDatabaseHubResourceId", () => {
        test("accepts Fabric GUIDs, top-level ARM IDs, and Azure SQL database IDs", () => {
            expect(isDatabaseHubResourceId("0d373898-c2da-4729-ac46-80c1ef8ed940")).to.be.true;
            expect(
                isDatabaseHubResourceId(
                    "/subscriptions/s/resourceGroups/rg/providers/Microsoft.AzureArcData/sqlServerInstances/box",
                ),
            ).to.be.true;
            expect(
                isDatabaseHubResourceId(
                    "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/databases/db",
                ),
            ).to.be.true;
        });

        test("rejects shapes the Hub ignores", () => {
            expect(
                isDatabaseHubResourceId(
                    "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/managedInstances/mi/databases/db",
                ),
            ).to.be.false;
            expect(
                isDatabaseHubResourceId(
                    "%2Fsubscriptions%2Fs%2FresourceGroups%2Frg%2Fproviders%2FMicrosoft.Sql%2Fservers%2Fsrv",
                ),
            ).to.be.false;
            expect(isDatabaseHubResourceId("srv")).to.be.false;
        });
    });

    suite("getDatabaseHubLink", () => {
        const estateView = (url: URL) => JSON.parse(url.searchParams.get("estateView")!);

        test("opens the unfiltered estate grid sorted by issues", () => {
            const url = new URL(getDatabaseHubLink()!);

            expect(url.origin).to.equal("https://app.fabric.microsoft.com");
            expect(url.pathname).to.equal("/workloads/fdh/databaseHub/estate");
            expect([...url.searchParams.keys()]).to.deep.equal(["estateView"]);
            expect(estateView(url)).to.deep.equal({
                schemaVersion: 1,
                state: {
                    filters: [],
                    category: ["all"],
                    relevance: ["all"],
                    sort: { column: "issues", direction: "descending" },
                },
            });
        });

        test("deep-links to a resource over a grid filtered by type and subscription", () => {
            const resourceId =
                "/subscriptions/AAAA/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/databases/db";
            const url = new URL(
                getDatabaseHubLink({
                    databaseResourceId: encodeURIComponent(resourceId),
                    resourceTypes: [DatabaseHubResourceType.AzureSql],
                    subscriptionId: "AAAA",
                })!,
            );

            expect([...url.searchParams.keys()]).to.deep.equal([
                "databaseResourceId",
                "estateView",
            ]);
            // The ID goes into the link decoded, then URL-encoded once like any parameter.
            expect(url.searchParams.get("databaseResourceId")).to.equal(resourceId);
            expect(url.search).to.contain("databaseResourceId=%2Fsubscriptions%2FAAAA");
            expect(estateView(url).state.filters).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "subscription", operator: "in", value: ["aaaa"] },
            ]);
        });

        test("searches the grid when there is no resource to open", () => {
            const url = new URL(
                getDatabaseHubLink({
                    resourceTypes: [
                        DatabaseHubResourceType.ArcSqlServer,
                        DatabaseHubResourceType.AzureSqlVM,
                    ],
                    search: " box01 ",
                })!,
            );

            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(estateView(url).state.filters).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["ArcSqlServer", "AzureSqlVM"] },
                { key: "search", operator: "contains", value: "box01" },
            ]);
        });

        test("leaves out a resource ID the Hub would ignore", () => {
            const url = new URL(getDatabaseHubLink({ databaseResourceId: "not-an-id" })!);

            expect(url.searchParams.has("databaseResourceId")).to.be.false;
        });

        test("targets the portal of the requested pre-production environment", () => {
            const url = new URL(
                getDatabaseHubLink({
                    environment: FabricEnvironment.Msit,
                    databaseResourceId: "0d373898-c2da-4729-ac46-80c1ef8ed940",
                    resourceTypes: [DatabaseHubResourceType.FabricSql],
                })!,
            );

            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(url.searchParams.get("databaseResourceId")).to.equal(
                "0d373898-c2da-4729-ac46-80c1ef8ed940",
            );
        });
    });

    suite("getFabricWorkspaceIdCandidates", () => {
        test("decodes the base32 workspace ID of a Fabric SQL host in both byte orders", () => {
            expect(
                getFabricWorkspaceIdCandidates(
                    "bu3trggc3jdstlcgqda67dwzia-abcdefghijklmnopqrstuvwxyz.database.fabric.microsoft.com,1433",
                ),
            ).to.deep.equal([
                "0d373898-c2da-4729-ac46-80c1ef8ed940",
                "9838370d-dac2-2947-ac46-80c1ef8ed940",
            ]);
        });

        test("returns nothing for other hosts", () => {
            expect(getFabricWorkspaceIdCandidates("srv.database.windows.net")).to.deep.equal([]);
            expect(
                getFabricWorkspaceIdCandidates("short.database.fabric.microsoft.com"),
            ).to.deep.equal([]);
        });
    });
});
