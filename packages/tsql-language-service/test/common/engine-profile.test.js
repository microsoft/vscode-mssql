/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    capabilityGeneration,
    createEngineCapabilities,
    engineEditions,
    parseServerMajorVersion,
    resolveEngineProfile,
    resolveTsqlFeatureProfile,
    sqlEngineProfiles,
} = require("../../dist/index.js");

// Every documented DatabaseEngineEdition value, so a new engine cannot be silently absorbed into
// an existing profile. Mirrors ConnectionEnums.cs in SQL Management Objects.
const editionTable = [
    [engineEditions.unknown, "unknown", "noFacts"],
    [engineEditions.personal, "sql-server", "engineEdition"],
    [engineEditions.standard, "sql-server", "engineEdition"],
    [engineEditions.enterprise, "sql-server", "engineEdition"],
    [engineEditions.express, "sql-server", "engineEdition"],
    [engineEditions.azureSqlDatabase, "azure-sql-database", "engineEdition"],
    [engineEditions.azureSynapseDedicated, "azure-synapse-dedicated", "engineEdition"],
    [engineEditions.stretchDatabase, "sql-server", "engineEdition"],
    [engineEditions.azureSqlManagedInstance, "azure-sql-managed-instance", "engineEdition"],
    [engineEditions.azureSqlEdge, "sql-server", "engineEdition"],
    [engineEditions.azureArcManagedInstance, "sql-server", "engineEdition"],
    [engineEditions.azureSynapseServerless, "unknown", "outOfScope"],
];

suite("engine profile resolution", () => {
    // Verifies the table is exhaustive over every published engine edition.
    test("maps every known engine edition", () => {
        for (const [edition, expectedProfile, expectedSource] of editionTable) {
            const resolution = resolveEngineProfile({ engineEdition: edition });
            assert.equal(resolution.profile, expectedProfile, `edition ${edition}`);
            assert.equal(resolution.source, expectedSource, `edition ${edition}`);
            assert.ok(resolution.reason.length > 0);
        }
    });

    // Verifies a future edition defers rather than falling back to SQL Server.
    test("defers on an unrecognized or future engine edition", () => {
        for (const edition of [12, 42, 9999]) {
            const resolution = resolveEngineProfile({ engineEdition: edition });
            assert.equal(resolution.profile, "unknown");
            assert.equal(resolution.source, "unrecognizedEdition");
        }
    });

    // Verifies the two Azure services never collapse into one another.
    test("separates Azure SQL Database from Managed Instance", () => {
        assert.equal(resolveEngineProfile({ engineEdition: 5 }).profile, "azure-sql-database");
        assert.equal(
            resolveEngineProfile({ engineEdition: 8 }).profile,
            "azure-sql-managed-instance",
        );
        assert.notEqual(
            createEngineCapabilities({ engineEdition: 5 }).capabilities.serverScopedObjects,
            createEngineCapabilities({ engineEdition: 8 }).capabilities.serverScopedObjects,
        );
    });

    // Verifies Fabric is detected from its endpoint and serverless stays out of scope.
    test("separates Fabric Data Warehouse from Synapse serverless", () => {
        const fabric = resolveEngineProfile({
            engineEdition: 11,
            serverName: "abcdef.datawarehouse.fabric.microsoft.com",
        });
        assert.equal(fabric.profile, "fabric-warehouse");
        assert.equal(fabric.source, "engineEditionAndServerName");

        const serverless = resolveEngineProfile({
            engineEdition: 11,
            serverName: "workspace-ondemand.sql.azuresynapse.net",
        });
        assert.equal(serverless.profile, "unknown");
        assert.equal(serverless.source, "outOfScope");
        assert.match(serverless.reason, /serverless/iu);
    });

    // A host that already classified an aliased endpoint is authoritative over suffix heuristics.
    test("accepts an authoritative host profile", () => {
        const resolution = resolveEngineProfile({
            engineProfile: "fabric-warehouse",
            engineEdition: 11,
            serverName: "private-alias.contoso.test",
        });
        assert.equal(resolution.profile, "fabric-warehouse");
        assert.equal(resolution.source, "hostSupplied");
    });

    // Verifies a comma-suffixed server name, as a connection string writes it, still matches.
    test("recognizes a Fabric endpoint written with a port", () => {
        const resolution = resolveEngineProfile({
            engineEdition: 11,
            serverName: "WS.DataWarehouse.Fabric.Microsoft.Com,1433",
        });
        assert.equal(resolution.profile, "fabric-warehouse");
    });

    // Verifies a disconnected or permission-limited environment reports no engine at all.
    test("defers while the environment reports nothing", () => {
        for (const facts of [undefined, {}, { compatibilityLevel: 160 }, { engineEdition: 0 }]) {
            const resolution = resolveEngineProfile(facts);
            assert.equal(resolution.profile, "unknown");
        }
    });

    // Verifies a malformed host value cannot enable a gate.
    test("drops malformed facts instead of coercing them", () => {
        const resolution = resolveEngineProfile({
            engineEdition: 5.5,
            compatibilityLevel: Number.NaN,
            serverVersion: "",
        });
        assert.equal(resolution.profile, "unknown");
        assert.deepEqual(resolution.facts, {});
    });

    test("parses the major component of a product version", () => {
        assert.equal(parseServerMajorVersion("16.0.1000.6"), 16);
        assert.equal(parseServerMajorVersion("12.0.2000.8"), 12);
        assert.equal(parseServerMajorVersion(undefined), undefined);
        assert.equal(parseServerMajorVersion("not-a-version"), undefined);
    });
});

suite("engine capabilities", () => {
    // Verifies the reported boxed product version is ignored for evergreen Azure services, which
    // all keep reporting 12.0.x while accepting current syntax.
    test("takes the language level from the profile for Azure services", () => {
        const azure = createEngineCapabilities({
            engineEdition: 5,
            serverVersion: "12.0.2000.8",
        });
        assert.equal(azure.serverMajorVersion, 17);
        assert.equal(azure.compatibilityLevel, 170);

        const synapse = createEngineCapabilities({
            engineEdition: 6,
            serverVersion: "12.0.2000.8",
        });
        assert.equal(synapse.serverMajorVersion, 13);

        const fabric = createEngineCapabilities({
            engineEdition: 11,
            serverName: "ws.datawarehouse.fabric.microsoft.com",
            serverVersion: "12.0.2000.8",
        });
        assert.equal(fabric.serverMajorVersion, 16);
        assert.equal(fabric.compatibilityLevel, 160);
    });

    // Verifies a reported compatibility level always wins over the profile default.
    test("prefers the reported compatibility level", () => {
        const capabilities = createEngineCapabilities({
            engineEdition: 5,
            compatibilityLevel: 150,
        });
        assert.equal(capabilities.compatibilityLevel, 150);
    });

    // Verifies boxed SQL Server reads its own product version.
    test("reads the product version for boxed SQL Server", () => {
        const capabilities = createEngineCapabilities({
            engineEdition: 3,
            serverVersion: "16.0.4085.2",
            compatibilityLevel: 160,
        });
        assert.equal(capabilities.serverMajorVersion, 16);
        assert.equal(capabilities.generation, "sql-server/16/160/ga");
        assert.equal(capabilities.displayName, "SQL Server 2022 (compatibility level 160)");
    });

    // Verifies an unidentified engine carries no level at all rather than a guessed one.
    test("carries no level while the engine is unknown", () => {
        const capabilities = createEngineCapabilities(undefined);
        assert.equal(capabilities.engineProfile, "unknown");
        assert.equal(capabilities.serverMajorVersion, undefined);
        assert.equal(capabilities.compatibilityLevel, undefined);
        assert.equal(capabilities.generation, "unknown/?/?/ga");
        for (const value of Object.values(capabilities.capabilities)) {
            assert.equal(value, "deferred");
        }
    });

    // Verifies the generation is the identity two snapshots are compared by.
    test("generates one identity per profile, level, and preview policy", () => {
        const generations = new Set();
        for (const engineProfile of sqlEngineProfiles) {
            for (const previewFeatures of [false, true]) {
                generations.add(
                    capabilityGeneration({
                        engineProfile,
                        serverMajorVersion: 17,
                        compatibilityLevel: 170,
                        previewFeatures,
                    }),
                );
            }
        }
        assert.equal(generations.size, sqlEngineProfiles.length * 2);
    });

    // Verifies a partial host profile is normalized rather than trusted.
    test("normalizes a partial host profile", () => {
        assert.deepEqual(resolveTsqlFeatureProfile(undefined), {
            engineProfile: "unknown",
            previewFeatures: false,
        });
        assert.deepEqual(
            resolveTsqlFeatureProfile({
                engineProfile: "fabric-warehouse",
                serverMajorVersion: 99,
                compatibilityLevel: 165,
                previewFeatures: true,
            }),
            { engineProfile: "fabric-warehouse", previewFeatures: true },
        );
    });
});
