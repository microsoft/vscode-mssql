/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    featureAvailability,
    platformFeatures,
} = require("../../dist/index.js");

/** Every level the package models. 180 is the preview level, which nothing defaults to. */
const levels = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];

const profiles = [
    "sql-server",
    "azure-sql-database",
    "azure-sql-managed-instance",
    "azure-synapse-dedicated",
    "fabric-warehouse",
];

const manifest = JSON.parse(
    readFileSync(join(__dirname, "..", "dialect", "manifest", "dialect-scenarios.json"), "utf8"),
);

function profileOf(engineProfile, level) {
    return {
        engineProfile,
        ...(level === undefined
            ? {}
            : { serverMajorVersion: Math.floor(level / 10), compatibilityLevel: level }),
        previewFeatures: true,
    };
}

suite("availability matrix", () => {
    // Rows: every level and every profile. Columns: the one decision each produces. A registry
    // entry that cannot be decided somewhere is a gate nothing can read.
    test("decides every registry feature at every level and profile", () => {
        const answers = new Set(["available", "unavailable", "deferred"]);
        for (const feature of platformFeatures) {
            for (const engineProfile of profiles) {
                for (const level of levels) {
                    const decision = featureAvailability(feature, profileOf(engineProfile, level));
                    assert.ok(
                        answers.has(decision),
                        `${feature.id} @${engineProfile}/${level} produced ${decision}`,
                    );
                }
            }
        }
    });

    // An unidentified engine defers everything. Inheriting the newest boxed rules would tell an
    // author their valid T-SQL cannot run, on no evidence at all.
    test("defers every decision while the engine is unidentified", () => {
        for (const feature of platformFeatures) {
            assert.equal(
                featureAvailability(feature, profileOf("unknown", undefined)),
                "deferred",
                feature.id,
            );
        }
    });

    // Preview features are a switch, not a version. With the switch off, a preview-only feature is
    // unavailable even on the newest level; with it on, only its version gate remains.
    test("separates the preview switch from the version gate", () => {
        for (const feature of platformFeatures.filter((entry) => entry.requiresPreview === true)) {
            assert.equal(
                featureAvailability(feature, {
                    engineProfile: "sql-server",
                    serverMajorVersion: 18,
                    compatibilityLevel: 180,
                    previewFeatures: false,
                }),
                "unavailable",
                feature.id,
            );
        }
    });

    // A gate nothing exercises proves nothing. Every registry feature needs a scenario at a level
    // that accepts it and one at a level or profile that reports it; this fails when a new feature
    // is added to the registry without both.
    test("exercises every registry feature in both directions", () => {
        const accepted = new Set();
        const reported = new Set();
        for (const scenario of manifest.scenarios) {
            if (scenario.classification === "unsupportedProfile") {
                for (const id of scenario.expectFeatures ?? []) reported.add(id);
            }
            if (scenario.classification !== "valid") continue;
            for (const node of scenario.expectNodes ?? []) {
                for (const feature of platformFeatures) {
                    if (feature.nodes.includes(node)) accepted.add(feature.id);
                }
            }
        }
        assert.deepEqual(
            platformFeatures.filter((feature) => !accepted.has(feature.id)).map(({ id }) => id),
            [],
            "features with no scenario that accepts them",
        );
        assert.deepEqual(
            platformFeatures.filter((feature) => !reported.has(feature.id)).map(({ id }) => id),
            [],
            "features with no scenario that reports them",
        );
    });

    // The property the whole layer exists for: an unavailable construct is still parsed. A profile
    // must produce an availability decision, never a recovery node, because recovery would report
    // valid T-SQL as a syntax error on the wrong engine.
    test("never turns a profile restriction into recovery", () => {
        const gated = manifest.scenarios.filter(
            (scenario) => scenario.classification === "unsupportedProfile",
        );
        assert.ok(gated.length > 0);
        for (const scenario of gated) {
            const service = new LezerSyntaxService(undefined, {
                engineProfile: scenario.profile,
                ...(scenario.serverMajorVersion === undefined
                    ? {}
                    : { serverMajorVersion: scenario.serverMajorVersion }),
                ...(scenario.compatibilityLevel === undefined
                    ? {}
                    : { compatibilityLevel: scenario.compatibilityLevel }),
                previewFeatures: true,
            });
            const { ImmutableTextSnapshot } = require("../../dist/index.js");
            const snapshot = service.parse(
                new ImmutableTextSnapshot("file:///gate.sql", 1, scenario.sql),
            );
            assert.equal(snapshot.statistics.rawErrorNodeCount, 0, scenario.id);
        }
    });
});

suite("availability across feature projections", () => {
    const uri = "file:///projections.sql";

    async function open(sql, level) {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            schemas: [{ database: "db", name: "dbo" }],
            databases: [{ name: "db" }],
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, {
                engineProfile: "sql-server",
                serverMajorVersion: Math.floor(level / 10),
                compatibilityLevel: level,
                previewFeatures: true,
            }),
            new CatalogSemanticBinder(),
            provider,
        );
        const snapshot = await runtime.open(uri, 1, sql);
        return {
            snapshot,
            provider,
            features: new TsqlLanguageFeatureService(runtime, provider),
            coloring: new TsqlColorizationService(),
        };
    }

    // Completion, signature help, and hover each answer for a gated routine only where it runs.
    // One decision, four projections that agree with it.
    test("hides a gated routine from completion and signature help below its level", async () => {
        const call = "SELECT JSON_ARRAY(1, 2);";

        const available = await open("SELECT JSON_", 170);
        const offered = available.features
            .completion(uri, 1, "SELECT JSON_".length)
            .items.map(({ label }) => label);
        assert.ok(offered.includes("JSON_ARRAY"), "offered where the engine runs it");

        const gated = await open("SELECT JSON_", 150);
        assert.ok(
            !gated.features
                .completion(uri, 1, "SELECT JSON_".length)
                .items.some(({ label }) => label === "JSON_ARRAY"),
            "withheld where the engine cannot run it",
        );

        const helpAvailable = await open(call, 170);
        assert.ok(helpAvailable.features.signatureHelp(uri, 1, call.indexOf("1, 2")));
        const helpGated = await open(call, 150);
        assert.equal(helpGated.features.signatureHelp(uri, 1, call.indexOf("1, 2")), undefined);
    });

    // A name the registry describes is offered once. It used to arrive from the routine list and
    // the platform keyword list both, so the same word appeared twice with different detail.
    test("offers a gated routine name exactly once", async () => {
        const { features } = await open("SELECT JSON_", 170);
        const offered = features
            .completion(uri, 1, "SELECT JSON_".length)
            .items.map(({ label }) => label)
            .filter((label) => label.toUpperCase().startsWith("JSON_"));
        assert.deepEqual(
            offered.filter((label, index) => offered.indexOf(label) !== index),
            [],
            "no completion label is offered twice",
        );
    });

    // Coloring marks what the engine cannot run, reading the published decision rather than
    // reapplying a version rule of its own.
    test("marks an unavailable construct in the colour result", async () => {
        const sql = "BACKUP DATABASE db TO DISK = 'db.bak';";
        const gated = await open(sql, 170);
        // Azure SQL Database is the profile that cannot run BACKUP; 170 alone can.
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, {
                engineProfile: "azure-sql-database",
                serverMajorVersion: 17,
                compatibilityLevel: 170,
                previewFeatures: true,
            }),
            new CatalogSemanticBinder(),
            provider,
        );
        const snapshot = await runtime.open(uri, 1, sql);
        const decisions = snapshot.semantics.model.availability.filter(
            (decision) => decision.status === "unavailable",
        );
        assert.ok(decisions.length > 0, "the profile cannot run this statement");

        const tokens = gated.coloring.provideDocumentColors(snapshot).tokens;
        const marked = tokens.filter((token) => token.modifiers.includes("deprecated"));
        assert.ok(marked.length > 0, "the colour result marks it");
        for (const token of marked) {
            assert.ok(
                decisions.some(
                    (decision) =>
                        token.start >= decision.range.start && token.end <= decision.range.end,
                ),
                "every mark sits inside a decision's range",
            );
        }
    });

    // Hover explains the restriction the document already contains, from the same decision.
    test("explains an unavailable construct in hover", async () => {
        const sql = "BACKUP DATABASE db TO DISK = 'db.bak';";
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, {
                engineProfile: "azure-sql-database",
                serverMajorVersion: 17,
                compatibilityLevel: 170,
                previewFeatures: true,
            }),
            new CatalogSemanticBinder(),
            provider,
        );
        await runtime.open(uri, 1, sql);
        const features = new TsqlLanguageFeatureService(runtime, provider);
        const hover = features.hover(uri, 1, 2);
        assert.ok(hover, "hover answers where the construct is unavailable");
        assert.match(hover.markdown, /not available/iu);
    });
});

suite("availability decisions in the semantic model", () => {
    async function decisionsFor(sql, level) {
        const provider = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, {
                engineProfile: "sql-server",
                serverMajorVersion: Math.floor(level / 10),
                compatibilityLevel: level,
                previewFeatures: true,
            }),
            new CatalogSemanticBinder(),
            provider,
        );
        const snapshot = await runtime.open("file:///decision.sql", 1, sql);
        return snapshot.semantics.model.availability;
    }

    // A construct the grammar also accepts as an ordinary call still has to be gated. `JSON_ARRAY`
    // is only distinguishable from a plain `NAME(args)` call by a trailing clause, so a decision
    // keyed solely on the node kind let the plain form escape its gate entirely.
    test("gates a built-in the grammar parsed as an ordinary call", async () => {
        for (const [sql, feature] of [
            ["SELECT JSON_ARRAY(1, 2);", "expression.json-array"],
            ["SELECT JSON_OBJECT();", "expression.json-object"],
            ["SELECT JSON_ARRAYAGG(Name) FROM dbo.t;", "expression.json-arrayagg"],
        ]) {
            assert.deepEqual(
                (await decisionsFor(sql, 150)).map(({ featureId, status }) => ({
                    featureId,
                    status,
                })),
                [{ featureId: feature, status: "unavailable" }],
                sql,
            );
            assert.deepEqual(
                (await decisionsFor(sql, 170)).map(({ status }) => status),
                ["available"],
                sql,
            );
        }
    });

    // One node, one decision: the same construct must not be reported twice because two paths
    // recognised it.
    test("produces one decision per gated construct", async () => {
        const decisions = await decisionsFor("SELECT JSON_OBJECT('id': 1);", 150);
        assert.deepEqual(
            decisions.map(({ featureId }) => featureId),
            ["expression.json-object"],
        );
    });
});
