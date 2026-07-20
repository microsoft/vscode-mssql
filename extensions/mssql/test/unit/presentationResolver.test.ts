/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure presentation resolution (RBS2-9 keystone): determinism, total layout
 * (explicit pending/noOutput/expired/sourceMissing states), derived default
 * layout, drift fallback with the pin preserved, and definition validation
 * degrading to derived rather than blanking the surface.
 */

import { expect } from "chai";
import {
    compatibleViews,
    pinnedViewsOf,
    resolvePresentation,
    upsertOutputPin,
    validatePresentationDefinition,
} from "../../src/runbookStudio/presentation/presentationResolver";
import {
    PresentationDefinition,
    PRESENTATION_SCHEMA_VERSION,
    expectedContractFor,
    viewCandidateTier,
} from "../../src/sharedInterfaces/runbookPresentation";
import { RunbookRunSnapshot } from "../../src/sharedInterfaces/runbookStudio";

function snapshot(): RunbookRunSnapshot {
    return {
        runId: "run_1",
        runbookId: "rb",
        planRevision: "1",
        planHash: "sha256:x",
        state: "succeeded",
        seq: 9,
        nodes: [
            {
                nodeId: "query",
                state: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "h1", contract: "rowset/1", rows: 5 }],
            },
            {
                nodeId: "threshold",
                state: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "h2", contract: "scalarSet/1" }],
            },
            { nodeId: "report", state: "running", attempt: 1 },
        ],
    };
}

function definition(): PresentationDefinition {
    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: 3,
        sections: [
            {
                id: "main",
                title: "Main",
                widgets: [
                    { id: "w1", source: { nodeId: "query" }, view: "grid" },
                    {
                        id: "w2",
                        source: { nodeId: "threshold" },
                        view: "scalar-cards",
                        pinnedByUser: true,
                    },
                    { id: "w3", source: { nodeId: "report" }, view: "markdown" },
                    { id: "w4", source: { nodeId: "gone" }, view: "grid" },
                ],
            },
        ],
    };
}

suite("presentationResolver", () => {
    test("rowset candidates expose both shipped chart renderers", () => {
        expect(compatibleViews("rowset/1")).to.deep.equal(["grid", "bar", "timeseries", "json"]);
        expect(viewCandidateTier("rowset/1", "grid")).to.equal("recommended");
        expect(viewCandidateTier("rowset/1", "bar")).to.equal("available");
        expect(viewCandidateTier("rowset/1", "json")).to.equal("fallback");
        expect(viewCandidateTier("unknown/1", "json")).to.equal("recommended");
    });

    test("developer evidence contracts have implemented default presentations", () => {
        for (const [activityKind, contract] of [
            ["workspace.inspect", "workspaceSnapshot/1"],
            ["dacpac.build", "dacpacArtifact/1"],
            ["sandbox.provision", "databaseLease/1"],
            ["dacpac.deploy", "deploymentEvidence/1"],
            ["sandbox.dispose", "cleanupEvidence/1"],
        ] as const) {
            expect(expectedContractFor("activity", activityKind)).to.equal(contract);
            expect(compatibleViews(contract)).to.deep.equal(["scalar-cards", "json"]);
        }
        expect(expectedContractFor("activity", "dacpac.deploy.preview")).to.equal(
            "deploymentPreview/1",
        );
        expect(compatibleViews("deploymentPreview/1")).to.deep.equal(["log-view", "json"]);
        expect(expectedContractFor("activity", "schema.compare")).to.equal("schemaDiff/1");
        expect(compatibleViews("schemaDiff/1")).to.deep.equal(["log-view", "json"]);
        expect(expectedContractFor("activity", "sqltest.discover")).to.equal(
            "testSuiteDiscovery/1",
        );
        expect(compatibleViews("testSuiteDiscovery/1")).to.deep.equal(["grid", "json"]);
        expect(expectedContractFor("activity", "sqltest.run")).to.equal("testResults/1");
        expect(expectedContractFor("activity", "tsqlt.run")).to.equal("testResults/1");
        expect(compatibleViews("testResults/1")).to.deep.equal(["grid", "bar", "json"]);
        expect(expectedContractFor("activity", "evidence.bundle")).to.equal("evidenceBundle/1");
        expect(compatibleViews("evidenceBundle/1")).to.deep.equal(["log-view", "json"]);
    });

    test("resolution is deterministic", () => {
        const a = resolvePresentation(definition(), snapshot());
        const b = resolvePresentation(definition(), snapshot());
        expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
    });

    test("total layout: every widget resolves to an explicit state", () => {
        const resolved = resolvePresentation(definition(), snapshot());
        const widgets = resolved.sections[0].widgets;
        expect(widgets.map((w) => w.state)).to.deep.equal([
            "ready", // query rowset
            "ready", // threshold scalars
            "pending", // report still running, no output yet
            "sourceMissing", // node 'gone' not in the plan
        ]);
        expect(resolved.revision).to.equal(3);
        expect(resolved.derived).to.equal(false);
    });

    test("noOutput when a terminal node produced nothing", () => {
        const snap = snapshot();
        snap.nodes[2] = { nodeId: "report", state: "succeeded", attempt: 1 };
        const resolved = resolvePresentation(definition(), snap);
        expect(resolved.sections[0].widgets[2].state).to.equal("noOutput");
    });

    test("expired handles render as expired, keeping identity", () => {
        const snap = snapshot();
        snap.nodes[0].outputs = [{ handleId: "h1", contract: "rowset/1", expired: true }];
        const resolved = resolvePresentation(definition(), snap);
        const widget = resolved.sections[0].widgets[0];
        expect(widget.state).to.equal("expired");
        expect(widget.handleId).to.equal("h1");
    });

    test("drift: incompatible pinned view degrades visibly to the contract default", () => {
        const def = definition();
        // Pin the threshold widget to a view its scalarSet contract does not support.
        def.sections[0].widgets[1].view = "er-diagram";
        const resolved = resolvePresentation(def, snapshot());
        const widget = resolved.sections[0].widgets[1];
        expect(widget.state).to.equal("ready");
        expect(widget.view).to.equal("scalar-cards");
        expect(widget.drift?.requestedView).to.equal("er-diagram");
    });

    test("no definition derives one section per node with outputs", () => {
        const resolved = resolvePresentation(undefined, snapshot());
        expect(resolved.derived).to.equal(true);
        expect(resolved.revision).to.equal(0);
        expect(resolved.sections.map((s) => s.id)).to.deep.equal(["node:query", "node:threshold"]);
        expect(resolved.sections[0].widgets[0].view).to.equal("grid");
        expect(resolved.sections[1].widgets[0].view).to.equal("scalar-cards");
    });

    test("validatePresentationDefinition refuses malformed/duplicate/newer input", () => {
        expect(validatePresentationDefinition(undefined)).to.equal(undefined);
        expect(validatePresentationDefinition("nope")).to.equal(undefined);
        expect(
            validatePresentationDefinition({ schemaVersion: 2, revision: 1, sections: [] }),
        ).to.equal(undefined);
        const dupe = definition();
        dupe.sections[0].widgets.push({ ...dupe.sections[0].widgets[0] });
        expect(validatePresentationDefinition(dupe)).to.equal(undefined);
        expect(validatePresentationDefinition(definition())).to.not.equal(undefined);
    });

    test("empty run resolves to an empty derived layout (not a crash)", () => {
        const resolved = resolvePresentation(undefined, undefined);
        expect(resolved.sections).to.deep.equal([]);
        expect(resolved.derived).to.equal(true);
    });

    test("upsertOutputPin creates, re-pins, and clears without touching authored widgets", () => {
        // First pin creates the definition + primary section.
        const pinned = upsertOutputPin(undefined, "query", "bar");
        expect(pinned.revision).to.equal(1);
        expect(pinned.sections[0].id).to.equal("primary");
        expect(pinned.sections[0].widgets[0]).to.deep.include({
            id: "pin-query",
            view: "bar",
            pinnedByUser: true,
        });
        expect(pinnedViewsOf(pinned)).to.deep.equal({ query: "bar" });

        // Re-pin updates in place (no duplicate widget).
        const repinned = upsertOutputPin(pinned, "query", "grid");
        expect(repinned.sections[0].widgets).to.have.length(1);
        expect(pinnedViewsOf(repinned)).to.deep.equal({ query: "grid" });

        // Clearing removes the pin-created widget entirely.
        const cleared = upsertOutputPin(repinned, "query", undefined);
        expect(cleared.sections[0].widgets).to.have.length(0);
        expect(pinnedViewsOf(cleared)).to.deep.equal({});

        // Clearing an AUTHORED widget only unpins it — never deletes layout.
        const authored = upsertOutputPin(undefined, "other", "grid");
        authored.sections[0].widgets[0].id = "hand-made";
        const unpinned = upsertOutputPin(authored, "other", undefined);
        expect(unpinned.sections[0].widgets).to.have.length(1);
        expect(unpinned.sections[0].widgets[0].pinnedByUser).to.equal(false);
    });
});
