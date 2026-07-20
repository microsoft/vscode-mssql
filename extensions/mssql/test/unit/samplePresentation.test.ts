/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createSampleRunSnapshot,
    fetchSampleOutputPage,
    isSampleHandle,
} from "../../src/runbookStudio/presentation/samplePresentation";
import { RunbookArtifactFile } from "../../src/sharedInterfaces/runbookStudio";

function artifact(): RunbookArtifactFile {
    return {
        schemaVersion: 1,
        id: "sample-runbook",
        name: "Sample runbook",
        source: { schemaVersion: 1, intent: "preview", parameters: [] },
        lock: {
            schemaVersion: 1,
            planRevision: "4",
            planHash: "sha256:sample",
            entryNodeId: "query",
            nodes: [
                {
                    id: "query",
                    kind: "activity",
                    label: "Query",
                    activityKind: "sql.query.read",
                    activityVersion: 1,
                    inputs: {},
                },
                { id: "gate", kind: "gate", label: "Approve" },
                {
                    id: "report",
                    kind: "report",
                    label: "Report",
                    activityKind: "report.markdown",
                    activityVersion: 1,
                    inputs: {},
                },
            ],
            edges: [
                { from: "query", to: "gate" },
                { from: "gate", to: "report" },
            ],
        },
    };
}

suite("samplePresentation", () => {
    test("creates effect-free typed sample handles only for output nodes", () => {
        const snapshot = createSampleRunSnapshot(artifact());
        expect(snapshot).to.deep.include({
            runId: "sample-preview-clean",
            runbookId: "sample-runbook",
            planRevision: "4",
            state: "succeeded",
        });
        expect(snapshot?.nodes[0].outputs?.[0]).to.deep.include({
            slot: "primary",
            contract: "rowset/1",
            rows: 3,
        });
        expect(isSampleHandle(snapshot?.nodes[0].outputs?.[0].handleId ?? "")).to.equal(true);
        expect(snapshot?.nodes[1].outputs).to.equal(undefined);
    });

    test("models blocking and rejected branches without inventing output handles", () => {
        const blocking = createSampleRunSnapshot(artifact(), "blockingErrors")!;
        expect(blocking.state).to.equal("failed");
        expect(blocking.nodes[0].state).to.equal("failed");
        expect(blocking.nodes.slice(1).every((node) => node.branchNotTaken === true)).to.equal(
            true,
        );
        expect(blocking.nodes.slice(1).some((node) => node.outputs !== undefined)).to.equal(false);

        const rejected = createSampleRunSnapshot(artifact(), "approvalRejected")!;
        expect(rejected.nodes[0].state).to.equal("succeeded");
        expect(rejected.nodes[1]).to.deep.include({
            state: "failed",
            outcome: "policyDenied",
        });
        expect(rejected.nodes[2]).to.deep.include({
            state: "skipped",
            branchNotTaken: true,
        });
    });

    test("serves bounded deterministic pages and refuses ordinary handles", () => {
        const handleId = createSampleRunSnapshot(artifact())!.nodes[0].outputs![0].handleId;
        const page = fetchSampleOutputPage({ handleId, startRow: 1, rowCount: 1 });
        expect(page?.columns).to.deep.equal(["Item", "Value", "ObservedAt"]);
        expect(page?.rows).to.deep.equal([["Customers", 5000, "2026-07-18T09:00:00Z"]]);
        expect(page?.totalRows).to.equal(3);
        expect(
            fetchSampleOutputPage({ handleId: "real-result", startRow: 0, rowCount: 10 }),
        ).to.equal(undefined);
    });
});
