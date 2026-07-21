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
    stampCatalogMetadata,
    validateLockAgainstCatalog,
} from "../../src/runbookStudio/activities/activityCatalog";
import {
    buildCompilePrompt,
    extractJsonObject,
    isProposalFailure,
    parseCompiledProposal,
} from "../../src/runbookStudio/models/planCompiler";
import { isReadOnlySql } from "../../src/runbookStudio/runtime/localSqlDelegate";
import { createNewRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import { RunbookArtifactFile } from "../../src/sharedInterfaces/runbookStudio";
import { classifyRunbookIntent } from "../../src/runbookStudio/capabilities/runbookCapabilities";

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

    test("compile prompts carry the selected family grammar", () => {
        expect(buildCompilePrompt("create it", undefined, "build")).to.contain(
            "Planner family: build",
        );
        expect(buildCompilePrompt("inspect it", undefined, "investigate")).to.contain(
            "Planner family: investigate",
        );
        expect(buildCompilePrompt("create it", undefined, "build")).to.contain(
            "Inputs marked ddl must be exactly one complete CREATE TABLE statement",
        );
    });

    test("the advanced extract, named deploy, table, and diff workflow compiles end to end", () => {
        const intent =
            "Create a dacpac from WideWorldImporters, then import the dacpac into WWI_2, " +
            "then create a table in WWI_2, then run a schema compare and create a diff file.";
        const classified = classifyRunbookIntent(intent);
        const advancedBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: {
                ...base().source,
                requirements: classified.requirements,
            },
        };
        const proposal = {
            name: "WideWorldImporters development evolution",
            description: "Extracts, deploys, changes, and compares an owned development database.",
            parameters: [
                {
                    id: "source",
                    label: "WideWorldImporters source",
                    type: "connection",
                    required: true,
                },
                {
                    id: "server",
                    label: "Local development server",
                    type: "connection",
                    required: true,
                },
            ],
            entryNodeId: "extract",
            nodes: [
                {
                    id: "extract",
                    label: "Extract source DACPAC",
                    kind: "activity",
                    activityKind: "dacpac.extract",
                    inputs: { database: "$params.source" },
                },
                { id: "approve-provision", label: "Approve target creation", kind: "gate" },
                {
                    id: "provision",
                    label: "Create WWI_2",
                    kind: "activity",
                    activityKind: "devdatabase.provision",
                    inputs: { server: "$params.server", databaseName: "WWI_2" },
                },
                {
                    id: "preview",
                    label: "Preview deployment",
                    kind: "activity",
                    activityKind: "dacpac.deploy.preview",
                    inputs: {
                        dacpac: "$nodes.extract.artifactPath",
                        database: "$nodes.provision.connectionRef",
                    },
                },
                { id: "approve-deploy", label: "Approve deployment", kind: "gate" },
                {
                    id: "deploy",
                    label: "Deploy DACPAC",
                    kind: "activity",
                    activityKind: "dacpac.deploy.dev",
                    inputs: {
                        dacpac: "$nodes.extract.artifactPath",
                        database: "$nodes.provision.connectionRef",
                        artifactDigest: "$nodes.extract.artifactSha256",
                        previewDigest: "$nodes.preview.reportSha256",
                    },
                },
                { id: "approve-table", label: "Approve table creation", kind: "gate" },
                {
                    id: "create-table",
                    label: "Create run log table",
                    kind: "activity",
                    activityKind: "sql.schema.apply",
                    inputs: {
                        database: "$nodes.provision.connectionRef",
                        sql: "CREATE TABLE dbo.RunLog (Id bigint NOT NULL PRIMARY KEY, CreatedAt datetime2 NOT NULL)",
                    },
                },
                {
                    id: "export-diff",
                    label: "Export schema diff",
                    kind: "activity",
                    activityKind: "schema.compare.export",
                    inputs: {
                        dacpac: "$nodes.extract.artifactPath",
                        database: "$nodes.provision.connectionRef",
                    },
                },
                { id: "report", label: "Summarize", kind: "report" },
            ],
            edges: [
                { from: "extract", to: "approve-provision" },
                { from: "approve-provision", to: "provision", when: "approved" },
                { from: "approve-provision", to: "report", when: "rejected" },
                { from: "provision", to: "preview" },
                { from: "preview", to: "approve-deploy" },
                { from: "approve-deploy", to: "deploy", when: "approved" },
                { from: "approve-deploy", to: "report", when: "rejected" },
                { from: "deploy", to: "approve-table" },
                { from: "approve-table", to: "create-table", when: "approved" },
                { from: "approve-table", to: "report", when: "rejected" },
                { from: "create-table", to: "export-diff" },
                { from: "export-diff", to: "report" },
            ],
        };

        const result = parseCompiledProposal(JSON.stringify(proposal), advancedBase, intent);
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        expect(validateLockAgainstCatalog(result.artifact.lock!)).to.deep.equal([]);
        expect(
            result.artifact
                .lock!.nodes.filter((node) => node.kind === "activity")
                .map((node) => node.activityKind),
        ).to.deep.equal([
            "dacpac.extract",
            "devdatabase.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy.dev",
            "sql.schema.apply",
            "schema.compare.export",
        ]);
    });

    test("post-generation family admission rejects a SQL substitute for Build", () => {
        const buildBase = { ...base(), family: "build" as const };
        const result = parseCompiledProposal(
            JSON.stringify(GOOD_PROPOSAL),
            buildBase,
            "create a database project",
        );
        expect(isProposalFailure(result)).to.equal(true);
        if (isProposalFailure(result)) {
            expect(result.detail).to.contain("does not allow activity 'sql.query.read'");
        }
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
        proposal.nodes[0].activityKind = "dangerous.deploy";
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

    test("validateLockAgainstCatalog rejects mutating SQL inputs before execution", () => {
        const result = parseCompiledProposal(JSON.stringify(GOOD_PROPOSAL), base(), "intent");
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        const lock = result.artifact.lock!;
        lock.nodes[0].inputs!.sql = "DELETE FROM dbo.Orders";
        expect(validateLockAgainstCatalog(lock).join(" ")).to.contain(
            "must be one read-only SELECT statement",
        );
    });

    test("approval-required effects need one dedicated approved gate", () => {
        const lock = createDeveloperValidationPreviewArtifact().lock!;
        lock.edges = lock.edges.filter((edge) => edge.from !== "approve-deploy");
        expect(validateLockAgainstCatalog(lock).join(" ")).to.contain(
            "node 'deploy-dacpac' requires one unambiguous incoming approved gate",
        );
    });

    test("tSQLt execution requires an approved upstream owned sandbox", () => {
        const artifact = createDeveloperValidationPreviewArtifact();
        const lock = artifact.lock!;
        const provision = lock.nodes.find((node) => node.id === "provision-sandbox")!;
        const dispose = lock.nodes.find((node) => node.id === "dispose-sandbox")!;
        lock.nodes.push(
            { id: "approve-tsqlt", label: "Approve tSQLt", kind: "gate" },
            ...stampCatalogMetadata([
                {
                    id: "run-tsqlt",
                    label: "Run tSQLt",
                    kind: "activity",
                    activityKind: "tsqlt.run",
                    inputs: { database: "$nodes.provision-sandbox.connectionRef" },
                },
            ]),
        );
        lock.edges.push(
            { from: provision.id, to: "approve-tsqlt" },
            { from: "approve-tsqlt", to: "run-tsqlt", when: "approved" },
            { from: "run-tsqlt", to: dispose.id },
        );

        expect(validateLockAgainstCatalog(lock)).to.deep.equal([]);
        const run = lock.nodes.find((node) => node.id === "run-tsqlt")!;
        run.inputs!.database = "$params.sandboxConnection";
        run.target = {
            kind: "ephemeralSqlDatabase",
            binding: { source: "parameter", parameterId: "sandboxConnection" },
        };
        expect(validateLockAgainstCatalog(lock).join(" ")).to.contain(
            "must bind its disposable target to an upstream sandbox.provision connectionRef",
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
