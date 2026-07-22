/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RunbookPlanNode, RunbookRunSnapshot } from "../../src/sharedInterfaces/runbookStudio";
import { projectResultArtifacts } from "../../src/webviews/pages/RunbookStudio/resultArtifacts";

function snapshot(nodes: RunbookRunSnapshot["nodes"]): RunbookRunSnapshot {
    return {
        runId: "run-artifacts",
        runbookId: "book-artifacts",
        planRevision: "1",
        planHash: "hash",
        state: "succeeded",
        seq: 1,
        nodes,
    };
}

function planNode(id: string, label: string): RunbookPlanNode {
    const activityKind =
        id === "extract"
            ? "dacpac.extract"
            : id === "compare"
              ? "schema.compare.export"
              : id === "collect"
                ? "xevent.xel.collect"
                : id === "git"
                  ? "git.change-set.inspect"
                  : "test.activity";
    return { id, label, kind: "activity", activityKind, activityVersion: 1 };
}

suite("resultArtifacts", () => {
    test("projects only supported file contracts with producer labels and honest states", () => {
        const result = projectResultArtifacts(
            snapshot([
                {
                    nodeId: "extract",
                    state: "succeeded",
                    attempt: 1,
                    outputs: [
                        { handleId: "dacpac", contract: "dacpacArtifact/1" },
                        { handleId: "rows", contract: "rowset/1" },
                    ],
                },
                {
                    nodeId: "compare",
                    state: "succeeded",
                    attempt: 1,
                    outputs: [
                        {
                            handleId: "diff",
                            contract: "schemaDiff/1",
                            truncated: true,
                        },
                    ],
                },
                {
                    nodeId: "collect",
                    state: "succeeded",
                    attempt: 1,
                    outputs: [
                        { handleId: "xel", contract: "xelArtifact/1", expired: true },
                        { handleId: "dacpac", contract: "dacpacArtifact/1" },
                    ],
                },
                {
                    nodeId: "compare-raw",
                    state: "succeeded",
                    attempt: 1,
                    outputs: [{ handleId: "raw-diff", contract: "schemaDiff/1" }],
                },
            ]),
            [
                planNode("extract", "Extract database"),
                planNode("compare", "Compare schema"),
                planNode("collect", "Collect XEL"),
                planNode("compare-raw", "Check convergence"),
            ],
        );

        expect(result).to.deep.equal({
            artifacts: [
                {
                    handleId: "dacpac",
                    contract: "dacpacArtifact/1",
                    nodeId: "extract",
                    nodeLabel: "Extract database",
                    expired: false,
                    truncated: false,
                },
                {
                    handleId: "diff",
                    contract: "schemaDiff/1",
                    nodeId: "compare",
                    nodeLabel: "Compare schema",
                    expired: false,
                    truncated: true,
                },
                {
                    handleId: "xel",
                    contract: "xelArtifact/1",
                    nodeId: "collect",
                    nodeLabel: "Collect XEL",
                    expired: true,
                    truncated: false,
                },
            ],
            omittedCount: 0,
        });
    });

    test("caps the payload-free shelf and reports omitted unique artifacts", () => {
        const outputs = Array.from({ length: 35 }, (_, index) => ({
            handleId: `artifact-${index}`,
            contract: "xelArtifact/1",
        }));
        const result = projectResultArtifacts(
            snapshot([{ nodeId: "collect", state: "succeeded", attempt: 1, outputs }]),
            [],
        );

        expect(result.artifacts).to.have.length(32);
        expect(result.omittedCount).to.equal(3);
        expect(result.artifacts.map((artifact) => artifact.handleId)).to.deep.equal(
            outputs.slice(0, 32).map((output) => output.handleId),
        );
    });

    test("projects a generated workload only from its registered producer", () => {
        const run = snapshot([
            {
                nodeId: "generate",
                state: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "workload", contract: "workloadArtifact/1" }],
            },
        ]);
        const valid = projectResultArtifacts(run, [
            {
                id: "generate",
                label: "Generate workload",
                kind: "activity",
                activityKind: "sql.workload.generate",
                activityVersion: 1,
            },
        ]);
        expect(valid.artifacts).to.deep.include({
            handleId: "workload",
            contract: "workloadArtifact/1",
            nodeId: "generate",
            nodeLabel: "Generate workload",
            expired: false,
            truncated: false,
        });
        expect(
            projectResultArtifacts(run, [planNode("generate", "Wrong producer")]).artifacts,
        ).to.deep.equal([]);
    });

    test("projects a Git patch only from the registered change-set producer", () => {
        const run = snapshot([
            {
                nodeId: "git",
                state: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "patch", contract: "gitChangeSet/1" }],
            },
        ]);
        expect(
            projectResultArtifacts(run, [planNode("git", "Capture changes")]).artifacts,
        ).to.deep.include({
            handleId: "patch",
            contract: "gitChangeSet/1",
            nodeId: "git",
            nodeLabel: "Capture changes",
            expired: false,
            truncated: false,
        });
    });
});
