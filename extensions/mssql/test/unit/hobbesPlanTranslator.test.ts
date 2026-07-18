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

    test("refuses gates, conditional edges, and bind-expression thresholds with reasons", () => {
        const artifact = publishableArtifact();
        artifact.lock!.nodes.splice(1, 0, { id: "approve", label: "Approve", kind: "gate" });
        artifact.lock!.edges.push({ from: "approve", to: "report", when: "approved" });
        artifact.lock!.nodes.find((n) => n.id === "limit")!.inputs = {
            value: "$nodes.query.rowCount",
            max: "$params.maxCount",
        };
        const result = translateArtifactToHobbesPlan(artifact);
        expect(result.plan).to.equal(undefined);
        const joined = result.issues.join(" | ");
        expect(joined).to.contain("gate node 'approve'");
        expect(joined).to.contain("conditional edge");
        expect(joined).to.contain("bind expressions");
    });

    test("the local fixture refuses honestly (its threshold binds node outputs)", () => {
        // The fake-lane fixture asserts on $nodes.query.rowCount — cross-node
        // bind translation is not built yet, so publish must refuse with the
        // exact reason rather than silently publishing a broken plan.
        const result = translateArtifactToHobbesPlan(createFixtureRunbookArtifact());
        expect(result.plan).to.equal(undefined);
        expect(result.issues.join(" ")).to.contain("bind expressions");
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
