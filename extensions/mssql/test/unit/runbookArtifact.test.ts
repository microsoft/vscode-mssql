/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook artifact contract tests (RBS2-2): parse/validate failures carry
 * stable error identities, newer schema versions refuse rather than munge,
 * canonical serialization is key-order independent, and the content hash
 * covers source+lock but never presentation.
 */

import { expect } from "chai";
import {
    ArtifactParseResult,
    canonicalizeRunbookArtifact,
    computeContentHash,
    createFixtureRunbookArtifact,
    createNewRunbookArtifact,
    deriveRunbookName,
    isArtifactParseFailure,
    parseRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { RunbookArtifactFile } from "../../src/sharedInterfaces/runbookStudio";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import {
    classifyRunbookIntent,
    prepareRunbookIntent,
} from "../../src/runbookStudio/capabilities/runbookCapabilities";
import { validateLockAgainstCatalog } from "../../src/runbookStudio/activities/activityCatalog";

function fixtureText(): string {
    return canonicalizeRunbookArtifact(createFixtureRunbookArtifact());
}

function expectFailure(result: ArtifactParseResult) {
    if (!isArtifactParseFailure(result)) {
        throw new Error("expected parse failure");
    }
    return result;
}

function expectSuccess(result: ArtifactParseResult): RunbookArtifactFile {
    if (isArtifactParseFailure(result)) {
        throw new Error(`expected parse success, got ${result.code}: ${result.detail}`);
    }
    return result.artifact;
}

suite("runbookArtifact", () => {
    suite("parseRunbookArtifact", () => {
        test("accepts the deterministic fixture", () => {
            const artifact = expectSuccess(parseRunbookArtifact(fixtureText()));
            expect(artifact.id).to.equal("fixture-readonly-check");
            expect(artifact.lock?.nodes).to.have.length(3);
        });

        test("keeps the deterministic fixture executable under catalog admission", () => {
            const artifact = createFixtureRunbookArtifact();
            expect(validateLockAgainstCatalog(artifact.lock!)).to.deep.equal([]);
        });

        test("accepts the deterministic developer validation preview", () => {
            const artifact = createDeveloperValidationPreviewArtifact();
            const parsed = expectSuccess(
                parseRunbookArtifact(canonicalizeRunbookArtifact(artifact)),
            );
            expect(parsed.family).to.equal("validate");
            expect(
                parsed.lock?.nodes.find((node) => node.id === "preview-deploy")?.target,
            ).to.deep.equal({
                kind: "sqlDatabase",
                binding: {
                    source: "nodeOutput",
                    nodeId: "provision-sandbox",
                    output: "connectionRef",
                },
            });
        });

        test("accepts a fresh template (no lock)", () => {
            const template = createNewRunbookArtifact("My runbook", "runbook-x");
            const artifact = expectSuccess(
                parseRunbookArtifact(canonicalizeRunbookArtifact(template)),
            );
            expect(artifact.lock).to.equal(undefined);
        });

        test("rejects non-JSON with InvalidArtifact", () => {
            const failure = expectFailure(parseRunbookArtifact("SELECT 1"));
            expect(failure.code).to.equal("RunbookStudio.InvalidArtifact");
        });

        test("refuses newer artifact schema with IncompatibleVersion", () => {
            const artifact = createFixtureRunbookArtifact() as unknown as Record<string, unknown>;
            artifact.schemaVersion = 99;
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.code).to.equal("RunbookStudio.IncompatibleVersion");
        });

        test("refuses newer lock schema with IncompatibleVersion", () => {
            const artifact = createFixtureRunbookArtifact();
            (artifact.lock as unknown as Record<string, unknown>).schemaVersion = 2;
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.code).to.equal("RunbookStudio.IncompatibleVersion");
        });

        test("rejects duplicate node ids", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.lock!.nodes.push({ ...artifact.lock!.nodes[0] });
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.detail).to.contain("duplicate node id");
        });

        test("rejects dangling edges", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.lock!.edges.push({ from: "query", to: "missing-node" });
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.detail).to.contain("unknown node");
        });

        test("rejects an entry node that does not exist", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.lock!.entryNodeId = "nope";
            expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
        });

        test("rejects a secret parameter that declares a default", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.source.parameters.push({
                id: "token",
                label: "Token",
                type: "secret",
                default: "hunter2",
            });
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.detail).to.contain("secret");
        });

        test("rejects duplicate parameter ids", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.source.parameters.push({ ...artifact.source.parameters[0] });
            expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
        });

        test("rejects an activity node without activityKind", () => {
            const artifact = createFixtureRunbookArtifact();
            delete (artifact.lock!.nodes[0] as unknown as Record<string, unknown>).activityKind;
            expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
        });

        test("round-trips an explicit typed activity target", () => {
            const artifact = expectSuccess(parseRunbookArtifact(fixtureText()));
            expect(artifact.lock?.nodes[0].target).to.deep.equal({
                kind: "sqlDatabase",
                binding: { source: "parameter", parameterId: "target" },
            });
        });

        test("round-trips bounded runtime control-flow semantics and edge labels", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.lock!.libraryAssetRef = { assetId: "runtime-plan" };
            artifact.lock!.nodes[0].runtime = {
                nodeType: "Decision",
                role: "decision",
                description: "Choose the next check from measured evidence.",
                decision: {
                    branches: [
                        {
                            branchKey: "continue",
                            label: "Continue",
                            targetNodeIds: [artifact.lock!.nodes[1].id],
                            expression: "rowCount > 0",
                        },
                    ],
                    defaultTargetNodeId: artifact.lock!.nodes[2].id,
                },
            };
            artifact.lock!.edges[0].label = "Continue";
            const parsed = expectSuccess(
                parseRunbookArtifact(canonicalizeRunbookArtifact(artifact)),
            );
            expect(parsed.lock?.nodes[0].runtime).to.deep.equal(artifact.lock!.nodes[0].runtime);
            expect(parsed.lock?.edges[0].label).to.equal("Continue");
        });

        test("rejects malformed or dangling runtime control-flow semantics", () => {
            const malformed = createFixtureRunbookArtifact();
            (malformed.lock!.nodes[0] as unknown as Record<string, unknown>).runtime = {
                nodeType: "Decision",
                decision: { branches: [{ label: "Broken", targetNodeIds: [] }] },
            };
            expect(
                expectFailure(parseRunbookArtifact(JSON.stringify(malformed))).detail,
            ).to.contain("runtime decision branch invalid");

            const dangling = createFixtureRunbookArtifact();
            dangling.lock!.libraryAssetRef = { assetId: "runtime-plan" };
            dangling.lock!.nodes[0].runtime = {
                nodeType: "Parallel",
                parallel: { branchNodeIds: ["missing-node"] },
            };
            expect(expectFailure(parseRunbookArtifact(JSON.stringify(dangling))).detail).to.contain(
                "runtime semantics reference unknown node",
            );
        });

        test("requires an explicit runtime-library authority for runtime semantics", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.lock!.nodes[0].runtime = { nodeType: "Observation" };
            expect(expectFailure(parseRunbookArtifact(JSON.stringify(artifact))).detail).to.contain(
                "require a libraryAssetRef",
            );

            artifact.lock!.libraryAssetRef = { assetId: "" };
            expect(expectFailure(parseRunbookArtifact(JSON.stringify(artifact))).detail).to.contain(
                "libraryAssetRef invalid",
            );
        });

        test("rejects malformed target bindings", () => {
            const artifact = createFixtureRunbookArtifact();
            (artifact.lock!.nodes[0].target as unknown as Record<string, unknown>).binding = {
                source: "ambientConnection",
            };
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.detail).to.contain("target binding source invalid");
        });

        test("round-trips a versioned capability and target manifest", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.source.requirements = classifyRunbookIntent(
                "Inspect developer database health",
            ).requirements;
            artifact.source.requirements.activities[0].minimumHostVersion = "1.45.0";
            artifact.source.requirements.activities[0].providerRequirement = "planning";
            const parsed = expectSuccess(
                parseRunbookArtifact(canonicalizeRunbookArtifact(artifact)),
            );
            expect(parsed.source.requirements).to.deep.equal(artifact.source.requirements);
        });

        test("rejects an unknown provider requirement", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.source.requirements = classifyRunbookIntent(
                "Inspect developer database health",
            ).requirements;
            (
                artifact.source.requirements.activities[0] as unknown as Record<string, unknown>
            ).providerRequirement = "ambient";
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.detail).to.contain("invalid metadata");
        });

        test("refuses a newer requirements schema with IncompatibleVersion", () => {
            const artifact = createFixtureRunbookArtifact();
            artifact.source.requirements = classifyRunbookIntent(
                "Inspect developer database health",
            ).requirements;
            (artifact.source.requirements as unknown as Record<string, unknown>).schemaVersion = 2;
            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.code).to.equal("RunbookStudio.IncompatibleVersion");
        });

        test("round-trips a design-only plan without an executable lock", () => {
            const artifact = prepareRunbookIntent(
                createFixtureRunbookArtifact(),
                "Create a database project, build a DACPAC, deploy to a sandbox, and verify schema drift.",
            ).artifact;
            const parsed = expectSuccess(
                parseRunbookArtifact(canonicalizeRunbookArtifact(artifact)),
            );

            expect(parsed.lock).to.equal(undefined);
            expect(parsed.source.design).to.deep.equal(artifact.source.design);
            expect(parsed.source.design?.steps.map((step) => step.activityKind)).to.not.include(
                "sql.query.read",
            );
        });

        test("round-trips the composed family", () => {
            const artifact = prepareRunbookIntent(
                createFixtureRunbookArtifact(),
                "Create a database project, then run SQL tests and investigate blocking.",
            ).artifact;
            expect(artifact.family).to.equal("composed");
            expect(
                expectSuccess(parseRunbookArtifact(canonicalizeRunbookArtifact(artifact))).family,
            ).to.equal("composed");
        });

        test("refuses a design outline alongside an executable lock", () => {
            const executable = createFixtureRunbookArtifact();
            const designOnly = prepareRunbookIntent(
                executable,
                "Create a database project and build a DACPAC.",
            ).artifact;
            designOnly.lock = executable.lock;

            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(designOnly)));
            expect(failure.detail).to.contain("must not contain a lock");
        });

        test("refuses design steps that do not cover the requirement manifest", () => {
            const artifact = prepareRunbookIntent(
                createFixtureRunbookArtifact(),
                "Create a database project and build a DACPAC.",
            ).artifact;
            artifact.source.design!.steps.pop();

            const failure = expectFailure(parseRunbookArtifact(JSON.stringify(artifact)));
            expect(failure.detail).to.contain("does not cover requirements");
        });
    });

    suite("canonicalization and hashing", () => {
        test("canonical form is independent of input key order", () => {
            const artifact = createFixtureRunbookArtifact();
            // Same semantic artifact, authored with keys in reversed order.
            const reversed = JSON.parse(fixtureText(), function reviver(_key, value) {
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    const flipped: Record<string, unknown> = {};
                    for (const k of Object.keys(value).reverse()) {
                        flipped[k] = (value as Record<string, unknown>)[k];
                    }
                    return flipped;
                }
                return value;
            }) as RunbookArtifactFile;
            expect(canonicalizeRunbookArtifact(reversed)).to.equal(
                canonicalizeRunbookArtifact(artifact),
            );
        });

        test("canonical text ends with exactly one newline and uses LF", () => {
            const text = canonicalizeRunbookArtifact(createFixtureRunbookArtifact());
            expect(text.endsWith("\n")).to.equal(true);
            expect(text.endsWith("\n\n")).to.equal(false);
            expect(text.includes("\r")).to.equal(false);
        });

        test("content hash is stable across presentation changes", () => {
            const artifact = createFixtureRunbookArtifact();
            const before = computeContentHash(artifact);
            artifact.presentation = { layout: "wide", widgets: [] };
            const after = computeContentHash(artifact);
            expect(after).to.equal(before);
        });

        test("content hash changes when the source changes", () => {
            const artifact = createFixtureRunbookArtifact();
            const before = computeContentHash(artifact);
            artifact.source.intent = "something else";
            expect(computeContentHash(artifact)).to.not.equal(before);
        });

        test("content hash changes when the lock changes", () => {
            const artifact = createFixtureRunbookArtifact();
            const before = computeContentHash(artifact);
            artifact.lock!.nodes[0].label = "renamed";
            expect(computeContentHash(artifact)).to.not.equal(before);
        });

        test("fixture planHash is reproducible", () => {
            const a = createFixtureRunbookArtifact();
            const b = createFixtureRunbookArtifact();
            expect(a.lock!.planHash).to.equal(b.lock!.planHash);
            expect(a.lock!.planHash).to.match(/^sha256:[0-9a-f]{64}$/);
        });
    });

    suite("deriveRunbookName", () => {
        test("first sentence, capitalized, punctuation stripped", () => {
            expect(deriveRunbookName("why is CPU high on my server?")).to.equal(
                "Why is CPU high on my server",
            );
            expect(deriveRunbookName("check blocking. then plans.")).to.equal("Check blocking");
        });
        test("caps at a word boundary under 60 chars", () => {
            const long =
                "find every query that regressed in the last week and compare their plans against the baseline";
            const name = deriveRunbookName(long);
            expect(name.length).to.be.at.most(60);
            expect(name.endsWith(" ")).to.equal(false);
            expect(long.startsWith(name.charAt(0).toLowerCase() + name.slice(1))).to.equal(true);
        });
        test("degenerate input still yields a name", () => {
            expect(deriveRunbookName("   ")).to.equal("Runbook");
            expect(deriveRunbookName("?!")).to.equal("Runbook");
        });
    });
});
