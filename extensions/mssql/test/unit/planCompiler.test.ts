/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compile guardrails (plan compiler v1): the model is a proposal engine
 * only — JSON extraction tolerates fences/prose, invented activities and
 * structural violations are refused with the exact detail, trusted safety
 * metadata is stamped from the catalog (never taken from the model), and
 * the local SQL lane's read-only guard refuses anything but a single
 * SELECT/WITH statement.
 */

import { expect } from "chai";
import {
    activityCatalogFingerprint,
    validateLockAgainstCatalog,
} from "../../src/runbookStudio/activities/activityCatalog";
import {
    extractJsonObject,
    isProposalFailure,
    parseCompiledProposal,
} from "../../src/runbookStudio/models/planCompiler";
import { isReadOnlySql } from "../../src/runbookStudio/runtime/localSqlDelegate";
import { createNewRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import { RunbookArtifactFile } from "../../src/sharedInterfaces/runbookStudio";

function base(): RunbookArtifactFile {
    return createNewRunbookArtifact("New runbook", "rb-test");
}

const GOOD_PROPOSAL = {
    name: "Orders row-count check",
    description: "Verifies Orders stays under a limit.",
    parameters: [
        { id: "target", label: "Target connection", type: "connection", required: true },
        { id: "maxRows", label: "Maximum rows", type: "int", default: 1000000 },
    ],
    entryNodeId: "query",
    nodes: [
        {
            id: "query",
            label: "Count Orders rows",
            kind: "activity",
            activityKind: "sql.query.read",
            inputs: {
                connection: "$params.target",
                sql: "SELECT COUNT(*) AS OrderCount FROM dbo.Orders",
            },
        },
        {
            id: "limit",
            label: "Assert under limit",
            kind: "activity",
            activityKind: "assert.threshold",
            inputs: { value: "$nodes.query.rowCount", max: "$params.maxRows" },
        },
        { id: "report", label: "Summarize", kind: "report" },
    ],
    edges: [
        { from: "query", to: "limit" },
        { from: "limit", to: "report" },
    ],
};

suite("planCompiler", () => {
    test("extractJsonObject handles fences and surrounding prose", () => {
        const json = JSON.stringify(GOOD_PROPOSAL);
        expect(extractJsonObject(json)).to.equal(json);
        expect(extractJsonObject("Here is the plan:\n```json\n" + json + "\n```\nDone.")).to.equal(
            json,
        );
        expect(extractJsonObject("no json here")).to.equal(undefined);
    });

    test("a valid proposal compiles into a runnable artifact", () => {
        const result = parseCompiledProposal(JSON.stringify(GOOD_PROPOSAL), base(), "my intent");
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        const artifact = result.artifact;
        expect(artifact.name).to.equal("Orders row-count check");
        expect(artifact.source.intent).to.equal("my intent");
        expect(artifact.source.parameters).to.have.length(2);
        expect(artifact.lock?.planRevision).to.equal("1");
        expect(artifact.lock?.planHash).to.match(/^sha256:[0-9a-f]{64}$/);
        expect(artifact.lock?.activityCatalogFingerprint).to.equal(activityCatalogFingerprint());
        expect(artifact.lock?.nodes[0].target).to.deep.equal({
            kind: "sqlDatabase",
            binding: { source: "parameter", parameterId: "target" },
        });
    });

    test("trusted metadata is stamped from the catalog, not the model", () => {
        const proposal = JSON.parse(JSON.stringify(GOOD_PROPOSAL));
        // Model tries to claim a harmless blast radius + a fake version.
        proposal.nodes[0].blastRadius = {
            resource: "none",
            operation: "read",
            targetEnvironment: "approvedReadOnlyProduction",
            reversibility: "noEffect",
        };
        proposal.nodes[0].activityVersion = 99;
        const result = parseCompiledProposal(JSON.stringify(proposal), base(), "intent");
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        const query = result.artifact.lock!.nodes[0];
        expect(query.activityVersion).to.equal(1);
        expect(query.blastRadius?.resource).to.equal("databaseData");
        expect(query.blastRadius?.targetEnvironment).to.equal("local");
        expect(query.target).to.deep.equal({
            kind: "sqlDatabase",
            binding: { source: "parameter", parameterId: "target" },
        });
    });

    test("invented activities are refused with the exact detail", () => {
        const proposal = JSON.parse(JSON.stringify(GOOD_PROPOSAL));
        proposal.nodes[0].activityKind = "dacpac.deploy";
        const result = parseCompiledProposal(JSON.stringify(proposal), base(), "intent");
        expect(isProposalFailure(result)).to.equal(true);
        if (isProposalFailure(result)) {
            expect(result.detail).to.contain("unregistered activity");
        }
    });

    test("missing required activity inputs are refused", () => {
        const proposal = JSON.parse(JSON.stringify(GOOD_PROPOSAL));
        delete proposal.nodes[0].inputs.sql;
        const result = parseCompiledProposal(JSON.stringify(proposal), base(), "intent");
        expect(isProposalFailure(result)).to.equal(true);
        if (isProposalFailure(result)) {
            expect(result.detail).to.contain("missing required input 'sql'");
        }
    });

    test("structural violations (dangling edge) are refused", () => {
        const proposal = JSON.parse(JSON.stringify(GOOD_PROPOSAL));
        proposal.edges.push({ from: "limit", to: "ghost" });
        const result = parseCompiledProposal(JSON.stringify(proposal), base(), "intent");
        expect(isProposalFailure(result)).to.equal(true);
    });

    test("recompiling bumps the plan revision", () => {
        const first = parseCompiledProposal(JSON.stringify(GOOD_PROPOSAL), base(), "intent");
        if (isProposalFailure(first)) {
            throw new Error(first.detail);
        }
        const second = parseCompiledProposal(
            JSON.stringify(GOOD_PROPOSAL),
            first.artifact,
            "intent v2",
        );
        if (isProposalFailure(second)) {
            throw new Error(second.detail);
        }
        expect(second.artifact.lock?.planRevision).to.equal("2");
    });

    test("an existing user-chosen name is never overwritten", () => {
        const named = { ...base(), name: "My careful name" };
        const result = parseCompiledProposal(JSON.stringify(GOOD_PROPOSAL), named, "intent");
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        expect(result.artifact.name).to.equal("My careful name");
    });

    test("validateLockAgainstCatalog reports version pins that drifted", () => {
        const result = parseCompiledProposal(JSON.stringify(GOOD_PROPOSAL), base(), "intent");
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        const lock = result.artifact.lock!;
        lock.nodes[1] = { ...lock.nodes[1], activityVersion: 7 };
        const issues = validateLockAgainstCatalog(lock);
        expect(issues.join(" ")).to.contain("registered version is 1");
    });

    test("validateLockAgainstCatalog rejects target/input drift", () => {
        const result = parseCompiledProposal(JSON.stringify(GOOD_PROPOSAL), base(), "intent");
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        const lock = result.artifact.lock!;
        lock.nodes[0].target = {
            kind: "sqlDatabase",
            binding: { source: "parameter", parameterId: "other" },
        };
        expect(validateLockAgainstCatalog(lock).join(" ")).to.contain(
            "target does not match catalog input",
        );
    });
});

suite("isReadOnlySql", () => {
    test("accepts single SELECT and WITH statements", () => {
        expect(isReadOnlySql("SELECT 1")).to.equal(true);
        expect(isReadOnlySql("  select top 10 * from dbo.Orders;")).to.equal(true);
        expect(isReadOnlySql("WITH x AS (SELECT 1 AS a) SELECT * FROM x")).to.equal(true);
        expect(isReadOnlySql("-- comment\nSELECT 1")).to.equal(true);
        expect(isReadOnlySql("/* block */ SELECT 1")).to.equal(true);
    });

    test("refuses mutations, multi-statements, and non-queries", () => {
        expect(isReadOnlySql("DELETE FROM dbo.Orders")).to.equal(false);
        expect(isReadOnlySql("DROP TABLE dbo.Orders")).to.equal(false);
        expect(isReadOnlySql("SELECT 1; DELETE FROM dbo.Orders")).to.equal(false);
        expect(isReadOnlySql("EXEC sp_who")).to.equal(false);
        expect(isReadOnlySql("UPDATE dbo.Orders SET a = 1")).to.equal(false);
        expect(isReadOnlySql("")).to.equal(false);
        expect(isReadOnlySql("-- only a comment")).to.equal(false);
    });
});
