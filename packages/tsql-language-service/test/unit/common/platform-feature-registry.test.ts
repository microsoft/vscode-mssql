/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { suite, test } from "node:test";

import {
    featureAvailability,
    featureAvailabilityDetail,
    engineCapabilitySet,
    lookupBuiltIn,
    platformFeatureById,
    platformFeatureForNode,
    platformFeatureNodes,
    platformFeatures,
    resolveTsqlFeatureProfile,
    resolvedSqlEngineProfiles,
    sqlEngineProfiles,
    type PlatformFeature,
    type TsqlFeatureProfile,
} from "../../../src/index.ts";
import { parser } from "../../../src/syntax/lezer/generated/tsqlParser.js";

const sourceRoot = join(__dirname, "..", "..", "..", "src");

function requiredFeature(id: string): PlatformFeature {
    const feature = platformFeatureById(id);
    assert.ok(feature, `${id} must exist in the platform feature registry`);
    return feature;
}

const grammarNodeNames = new Set(parser.nodeSet.types.map((type) => type.name));
const statementFamilies = new Set([
    "database",
    "table",
    "index",
    "view",
    "module",
    "security",
    "external",
    "workload",
    "query",
    "dml",
    "expression",
    "type",
    "server",
    "session",
    "backup",
]);

suite("platform feature registry audit", () => {
    // Verifies no entry can be published without the fields the readiness report totals by.
    test("every feature is completely described", () => {
        const identifiers = new Set();
        for (const feature of platformFeatures) {
            assert.match(feature.id, /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u, feature.id);
            assert.ok(!identifiers.has(feature.id), `duplicate feature id ${feature.id}`);
            identifiers.add(feature.id);
            assert.ok(feature.displayName.length > 0, feature.id);
            assert.ok(statementFamilies.has(feature.family), `${feature.id}: ${feature.family}`);
            assert.ok(feature.keyword === undefined || feature.keyword.length > 0, feature.id);
            assert.ok(feature.nodes.length > 0, feature.id);
            assert.ok(
                typeof feature.evidence === "string" && feature.evidence.length > 20,
                `${feature.id} has no reviewable evidence`,
            );
            assert.ok(
                feature.profiles !== undefined ||
                    feature.minimumServer !== undefined ||
                    feature.minimumCompatibility !== undefined ||
                    feature.maximumCompatibility !== undefined ||
                    feature.requiresPreview === true,
                `${feature.id} restricts nothing`,
            );
            for (const profile of feature.profiles ?? []) {
                assert.ok(sqlEngineProfiles.includes(profile), `${feature.id}: ${profile}`);
                assert.notEqual(
                    profile,
                    "unknown",
                    `${feature.id} may not list the unknown profile`,
                );
            }
        }
    });

    // Broad capability summaries and the fine-grained registry must never contradict each other.
    test("table distribution agrees with the coarse capability table", () => {
        const feature = requiredFeature("table.distribution");
        for (const profile of sqlEngineProfiles) {
            const expected: "available" | "unavailable" = feature.profiles?.includes(profile)
                ? "available"
                : "unavailable";
            const actual = engineCapabilitySet({
                engineProfile: profile,
                previewFeatures: false,
            }).tableDistribution;
            assert.equal(actual, profile === "unknown" ? "deferred" : expected, profile);
        }
    });

    // Verifies a renamed or removed grammar node cannot leave a registry entry pointing at nothing.
    test("every gated node exists in the generated parser", () => {
        for (const feature of platformFeatures) {
            for (const node of feature.nodes) {
                assert.ok(
                    grammarNodeNames.has(node),
                    `${feature.id} names grammar node ${node}, which the parser does not define`,
                );
            }
        }
    });

    // Verifies the syntax service reads availability only from the registry, so a platform gate
    // cannot be reintroduced as an ad hoc comparison next to the grammar.
    test("the syntax service holds no private platform table", () => {
        const source = readFileSync(
            join(sourceRoot, "syntax", "lezer", "lezerSyntaxService.ts"),
            "utf8",
        );
        assert.ok(
            !/engineFlavors?\b/u.test(source),
            "a flavor list survived in the syntax service",
        );
        assert.ok(
            !/minimumServer|minimumCompatibility|maximumCompatibility/u.test(source),
            "a version comparison survived in the syntax service",
        );
    });

    // Verifies no layer outside the resolver compares a raw engine-edition number.
    test("only the profile resolver compares engine editions", () => {
        const offenders = [];
        for (const file of sourceFiles(sourceRoot)) {
            if (file.endsWith(join("common", "engineProfile.ts"))) continue;
            const source = readFileSync(file, "utf8");
            if (/engineEdition\s*(?:===|!==|<|>|<=|>=)/u.test(source)) offenders.push(file);
        }
        assert.deepEqual(offenders, []);
    });

    // Verifies a built-in a feature governs actually exists, so hover and completion agree.
    test("every governed built-in exists in the built-in registry", () => {
        for (const feature of platformFeatures) {
            for (const name of feature.builtIns ?? []) {
                assert.ok(lookupBuiltIn(name), `${feature.id} governs unknown built-in ${name}`);
            }
        }
    });

    test("indexes features by grammar node", () => {
        for (const node of platformFeatureNodes) {
            assert.ok(grammarNodeNames.has(node));
        }
        assert.equal(platformFeatureById("statement.backup")?.keyword, "BACKUP");
        assert.equal(platformFeatureById("no.such.feature"), undefined);
    });

    // Verifies the shared availability range is drawn from the node when no keyword is declared.
    test("a feature without a keyword still reports a range", () => {
        const feature = requiredFeature("database.file-definition");
        assert.equal(feature.keyword, undefined);
        const detail = featureAvailabilityDetail(feature, {
            engineProfile: "azure-sql-database",
            serverMajorVersion: 17,
            compatibilityLevel: 170,
            previewFeatures: false,
        });
        assert.ok(detail);
        assert.equal(detail.kind, "profile");
    });

    // Verifies a spelling test picks between features that share one structural node.
    test("selects between spellings that share a node", () => {
        assert.equal(
            platformFeatureForNode("BackupStatement", "BACKUP DATABASE db TO DISK = 'x'")?.id,
            "statement.backup",
        );
        assert.equal(
            platformFeatureForNode("BackupStatement", "DUMP DATABASE db TO DISK = 'x'")?.id,
            "statement.dump",
        );
        assert.equal(platformFeatureForNode("SelectStatement", "SELECT 1"), undefined);
    });
});

suite("platform feature availability", () => {
    // Verifies an unidentified engine never produces a restriction, on any registered feature.
    test("defers every profile decision while the engine is unknown", () => {
        for (const feature of platformFeatures) {
            const profile: TsqlFeatureProfile = {
                engineProfile: "unknown",
                previewFeatures: false,
            };
            const availability = featureAvailability(feature, profile);
            assert.notEqual(availability, "unavailable", feature.id);
            assert.equal(featureAvailabilityDetail(feature, profile), undefined, feature.id);
        }
    });

    // Verifies each profile-restricted feature is available exactly where it says it is.
    test("profile-restricted features agree with their own profile list", () => {
        for (const feature of platformFeatures.filter((entry) => entry.profiles !== undefined)) {
            const governedProfiles = feature.profiles;
            assert.ok(governedProfiles);
            for (const engineProfile of resolvedSqlEngineProfiles) {
                const profile = resolveTsqlFeatureProfile({
                    engineProfile,
                    serverMajorVersion: 17,
                    compatibilityLevel: 170,
                    previewFeatures: false,
                });
                const expected: "available" | "unavailable" = governedProfiles.includes(
                    engineProfile,
                )
                    ? "available"
                    : "unavailable";
                assert.equal(
                    featureAvailability(feature, profile),
                    expected,
                    `${feature.id} on ${engineProfile}`,
                );
            }
        }
    });

    // Verifies a missing level defers rather than restricting.
    test("defers a version gate when the level was never reported", () => {
        const feature = requiredFeature("clause.named-window");
        assert.equal(
            featureAvailability(feature, { engineProfile: "sql-server", previewFeatures: false }),
            "deferred",
        );
        assert.equal(
            featureAvailability(feature, {
                engineProfile: "sql-server",
                serverMajorVersion: 16,
                previewFeatures: false,
            }),
            "deferred",
        );
    });

    // Verifies a removed construct is described as removed, not as requiring a newer engine.
    test("describes removed syntax separately from missing syntax", () => {
        const removed = featureAvailabilityDetail(requiredFeature("statement.dump"), {
            engineProfile: "sql-server",
            serverMajorVersion: 17,
            compatibilityLevel: 170,
            previewFeatures: false,
        });
        assert.ok(removed);
        assert.equal(removed.kind, "removed");
        assert.match(removed.requirement, /removed after database compatibility level 90/u);
    });
});

function* sourceFiles(directory: string): Generator<string> {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "generated") continue;
            yield* sourceFiles(path);
        } else if (entry.name.endsWith(".ts")) {
            yield path;
        }
    }
}
