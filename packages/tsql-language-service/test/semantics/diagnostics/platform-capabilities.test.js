/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../../../dist/index.js");

const uri = "file:///platform-capabilities.sql";
const code = "CrossDatabaseReferenceNotAvailable";

function provider(environment = {}) {
    const metadata = new InMemoryMetadataProvider();
    metadata.replace({
        environment: {
            currentDatabase: "warehouse",
            defaultSchema: "dbo",
            caseSensitive: false,
            ...environment,
        },
        schemas: [{ name: "dbo" }, { name: "sales" }],
        objects: [{ ref: { id: "1" }, schema: "dbo", name: "Customers", kind: "table" }],
    });
    return metadata;
}

async function diagnose(sql, profile, environment) {
    const metadata = provider(environment);
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, profile),
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    await runtime.close(uri);
    return snapshot.semantics.diagnostics.filter((diagnostic) => diagnostic.code === code);
}

const azure = {
    engineProfile: "azure-sql-database",
    serverMajorVersion: 17,
    compatibilityLevel: 170,
    previewFeatures: false,
};
const managedInstance = { ...azure, engineProfile: "azure-sql-managed-instance" };
const synapse = {
    engineProfile: "azure-synapse-dedicated",
    serverMajorVersion: 13,
    compatibilityLevel: 130,
    previewFeatures: false,
};
const fabric = {
    engineProfile: "fabric-warehouse",
    serverMajorVersion: 16,
    compatibilityLevel: 160,
    previewFeatures: false,
};
const unknown = { engineProfile: "unknown", previewFeatures: false };

suite("platform capability semantics", () => {
    // Verifies a name reaching another database is reported where the engine cannot resolve one,
    // at the exact span of the database component.
    test("reports a cross-database name on Azure SQL Database", async () => {
        const sql = "SELECT OrderID FROM reporting.sales.Orders;";
        const diagnostics = await diagnose(sql, azure);

        assert.equal(diagnostics.length, 1);
        assert.equal(sql.slice(diagnostics[0].range.start, diagnostics[0].range.end), "reporting");
        assert.match(diagnostics[0].message, /Azure SQL Database/u);
    });

    // Verifies naming the connected database is not a cross-database reference.
    test("accepts a three-part name for the connected database", async () => {
        assert.deepEqual(await diagnose("SELECT * FROM warehouse.dbo.Customers;", azure), []);
        assert.deepEqual(await diagnose("SELECT * FROM [WareHouse].dbo.Customers;", azure), []);
    });

    // Verifies a case-sensitive catalog compares the name the way the server would.
    test("honours a case-sensitive collation", async () => {
        assert.equal(
            (
                await diagnose("SELECT * FROM WareHouse.dbo.Customers;", azure, {
                    caseSensitive: true,
                })
            ).length,
            1,
        );
    });

    // Verifies the dedicated pool shares the restriction and the instance-scoped engines do not.
    test("agrees with the capability table across profiles", async () => {
        const sql = "SELECT OrderID FROM reporting.sales.Orders;";
        assert.equal((await diagnose(sql, synapse)).length, 1);
        assert.deepEqual(await diagnose(sql, managedInstance), []);
        assert.deepEqual(await diagnose(sql, fabric), []);
    });

    // Verifies an unidentified engine defers the decision instead of guessing a restriction.
    test("defers while the engine is unknown", async () => {
        assert.deepEqual(await diagnose("SELECT * FROM reporting.sales.Orders;", unknown), []);
    });

    // Verifies the check needs an authoritative metadata fact as well as a capability: with no
    // current database reported, nothing can be said about which names cross a boundary.
    test("defers while the current database is unreported", async () => {
        assert.deepEqual(
            await diagnose("SELECT * FROM reporting.sales.Orders;", azure, {
                currentDatabase: undefined,
            }),
            [],
        );
    });

    // Verifies a two-part name is never treated as crossing a database.
    test("ignores one and two-part names", async () => {
        assert.deepEqual(await diagnose("SELECT * FROM dbo.Customers;", azure), []);
        assert.deepEqual(await diagnose("SELECT * FROM Customers;", azure), []);
    });
});
