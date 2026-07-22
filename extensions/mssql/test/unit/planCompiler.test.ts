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
    compileDeterministicDacpacEvolution,
    compileDeterministicDacpacInventory,
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
                    inputs: {
                        database: "$params.source",
                        databaseName: "WideWorldImporters",
                    },
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

    test("the exact schema evolution prompt compiles deterministically", () => {
        const intent =
            "Extract WideWorldImporters database to a dacpac. Deploy the dacpac back to the " +
            "same server and name it WideWorld_WIP. Now add a new table to WideWorld_WIP that " +
            "is dbo.Logs and add a representative logging table. Then run a schema compare " +
            "between the orginal database and the database, and show the schema deltas as diff output.";
        const classified = classifyRunbookIntent(intent);
        const evolutionBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: { ...base().source, requirements: classified.requirements },
        };

        const result = compileDeterministicDacpacEvolution(evolutionBase, intent);
        if (!result) {
            throw new Error("deterministic schema evolution workflow was not selected");
        }
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }

        expect(validateLockAgainstCatalog(result.artifact.lock!)).to.deep.equal([]);
        expect(
            result.artifact.source.parameters.find(
                (parameter) => parameter.id === "sourceDatabaseName",
            )?.default,
        ).to.equal("WideWorldImporters");
        expect(
            result.artifact.source.parameters.find(
                (parameter) => parameter.id === "targetDatabaseName",
            )?.default,
        ).to.equal("WideWorld_WIP");
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
        const mutation = result.artifact.lock!.nodes.find(
            (node) => node.id === "create-logging-table",
        );
        expect(mutation?.inputs?.sql).to.contain("CREATE TABLE [dbo].[Logs]");
        expect(mutation?.inputs?.sql).to.contain("[LoggedAtUtc] datetime2(7)");
        expect(
            result.artifact.lock!.nodes.find((node) => node.id === "compare")?.inputs,
        ).to.deep.equal({
            dacpac: "$nodes.extract.artifactPath",
            database: "$nodes.provision.connectionRef",
        });
    });

    test("schema evolution can append an STS v2 ER diagram result", () => {
        const intent =
            "Extract WideWorldImporters database to a dacpac. Deploy the dacpac back to the " +
            "same server and name it WideWorld_WIP. Add a new table that is dbo.Logs and add " +
            "a representative logging table. Run schema compare, show the schema deltas as " +
            "diff output, and visualize the new database schema as an ERD.";
        const classified = classifyRunbookIntent(intent);
        const evolutionBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: { ...base().source, requirements: classified.requirements },
        };
        const result = compileDeterministicDacpacEvolution(evolutionBase, intent);
        if (!result) {
            throw new Error("deterministic workflow was not selected");
        }
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }

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
            "database.schema.visualize",
        ]);
        expect(result.artifact.lock!.edges).to.deep.include.members([
            { from: "compare", to: "visualize-schema" },
            { from: "visualize-schema", to: "report" },
        ]);
    });

    test("extract, named deploy, and typed schema inventory compiles end to end", () => {
        const intent =
            "Extract a dacpac from WideWorldImporters and deploy it as WWI_2. " +
            "Show all the tables, views, and sproc from the new database.";
        const classified = classifyRunbookIntent(intent);
        const inventoryBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: { ...base().source, requirements: classified.requirements },
        };
        const proposal = {
            name: "WideWorldImporters schema inventory",
            parameters: [
                { id: "source", label: "WideWorldImporters source", type: "connection" },
                { id: "server", label: "Local development server", type: "connection" },
            ],
            entryNodeId: "extract",
            nodes: [
                {
                    id: "extract",
                    label: "Extract source DACPAC",
                    kind: "activity",
                    activityKind: "dacpac.extract",
                    inputs: {
                        database: "$params.source",
                        databaseName: "WideWorldImporters",
                    },
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
                {
                    id: "verify",
                    label: "Verify deployed schema",
                    kind: "activity",
                    activityKind: "schema.compare",
                    inputs: {
                        dacpac: "$nodes.extract.artifactPath",
                        database: "$nodes.provision.connectionRef",
                    },
                },
                {
                    id: "inventory",
                    label: "List tables, views, and stored procedures",
                    kind: "activity",
                    activityKind: "database.schema.inventory",
                    inputs: { database: "$nodes.provision.connectionRef" },
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
                { from: "deploy", to: "verify" },
                { from: "verify", to: "inventory" },
                { from: "inventory", to: "report" },
            ],
        };

        const result = parseCompiledProposal(JSON.stringify(proposal), inventoryBase, intent);
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
            "schema.compare",
            "database.schema.inventory",
        ]);

        const wrongTarget = JSON.parse(JSON.stringify(proposal));
        wrongTarget.nodes.find((node: { id: string }) => node.id === "inventory").inputs.database =
            "$params.source";
        const refused = parseCompiledProposal(JSON.stringify(wrongTarget), inventoryBase, intent);
        expect(isProposalFailure(refused)).to.equal(true);
        if (isProposalFailure(refused)) {
            expect(refused.detail).to.contain(
                "must inventory the same target as an upstream DACPAC deployment",
            );
        }

        const inventedEvidence = JSON.parse(JSON.stringify(proposal));
        inventedEvidence.nodes.splice(-1, 0, {
            id: "evidence",
            label: "Bundle evidence",
            kind: "activity",
            activityKind: "evidence.bundle",
        });
        inventedEvidence.edges = inventedEvidence.edges.filter(
            (edge: { from: string; to: string }) => edge.from !== "inventory",
        );
        inventedEvidence.edges.push(
            { from: "inventory", to: "evidence" },
            { from: "evidence", to: "report" },
        );
        const evidenceRefused = parseCompiledProposal(
            JSON.stringify(inventedEvidence),
            inventoryBase,
            intent,
        );
        expect(isProposalFailure(evidenceRefused)).to.equal(true);
        if (isProposalFailure(evidenceRefused)) {
            expect(evidenceRefused.detail).to.contain(
                "activity 'evidence.bundle' is absent from the source capability manifest",
            );
        }
    });

    test("the exact live DACPAC inventory prompt compiles deterministically without a model", () => {
        const intent =
            "Extract WideWorldImporters to a dacpac, import it back as WWI_2, " +
            "dump all the schema objects from WWI_2 into an output table.";
        const classified = classifyRunbookIntent(intent);
        const inventoryBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: { ...base().source, requirements: classified.requirements },
        };

        const result = compileDeterministicDacpacInventory(inventoryBase, intent);
        expect(result).not.to.equal(undefined);
        if (!result) {
            throw new Error("deterministic workflow was not selected");
        }
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        expect(validateLockAgainstCatalog(result.artifact.lock!)).to.deep.equal([]);
        expect(result.artifact.source.parameters).to.deep.include({
            id: "sourceDatabaseName",
            label: "Source database name",
            type: "string",
            required: true,
            default: "WideWorldImporters",
        });
        expect(result.artifact.source.parameters).to.deep.include({
            id: "targetDatabaseName",
            label: "New development database name",
            type: "string",
            required: true,
            default: "WWI_2",
        });
        expect(
            result.artifact
                .lock!.nodes.filter((node) => node.kind === "activity")
                .map((node) => node.activityKind),
        ).to.deep.equal([
            "dacpac.extract",
            "devdatabase.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy.dev",
            "schema.compare",
            "database.schema.inventory",
        ]);
        expect(
            result.artifact.lock!.nodes.find((node) => node.id === "provision")?.inputs,
        ).to.deep.equal({
            server: "$params.targetServer",
            databaseName: "$params.targetDatabaseName",
        });
    });

    test("deterministic DACPAC inventory compilation requires explicit safe database names", () => {
        const intent = "Extract a dacpac and deploy it, then list the schema objects.";
        const classified = classifyRunbookIntent(
            "Extract WideWorldImporters to a dacpac, import it as WWI_2, list all tables and views.",
        );
        const inventoryBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: { ...base().source, requirements: classified.requirements },
        };
        expect(compileDeterministicDacpacInventory(inventoryBase, intent)).to.equal(undefined);
    });

    test("deterministic DACPAC inventory parsing ignores a generic server phrase", () => {
        const intent =
            "Exact WideWorldImporter to a dacpac. Deploy the dacpac back to server as WWI_2. " +
            "Dump all tables, views, and sprocs from WWI_2.";
        const classified = classifyRunbookIntent(intent);
        const inventoryBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: { ...base().source, requirements: classified.requirements },
        };
        const result = compileDeterministicDacpacInventory(inventoryBase, intent);
        if (!result) {
            throw new Error("deterministic workflow was not selected");
        }
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        expect(
            result.artifact.source.parameters.find(
                (parameter) => parameter.id === "targetDatabaseName",
            )?.default,
        ).to.equal("WWI_2");
    });

    test("an owned SQL container lifecycle compiles with a rebind-only secret", () => {
        const intent = "Provision and then dispose a local SQL container.";
        const classified = classifyRunbookIntent(intent);
        const containerBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: {
                ...base().source,
                requirements: classified.requirements,
            },
        };
        const proposal = {
            name: "Disposable SQL container",
            parameters: [
                {
                    id: "containerName",
                    label: "Container name",
                    type: "string",
                    required: true,
                },
                {
                    id: "databaseName",
                    label: "Database name",
                    type: "string",
                    required: true,
                },
                {
                    id: "password",
                    label: "SQL administrator password",
                    type: "secret",
                    required: true,
                },
            ],
            entryNodeId: "approve",
            nodes: [
                { id: "approve", label: "Approve container", kind: "gate" },
                {
                    id: "container",
                    label: "Provision SQL container",
                    kind: "activity",
                    activityKind: "sql.container.provision",
                    inputs: {
                        containerName: "$params.containerName",
                        databaseName: "$params.databaseName",
                        version: "2022",
                        password: "$params.password",
                    },
                },
                {
                    id: "dispose",
                    label: "Dispose SQL container",
                    kind: "activity",
                    activityKind: "sql.container.dispose",
                    inputs: { database: "$nodes.container.connectionRef" },
                },
                { id: "report", label: "Summarize", kind: "report" },
            ],
            edges: [
                { from: "approve", to: "container", when: "approved" },
                { from: "approve", to: "report", when: "rejected" },
                { from: "container", to: "dispose" },
                { from: "dispose", to: "report" },
            ],
        };

        const result = parseCompiledProposal(JSON.stringify(proposal), containerBase, intent);
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        expect(validateLockAgainstCatalog(result.artifact.lock!)).to.deep.equal([]);
        expect(result.artifact.source.parameters.find((item) => item.id === "password")).to.include(
            {
                type: "secret",
                required: true,
            },
        );
    });

    test("an inspected workload and XEL capture compile against the same owned SQL container", () => {
        const intent =
            "Provision a local SQL container, import the dacpac, run workload.sql, collect an XEvent XEL file, and dispose the container.";
        const classified = classifyRunbookIntent(intent);
        const containerBase: RunbookArtifactFile = {
            ...base(),
            family: classified.family,
            source: {
                ...base().source,
                requirements: classified.requirements,
            },
        };
        const proposal = {
            name: "Disposable SQL workload",
            parameters: [
                { id: "containerName", label: "Container name", type: "string", required: true },
                { id: "databaseName", label: "Database name", type: "string", required: true },
                { id: "password", label: "SQL password", type: "secret", required: true },
                { id: "workload", label: "Workload file", type: "string", required: true },
                { id: "dacpac", label: "DACPAC file", type: "string", required: true },
                {
                    id: "artifactDigest",
                    label: "DACPAC SHA-256",
                    type: "string",
                    required: true,
                },
            ],
            entryNodeId: "approve-container",
            nodes: [
                { id: "approve-container", label: "Approve container", kind: "gate" },
                {
                    id: "container",
                    label: "Provision SQL container",
                    kind: "activity",
                    activityKind: "sql.container.provision",
                    inputs: {
                        containerName: "$params.containerName",
                        databaseName: "$params.databaseName",
                        version: "2022",
                        password: "$params.password",
                    },
                },
                {
                    id: "preview-deploy",
                    label: "Preview DACPAC deployment",
                    kind: "activity",
                    activityKind: "dacpac.deploy.preview",
                    inputs: {
                        dacpac: "$params.dacpac",
                        database: "$nodes.container.connectionRef",
                    },
                },
                { id: "approve-deploy", label: "Approve deployment", kind: "gate" },
                {
                    id: "deploy",
                    label: "Deploy DACPAC",
                    kind: "activity",
                    activityKind: "dacpac.deploy.container",
                    inputs: {
                        dacpac: "$params.dacpac",
                        database: "$nodes.container.connectionRef",
                        artifactDigest: "$params.artifactDigest",
                        previewDigest: "$nodes.preview-deploy.reportSha256",
                    },
                },
                {
                    id: "verify",
                    label: "Verify deployed schema",
                    kind: "activity",
                    activityKind: "schema.compare",
                    inputs: {
                        dacpac: "$params.dacpac",
                        database: "$nodes.container.connectionRef",
                    },
                },
                {
                    id: "inspect",
                    label: "Inspect workload",
                    kind: "activity",
                    activityKind: "sql.workload.inspect",
                    inputs: { file: "$params.workload" },
                },
                { id: "approve-capture", label: "Approve capture", kind: "gate" },
                {
                    id: "start-capture",
                    label: "Start XEvent capture",
                    kind: "activity",
                    activityKind: "xevent.session.start",
                    inputs: {
                        database: "$nodes.container.connectionRef",
                        template: "developer-diagnostics",
                        maxFileSizeMb: 16,
                    },
                },
                { id: "approve-workload", label: "Approve workload", kind: "gate" },
                {
                    id: "run",
                    label: "Run workload",
                    kind: "activity",
                    activityKind: "sql.workload.run",
                    inputs: {
                        database: "$nodes.container.connectionRef",
                        workload: "$nodes.inspect.workloadRef",
                        workloadDigest: "$nodes.inspect.workloadSha256",
                        repetitions: 1,
                        timeoutSeconds: 300,
                    },
                },
                {
                    id: "stop-capture",
                    label: "Stop XEvent capture",
                    kind: "activity",
                    activityKind: "xevent.session.stop",
                    inputs: {
                        database: "$nodes.container.connectionRef",
                        session: "$nodes.start-capture.sessionRef",
                    },
                },
                {
                    id: "collect-xel",
                    label: "Collect XEL",
                    kind: "activity",
                    activityKind: "xevent.xel.collect",
                    inputs: {
                        database: "$nodes.container.connectionRef",
                        capture: "$nodes.stop-capture.captureRef",
                    },
                },
                {
                    id: "dispose",
                    label: "Dispose SQL container",
                    kind: "activity",
                    activityKind: "sql.container.dispose",
                    inputs: { database: "$nodes.container.connectionRef" },
                },
                { id: "report", label: "Summarize", kind: "report" },
            ],
            edges: [
                { from: "approve-container", to: "container", when: "approved" },
                { from: "approve-container", to: "report", when: "rejected" },
                { from: "container", to: "preview-deploy" },
                { from: "preview-deploy", to: "dispose", when: "failure" },
                { from: "preview-deploy", to: "approve-deploy" },
                { from: "approve-deploy", to: "deploy", when: "approved" },
                { from: "approve-deploy", to: "dispose", when: "rejected" },
                { from: "deploy", to: "verify" },
                { from: "deploy", to: "dispose", when: "failure" },
                { from: "verify", to: "inspect" },
                { from: "verify", to: "dispose", when: "failure" },
                { from: "inspect", to: "approve-capture" },
                { from: "inspect", to: "dispose", when: "failure" },
                { from: "approve-capture", to: "start-capture", when: "approved" },
                { from: "approve-capture", to: "dispose", when: "rejected" },
                { from: "start-capture", to: "approve-workload" },
                { from: "start-capture", to: "dispose", when: "failure" },
                { from: "approve-workload", to: "run", when: "approved" },
                { from: "approve-workload", to: "stop-capture", when: "rejected" },
                { from: "run", to: "stop-capture" },
                { from: "run", to: "stop-capture", when: "failure" },
                { from: "stop-capture", to: "collect-xel" },
                { from: "stop-capture", to: "dispose", when: "failure" },
                { from: "collect-xel", to: "dispose" },
                { from: "collect-xel", to: "dispose", when: "failure" },
                { from: "dispose", to: "report" },
            ],
        };

        const result = parseCompiledProposal(JSON.stringify(proposal), containerBase, intent);
        if (isProposalFailure(result)) {
            throw new Error(result.detail);
        }
        expect(validateLockAgainstCatalog(result.artifact.lock!)).to.deep.equal([]);
        expect(
            result.artifact
                .lock!.nodes.filter((node) => node.kind === "activity")
                .map((node) => node.activityKind),
        ).to.deep.equal([
            "sql.container.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy.container",
            "schema.compare",
            "sql.workload.inspect",
            "xevent.session.start",
            "sql.workload.run",
            "xevent.session.stop",
            "xevent.xel.collect",
            "sql.container.dispose",
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
