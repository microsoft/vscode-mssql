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
            ],
            edges: [{ from: "query", to: "gate" }],
        },
    };
}

suite("samplePresentation", () => {
    test("creates effect-free typed sample handles only for output nodes", () => {
        const snapshot = createSampleRunSnapshot(artifact());
        expect(snapshot).to.deep.include({
            runId: "sample-preview",
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
