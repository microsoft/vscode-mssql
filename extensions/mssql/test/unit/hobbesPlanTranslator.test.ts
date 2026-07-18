/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Publish-bridge translation (verified live against runtime 0.1.0): the
 * deterministic subset translates exactly; everything else refuses with
 * precise reasons — never a silent downgrade. Connection registry merges
 * preserve the runtime's case-SENSITIVE PascalCase file shape and never
 * write credentials.
 */

import { expect } from "chai";
import {
    mergeConnectionEntry,
    translateArtifactToHobbesPlan,
} from "../../src/runbookStudio/runtime/hobbesPlanTranslator";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import {
    RunbookArtifactFile,
    RUNBOOK_LOCK_SCHEMA_VERSION,
    RUNBOOK_SOURCE_SCHEMA_VERSION,
} from "../../src/sharedInterfaces/runbookStudio";

function publishableArtifact(): RunbookArtifactFile {
    return {
        schemaVersion: 1,
        id: "pub-test",
        name: "Publish test",
        family: "validate",
        source: {
            schemaVersion: RUNBOOK_SOURCE_SCHEMA_VERSION,
            intent: "Count orders and verify the limit.",
            parameters: [
                { id: "target", label: "Target connection", type: "connection", required: true },
            ],
        },
        lock: {
            schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
            planRevision: "1",
            planHash: "sha256:x",
            entryNodeId: "query",
            nodes: [
                {
                    id: "query",
                    label: "Count orders",
                    kind: "activity",
                    activityKind: "sql.query.read",
                    activityVersion: 1,
                    inputs: {
                        connection: "$params.target",
                        sql: "SELECT COUNT(*) AS n FROM dbo.Orders",
                    },
                },
                {
                    id: "limit",
                    label: "Check limit",
                    kind: "activity",
                    activityKind: "assert.threshold",
                    activityVersion: 1,
                    inputs: { value: 5, max: 100 },
                },
                { id: "report", label: "Summarize", kind: "report" },
            ],
            edges: [
                { from: "query", to: "limit" },
                { from: "limit", to: "report" },
            ],
        },
    };
}

suite("hobbesPlanTranslator", () => {
    test("translates the deterministic subset into the runtime's plan IR", () => {
        const result = translateArtifactToHobbesPlan(publishableArtifact());
        expect(result.issues).to.deep.equal([]);
        const plan = result.plan!;
        expect(plan.entryNodeId).to.equal("query");
        expect(plan.nodes).to.have.length(3);

        const sql = plan.nodes[0];
        expect(sql.strategy).to.equal("primitive:sql.execute-query");
        expect(sql.primitiveArgs).to.deep.equal({
            query: "SELECT COUNT(*) AS n FROM dbo.Orders",
            // Required by the primitive — omitting it fails the region in
            // ~76ms with PrimitiveExecutionException (observed live).
            queryDescription: "Count orders",
        });

        const assert = plan.nodes[1];
        expect(assert.strategy).to.equal("primitive:assert.threshold");
        expect(assert.primitiveArgs?.metric).to.equal(5);
        expect(assert.primitiveArgs?.threshold).to.equal(100);

        // The runtime REQUIRES deterministic reportSections (verified: the
        // AG-UI compile throws without metadata.reportSections).
        const report = plan.nodes[2];
        expect(report.type).to.equal("Report");
        expect(report.metadata?.reportSections?.[0].bodyTemplate).to.be.a("string");

        // The runtime's launch invariant: one required connection input.
        expect(plan.inputSchema).to.deep.equal([
            {
                name: "database",
                kind: "connection",
                cardinality: "one",
                required: true,
                description: "Primary database connection.",
            },
        ]);
        expect(plan.edges.map((e) => `${e.from}>${e.to}`)).to.deep.equal([
            "query>limit",
            "limit>report",
        ]);
    });

    test("substitutes $params thresholds from bound run values", () => {
        const artifact = publishableArtifact();
        artifact.lock!.nodes.find((n) => n.id === "limit")!.inputs = {
            value: 5,
            max: "$params.maxCount",
        };
        const bound = translateArtifactToHobbesPlan(artifact, { maxCount: "25" });
        expect(bound.issues).to.deep.equal([]);
        // String-typed form values coerce to numbers for the primitive.
        expect(bound.plan!.nodes[1].primitiveArgs?.threshold).to.equal(25);

        // Without a bound value there is nothing to substitute — refuse.
        const unbound = translateArtifactToHobbesPlan(artifact);
        expect(unbound.plan).to.equal(undefined);
        expect(unbound.issues.join(" ")).to.contain("parameter 'maxCount' has no bound value");
    });

    test("maps $nodes binds to the runtime's $regions bind grammar", () => {
        const artifact = publishableArtifact();
        artifact.lock!.nodes.find((n) => n.id === "limit")!.inputs = {
            value: "$nodes.query.rowCount",
            max: 100,
        };
        const result = translateArtifactToHobbesPlan(artifact);
        expect(result.issues).to.deep.equal([]);
        // Verified against the runtime's PrimitivePlanSmokeTests: cross-node
        // reads are $regions.<id>.data.<path>.
        expect(result.plan!.nodes[1].primitiveArgs?.metric).to.equal(
            "$regions.query.data.rowCount",
        );
    });

    test("gates publish as suspendable wait.signal nodes; approved edges are plain", () => {
        const artifact = publishableArtifact();
        artifact.lock!.nodes.splice(2, 0, { id: "approve", label: "Approve", kind: "gate" });
        artifact.lock!.edges = [
            { from: "query", to: "limit" },
            { from: "limit", to: "approve" },
            { from: "approve", to: "report", when: "approved" },
        ];
        const result = translateArtifactToHobbesPlan(artifact);
        expect(result.issues).to.deep.equal([]);
        const gate = result.plan!.nodes.find((n) => n.id === "approve")!;
        expect(gate.strategy).to.equal("primitive:wait.signal");
        expect(gate.primitiveArgs?.correlationKey).to.equal("gate:approve");
        expect(result.plan!.edges.map((e) => `${e.from}>${e.to}`)).to.contain("approve>report");
    });

    test("failure-branch edges still refuse with reasons", () => {
        const artifact = publishableArtifact();
        artifact.lock!.edges.push({ from: "limit", to: "report", when: "failure" });
        const result = translateArtifactToHobbesPlan(artifact);
        expect(result.plan).to.equal(undefined);
        expect(result.issues.join(" ")).to.contain("conditional edge");
    });

    test("the local fixture publishes (its row-count bind maps to $regions)", () => {
        const result = translateArtifactToHobbesPlan(createFixtureRunbookArtifact());
        expect(result.issues).to.deep.equal([]);
        const assert = result.plan!.nodes.find((n) => n.strategy === "primitive:assert.threshold");
        expect(assert?.primitiveArgs?.metric).to.equal("$regions.query.data.rowCount");
    });

    test("mergeConnectionEntry preserves PascalCase, merges by Name, and never writes credentials", () => {
        const first = mergeConnectionEntry(undefined, {
            name: "dev-box",
            server: "localhost",
        });
        expect(first.ServerConnections).to.have.length(1);
        expect(first.ServerConnections[0].Name).to.equal("dev-box");
        expect(first.ServerConnections[0].ConnectionString).to.contain("Integrated Security=True");
        expect(first.ServerConnections[0].ConnectionString).to.not.match(/password/i);

        // Database-scoped entries land in DatabaseConnections.
        const second = mergeConnectionEntry(first, {
            name: "dev-db",
            server: "localhost",
            database: "Orders",
        });
        expect(second.DatabaseConnections).to.have.length(1);
        expect(second.DatabaseConnections[0].ConnectionString).to.contain("Database=Orders;");

        // Same Name updates in place (never duplicates).
        const third = mergeConnectionEntry(second, { name: "dev-box", server: "otherhost" });
        expect(third.ServerConnections).to.have.length(1);
        expect(third.ServerConnections[0].ConnectionString).to.contain("Server=otherhost;");
    });
});
