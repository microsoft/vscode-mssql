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
} = require("../../dist/index.js");

const uri = "file:///profile-runtime.sql";
const sql = "BACKUP DATABASE db TO DISK = 'db.bak';";

suite("runtime engine profile", () => {
    // Verifies a runtime with no reported facts analyses under the unknown profile rather than
    // silently assuming SQL Server.
    test("starts unidentified and publishes no platform diagnostics", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, { engineProfile: "unknown", previewFeatures: false }),
        );
        const snapshot = await runtime.open(uri, 1, sql);

        assert.equal(runtime.capabilities.engineProfile, "unknown");
        assert.equal(snapshot.syntax.profileGeneration, "unknown/?/?/ga");
        assert.deepEqual(snapshot.syntax.diagnostics, []);
    });

    // Verifies a connection change republishes availability without presenting text to the parser.
    test("reprofiles open documents without reparsing unchanged text", async () => {
        let parserCalls = 0;
        const inner = new LezerSyntaxService(undefined, {
            engineProfile: "unknown",
            previewFeatures: false,
        });
        const countingSyntax = {
            get profile() {
                return inner.profile;
            },
            parse(document) {
                parserCalls++;
                return inner.parse(document);
            },
            update(previous, document, changes) {
                parserCalls++;
                return inner.update(previous, document, changes);
            },
            setProfile(profile) {
                inner.setProfile(profile);
            },
            reprofile(previous) {
                return inner.reprofile(previous);
            },
        };
        const runtime = new InProcessLanguageServiceRuntime(countingSyntax);
        const opened = await runtime.open(uri, 1, sql);
        assert.equal(parserCalls, 1);
        assert.deepEqual(opened.syntax.diagnostics, []);

        const capabilities = await runtime.setEngineFacts({
            engineEdition: 5,
            compatibilityLevel: 170,
        });

        assert.equal(parserCalls, 1);
        assert.equal(capabilities.engineProfile, "azure-sql-database");
        const republished = runtime.snapshot(uri, 1);
        assert.equal(republished.text, opened.text);
        assert.equal(republished.syntax.profileGeneration, "azure-sql-database/17/170/ga");
        assert.deepEqual(
            republished.syntax.diagnostics.map((diagnostic) => diagnostic.availability.featureId),
            ["statement.backup"],
        );
    });

    // A syntax implementation without the explicit profile capability cannot claim new runtime
    // capabilities while continuing to parse under its old rules.
    test("rejects profile changes for a profile-unaware syntax service", async () => {
        const inner = new LezerSyntaxService(undefined, {
            engineProfile: "unknown",
            previewFeatures: false,
        });
        const syntax = {
            parse: (document) => inner.parse(document),
            update: (previous, document, changes) => inner.update(previous, document, changes),
        };
        const runtime = new InProcessLanguageServiceRuntime(syntax);
        await runtime.open(uri, 1, sql);

        await assert.rejects(
            runtime.setEngineFacts({ engineEdition: 5, compatibilityLevel: 170 }),
            /cannot adopt a different engine profile/u,
        );
        assert.equal(runtime.capabilities.engineProfile, "unknown");
        assert.equal(runtime.snapshot(uri, 1).syntax.profileGeneration, "unknown/?/?/ga");
    });

    // Verifies moving the same text to another engine changes only the availability answer.
    test("a profile change updates availability and keeps the structural tree", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, { engineProfile: "unknown", previewFeatures: false }),
        );
        const opened = await runtime.open(uri, 1, sql);
        const rawErrorsBefore = opened.syntax.statistics.rawErrorNodeCount;

        await runtime.setEngineFacts({ engineEdition: 5 });
        const azure = runtime.snapshot(uri, 1);
        assert.equal(azure.syntax.statistics.rawErrorNodeCount, rawErrorsBefore);
        assert.equal(azure.syntax.diagnostics.length, 1);

        // Managed Instance keeps BACKUP, so the same text loses the diagnostic again.
        await runtime.setEngineFacts({ engineEdition: 8 });
        const managedInstance = runtime.snapshot(uri, 1);
        assert.equal(managedInstance.syntax.statistics.rawErrorNodeCount, rawErrorsBefore);
        assert.deepEqual(managedInstance.syntax.diagnostics, []);
    });

    // Verifies binding is redone for the new profile rather than reused across it.
    test("rebinds when the profile generation changes", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, { engineProfile: "unknown", previewFeatures: false }),
            undefined,
            new InMemoryMetadataProvider(),
        );
        const opened = await runtime.open(uri, 1, "SELECT 1;");
        assert.equal(opened.semantics.profileGeneration, "unknown/?/?/ga");

        await runtime.setEngineFacts({ engineEdition: 6 });
        const republished = runtime.snapshot(uri, 1);
        assert.equal(republished.semantics.profileGeneration, "azure-synapse-dedicated/13/130/ga");
        assert.notEqual(republished.semantics, opened.semantics);
    });

    // Verifies facts that resolve to the same profile do not churn snapshots.
    test("keeps snapshots when new facts resolve to the same generation", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, { engineProfile: "unknown", previewFeatures: false }),
        );
        await runtime.open(uri, 1, sql);
        await runtime.setEngineFacts({ engineEdition: 5, compatibilityLevel: 170 });
        const first = runtime.snapshot(uri, 1);

        // A later environment result that reports the same engine differently spelled.
        await runtime.setEngineFacts({
            engineEdition: 5,
            compatibilityLevel: 170,
            serverVersion: "12.0.2000.8",
        });
        const second = runtime.snapshot(uri, 1);
        assert.equal(second, first);
    });

    // A failed rebind must not publish new capabilities with old document snapshots.
    test("publishes a profile change atomically", async () => {
        const inner = new CatalogSemanticBinder();
        let failUpdate = false;
        const binder = {
            bind(input) {
                return inner.bind(input);
            },
            update(previous, input) {
                if (failUpdate) throw new Error("deliberate rebind failure");
                return inner.update(previous, input);
            },
        };
        const syntax = new LezerSyntaxService(undefined, {
            engineProfile: "unknown",
            previewFeatures: false,
        });
        const runtime = new InProcessLanguageServiceRuntime(syntax, binder);
        const first = await runtime.open(uri, 1, sql);
        const secondUri = "file:///profile-runtime-2.sql";
        const second = await runtime.open(secondUri, 1, "SELECT 1;");

        failUpdate = true;
        await assert.rejects(
            runtime.setEngineFacts({ engineEdition: 5, compatibilityLevel: 170 }),
            /deliberate rebind failure/u,
        );

        assert.equal(runtime.capabilities.engineProfile, "unknown");
        assert.equal(runtime.snapshot(uri, 1), first);
        assert.equal(runtime.snapshot(secondUri, 1), second);
        assert.equal(syntax.profile.engineProfile, "unknown");
    });

    // Verifies the support view can name the engine that produced a visible result.
    test("stats identify the profile and generation behind the result", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, { engineProfile: "unknown", previewFeatures: false }),
        );
        await runtime.open(uri, 1, sql);
        await runtime.setEngineFacts({
            engineEdition: 11,
            serverName: "ws.datawarehouse.fabric.microsoft.com",
        });

        const stats = runtime.getStats(uri);
        assert.equal(stats.engine.profile, "fabric-warehouse");
        assert.equal(stats.engine.generation, "fabric-warehouse/16/160/ga");
        assert.equal(stats.engine.source, "engineEditionAndServerName");
        assert.equal(stats.engine.displayName, "Fabric Data Warehouse (compatibility level 160)");
        assert.equal(stats.engine.capabilities.serverScopedObjects, "unavailable");
        // The engine section carries no server or database name.
        assert.ok(!JSON.stringify(stats.engine).includes("datawarehouse.fabric"));
    });
});
