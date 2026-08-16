/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// The analysis profile is the immutable per-operation setting that decides which T-SQL a document
// may contain. It has to behave identically wherever it is accepted, so one contract suite covers
// the resolver, the direct binder input, and the runtime that pins it for a document's lifetime.
const {
    analysisProfileKey,
    CatalogSemanticBinder,
    defaultAnalysisProfile,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    resolveAnalysisProfile,
} = require("../../dist/index.js");

function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
    });
}

/** Every seam that accepts a profile must agree on defaults, immutability, and identity. */
function assertProfileContract(resolve) {
    assert.deepEqual(resolve(undefined), { deploymentMode: "interactive" });
    assert.deepEqual(resolve({}), { deploymentMode: "interactive" });
    assert.deepEqual(resolve({ deploymentMode: "build" }), { deploymentMode: "build" });
    // An unrecognized host value must not silently enable build-only diagnostics.
    assert.deepEqual(resolve({ deploymentMode: "dacpac" }), { deploymentMode: "interactive" });
    assert.equal(Object.isFrozen(resolve({ deploymentMode: "build" })), true);
}

suite("T-SQL analysis profile contract", () => {
    // The resolver is the single normalization point every consumer shares.
    test("resolves, freezes, and rejects unknown deployment modes", () => {
        assertProfileContract(resolveAnalysisProfile);
        assert.equal(Object.isFrozen(defaultAnalysisProfile), true);
        assert.equal(defaultAnalysisProfile.deploymentMode, "interactive");
    });

    // The runtime pins one profile for a document's lifetime rather than reading it per request.
    test("pins the resolved profile on the in-process runtime", () => {
        assertProfileContract(
            (profile) =>
                new InProcessLanguageServiceRuntime(
                    new LezerSyntaxService(),
                    new CatalogSemanticBinder(),
                    metadata(),
                    profile,
                ).profile,
        );
    });

    // Distinct profiles must have distinct identities so a reuse key can never merge them.
    test("gives each deployment mode a distinct stable key", () => {
        assert.equal(analysisProfileKey(), analysisProfileKey(defaultAnalysisProfile));
        assert.notEqual(
            analysisProfileKey({ deploymentMode: "build" }),
            analysisProfileKey({ deploymentMode: "interactive" }),
        );
    });

    // The default must never produce a build diagnostic, and the binder must honour an explicit one.
    test("routes the profile from bind input to the validators", () => {
        const binder = new CatalogSemanticBinder();
        const syntax = new LezerSyntaxService().parse(
            new ImmutableTextSnapshot("file:///profile.sql", 1, "SELECT 1;"),
        );
        const view = metadata().pin();
        assert.deepEqual(binder.bind({ syntax, metadata: view }).diagnostics, []);
        assert.deepEqual(
            binder
                .bind({ syntax, metadata: view, profile: { deploymentMode: "interactive" } })
                .diagnostics.map(({ code }) => code),
            [],
        );
        assert.deepEqual(
            binder
                .bind({ syntax, metadata: view, profile: { deploymentMode: "build" } })
                .diagnostics.map(({ code }) => code),
            ["InvalidBuildModeSqlNullStatement"],
        );
    });

    // A profile change must invalidate incremental reuse instead of replaying the other profile.
    test("keeps incremental reuse separate for each profile", () => {
        const binder = new CatalogSemanticBinder();
        const service = new LezerSyntaxService();
        const view = metadata().pin();
        const first = service.parse(
            new ImmutableTextSnapshot("file:///profile.sql", 1, "SELECT 1;"),
        );
        const interactive = binder.bind({ syntax: first, metadata: view });
        const rebound = binder.update(interactive, {
            syntax: first,
            metadata: view,
            previous: interactive,
            changedRanges: [],
            profile: { deploymentMode: "build" },
        });
        assert.deepEqual(
            rebound.diagnostics.map(({ code }) => code),
            ["InvalidBuildModeSqlNullStatement"],
        );
        assert.equal(rebound.statistics.unitsReused, 0);
    });
});
