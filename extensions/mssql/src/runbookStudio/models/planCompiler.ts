/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plan compiler v1 (extension-owned, ADR-7): natural-language intent ->
 * catalog-constrained compiled plan via the user's VS Code language models
 * (`vscode.lm`, e.g. GitHub Copilot). The model is a PROPOSAL engine only:
 * its output is parsed, structurally validated, checked against the
 * registered activity catalog, and re-stamped with trusted safety metadata
 * before it ever reaches the artifact. One bounded retry with the exact
 * validation error; compiled artifacts then execute with ZERO model calls.
 *
 * (The Hobbes runtime's elicitation planner remains the richer, schema-
 * grounded upgrade path behind the same coordinator seam — probe P3.)
 */

import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { Perf } from "../../perf/perfTelemetry";
import {
    RbsError,
    RunbookArtifactFile,
    RunbookParameterDefinition,
    RunbookPlanEdge,
    RunbookPlanNode,
    RUNBOOK_LOCK_SCHEMA_VERSION,
} from "../../sharedInterfaces/runbookStudio";
import {
    describeCatalogForPrompt,
    activityCatalogFingerprint,
    stampCatalogMetadata,
    validateLockAgainstCatalog,
} from "../activities/activityCatalog";
import { describePlannerContract, validateCompiledFamilyContract } from "./plannerContracts";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
    isArtifactParseFailure,
    parseRunbookArtifact,
} from "../runbookArtifact";
import { emitRunbookEvent, metaField, RunbookOperationContext } from "../runbookDiag";
import { validateTargetBindings } from "../targetBindings";
import { isValidDacpacSourceDatabaseName } from "../runtime/localDeveloperOperations";
import { isValidLocalDevelopmentDatabaseName } from "../runtime/localDevelopmentDatabaseOperations";
import { validateLocalCreateTableSql } from "../schemaMutationPolicy";

// ---------------------------------------------------------------------------
// Pure parsing/validation (unit-tested without vscode)
// ---------------------------------------------------------------------------

export interface CompiledProposal {
    name?: string;
    description?: string;
    parameters: RunbookParameterDefinition[];
    entryNodeId: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
}

export type ProposalParseResult =
    | { ok: true; artifact: RunbookArtifactFile }
    | { ok: false; detail: string };

/** Narrowing helper (non-strict tsconfig: boolean discriminants don't narrow). */
export function isProposalFailure(
    result: ProposalParseResult,
): result is { ok: false; detail: string } {
    return !result.ok;
}

/** Strip markdown fences and surrounding prose down to the outer JSON object. */
export function extractJsonObject(text: string): string | undefined {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
        return undefined;
    }
    return candidate.slice(start, end + 1);
}

/**
 * Turn a model response into a fully validated artifact: JSON extraction,
 * structural validation (via the SAME artifact parser the editor uses),
 * catalog admission, and trusted-metadata stamping. `base` supplies identity
 * and the intent; the previous lock (if any) bumps the plan revision.
 */
export function parseCompiledProposal(
    responseText: string,
    base: RunbookArtifactFile,
    intent: string,
): ProposalParseResult {
    const json = extractJsonObject(responseText);
    if (!json) {
        return { ok: false, detail: "response contained no JSON object" };
    }
    let proposal: Partial<CompiledProposal>;
    try {
        proposal = JSON.parse(json) as Partial<CompiledProposal>;
    } catch {
        return { ok: false, detail: "response JSON did not parse" };
    }
    if (!Array.isArray(proposal.nodes) || !Array.isArray(proposal.edges)) {
        return { ok: false, detail: "response is missing nodes/edges arrays" };
    }
    const parameters = Array.isArray(proposal.parameters) ? proposal.parameters : [];
    const previousRevision = Number(base.lock?.planRevision ?? "0");
    const planRevision = String(Number.isFinite(previousRevision) ? previousRevision + 1 : 1);

    const nodes = stampCatalogMetadata(proposal.nodes as RunbookPlanNode[]);
    const lockWithoutHash: NonNullable<RunbookArtifactFile["lock"]> = {
        schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
        planRevision,
        planHash: "sha256:pending",
        entryNodeId: String(proposal.entryNodeId ?? nodes[0]?.id ?? ""),
        nodes,
        edges: proposal.edges as RunbookPlanEdge[],
        activityCatalogFingerprint: activityCatalogFingerprint(),
    };

    const candidate: RunbookArtifactFile = {
        ...base,
        // Adopt proposed identity text only while the runbook is unnamed.
        name:
            base.name && base.name !== LocRunbookStudio.newRunbookName
                ? base.name
                : (typeof proposal.name === "string" && proposal.name) || base.name,
        ...(typeof proposal.description === "string" && proposal.description
            ? { description: proposal.description }
            : base.description !== undefined
              ? { description: base.description }
              : {}),
        source: {
            ...base.source,
            intent,
            parameters,
        },
        lock: lockWithoutHash,
    };
    candidate.lock!.planHash = computePlanHash(candidate.source, candidate.lock!);

    // Structural validation through the SAME parser the editor trusts.
    const structural = parseRunbookArtifact(canonicalizeRunbookArtifact(candidate));
    if (isArtifactParseFailure(structural)) {
        return { ok: false, detail: structural.detail };
    }
    // Catalog admission: no invented activities, all required inputs present.
    const issues = validateLockAgainstCatalog(candidate.lock!);
    if (issues.length > 0) {
        return { ok: false, detail: issues.join("; ") };
    }
    const familyIssues = validateCompiledFamilyContract(candidate);
    if (familyIssues.length > 0) {
        return { ok: false, detail: familyIssues.join("; ") };
    }
    // Bound values are intentionally unavailable while authoring, but all
    // target structure must already agree with both catalog and source
    // manifest. Do not defer a model-invented target to run admission.
    const targetIssues = validateTargetBindings(structural.artifact, {}).filter(
        (issue) => issue.kind !== "valueMissing",
    );
    if (targetIssues.length > 0) {
        return { ok: false, detail: targetIssues.map((issue) => issue.detail).join("; ") };
    }
    return { ok: true, artifact: structural.artifact };
}

const DETERMINISTIC_DACPAC_INVENTORY_ACTIVITIES = new Set([
    "dacpac.extract",
    "devdatabase.provision",
    "dacpac.deploy.preview",
    "dacpac.deploy.dev",
    "schema.compare",
    "database.schema.inventory",
]);

const DETERMINISTIC_DACPAC_EVOLUTION_ACTIVITIES = new Set([
    "dacpac.extract",
    "devdatabase.provision",
    "dacpac.deploy.preview",
    "dacpac.deploy.dev",
    "sql.schema.apply",
    "schema.compare.export",
]);
const DETERMINISTIC_SCHEMA_VISUALIZATION_ACTIVITY = "database.schema.visualize";
const DETERMINISTIC_CITIES_WORKLOAD_ACTIVITIES = new Set([
    "sql.container.provision",
    "sql.workload.generate",
    "xevent.session.start",
    "sql.workload.run",
    "xevent.session.stop",
    "xevent.xel.analyze",
    "xevent.xel.collect",
    "workload.benchmark",
    "sql.container.dispose",
]);

/** Compile the first closed data-driven workload workflow. Source rows are
 * sampled by the host and never enter the planner; the generated mutations
 * target a disposable shadow table inside an owned SQL container. */
export function compileDeterministicCitiesWorkload(
    base: RunbookArtifactFile,
    intent: string,
): ProposalParseResult | undefined {
    const required = base.source.requirements?.activities.map((activity) => activity.kind) ?? [];
    if (
        required.length !== DETERMINISTIC_CITIES_WORKLOAD_ACTIVITIES.size ||
        !required.every((kind) => DETERMINISTIC_CITIES_WORKLOAD_ACTIVITIES.has(kind)) ||
        !/\bwideworldimporters\b/i.test(intent) ||
        !/\bapplication\s*\.\s*cities\b/i.test(intent)
    ) {
        return undefined;
    }
    const identity =
        base.id
            .replace(/[^A-Za-z0-9]/g, "")
            .slice(-20)
            .toLowerCase() || "workload";
    const proposal: CompiledProposal = {
        name: "Application.Cities workload analysis",
        description:
            "Samples Application.Cities without model exposure, generates a reviewable shadow-table workload, runs it in an owned SQL container, and presents correlated XEvent performance metrics.",
        parameters: [
            {
                id: "sourceConnection",
                label: "WideWorldImporters server",
                type: "connection",
                required: true,
            },
            {
                id: "sourceDatabaseName",
                label: "Source database",
                type: "string",
                required: true,
                default: "WideWorldImporters",
            },
            {
                id: "containerName",
                label: "Disposable container name",
                type: "string",
                required: true,
                default: `rbs-cities-${identity}`,
            },
            {
                id: "containerDatabase",
                label: "Disposable database name",
                type: "string",
                required: true,
                default: "CitiesWorkload",
            },
            {
                id: "sqlVersion",
                label: "SQL Server container version",
                type: "enum",
                required: true,
                default: "2025",
                enumValues: ["2025", "2022", "2019"],
            },
            {
                id: "saPassword",
                label: "Container administrator password",
                type: "secret",
                required: true,
            },
            {
                id: "sampleRows",
                label: "Rows to sample",
                type: "int",
                required: true,
                default: 20,
            },
            {
                id: "iterations",
                label: "Insert/delete iterations",
                type: "int",
                required: true,
                default: 1000,
            },
            {
                id: "repetitions",
                label: "Measured repetitions",
                type: "int",
                required: true,
                default: 5,
            },
        ],
        entryNodeId: "generate-workload",
        nodes: [
            {
                id: "generate-workload",
                label: "Sample Cities and generate workload",
                kind: "activity",
                activityKind: "sql.workload.generate",
                inputs: {
                    database: "$params.sourceConnection",
                    sourceDatabaseName: "$params.sourceDatabaseName",
                    template: "application-cities-shadow",
                    sampleRows: "$params.sampleRows",
                    iterations: "$params.iterations",
                },
            },
            { id: "approve-provision", label: "Approve disposable SQL container", kind: "gate" },
            {
                id: "provision",
                label: "Provision disposable SQL container",
                kind: "activity",
                activityKind: "sql.container.provision",
                inputs: {
                    containerName: "$params.containerName",
                    databaseName: "$params.containerDatabase",
                    version: "$params.sqlVersion",
                    password: "$params.saPassword",
                },
            },
            { id: "approve-capture", label: "Approve bounded XEvent capture", kind: "gate" },
            {
                id: "start-capture",
                label: "Collect XEvent trace",
                kind: "activity",
                activityKind: "xevent.session.start",
                inputs: {
                    database: "$nodes.provision.connectionRef",
                    template: "developer-diagnostics",
                    maxFileSizeMb: 16,
                },
            },
            { id: "approve-workload", label: "Approve generated workload execution", kind: "gate" },
            {
                id: "run-workload",
                label: "Run generated workload",
                kind: "activity",
                activityKind: "sql.workload.run",
                inputs: {
                    database: "$nodes.provision.connectionRef",
                    workload: "$nodes.generate-workload.workloadRef",
                    workloadDigest: "$nodes.generate-workload.workloadSha256",
                    repetitions: "$params.repetitions",
                    timeoutSeconds: 300,
                },
            },
            {
                id: "stop-capture",
                label: "Stop XEvent trace",
                kind: "activity",
                activityKind: "xevent.session.stop",
                inputs: {
                    database: "$nodes.provision.connectionRef",
                    session: "$nodes.start-capture.sessionRef",
                },
            },
            {
                id: "analyze-capture",
                label: "Analyze XEvent trace",
                kind: "activity",
                activityKind: "xevent.xel.analyze",
                inputs: {
                    database: "$nodes.provision.connectionRef",
                    capture: "$nodes.stop-capture.captureRef",
                },
            },
            {
                id: "collect-capture",
                label: "Retain XEL run artifact",
                kind: "activity",
                activityKind: "xevent.xel.collect",
                inputs: {
                    database: "$nodes.provision.connectionRef",
                    capture: "$nodes.stop-capture.captureRef",
                },
            },
            {
                id: "summarize-performance",
                label: "Summarize workload performance",
                kind: "activity",
                activityKind: "workload.benchmark",
                inputs: {
                    workloadFingerprint: "$nodes.generate-workload.workloadFingerprint",
                    environmentFingerprint: "$nodes.provision.environmentFingerprint",
                    workloadDurationMs: "$nodes.run-workload.totalDurationMs",
                    executedBatchCount: "$nodes.run-workload.executedBatchCount",
                    failedBatchCount: "$nodes.run-workload.failedBatchCount",
                    repetitions: "$nodes.run-workload.repetitions",
                    measurementSampleCount: "$nodes.run-workload.measurementSampleCount",
                    meanDurationMs: "$nodes.run-workload.meanDurationMs",
                    p50DurationMs: "$nodes.run-workload.p50DurationMs",
                    p95DurationMs: "$nodes.run-workload.p95DurationMs",
                    minDurationMs: "$nodes.run-workload.minDurationMs",
                    maxDurationMs: "$nodes.run-workload.maxDurationMs",
                    standardDeviationMs: "$nodes.run-workload.standardDeviationMs",
                    xeventDurationMs: "$nodes.analyze-capture.durationMs",
                    xeventCpuMs: "$nodes.analyze-capture.cpuMs",
                    logicalReads: "$nodes.analyze-capture.logicalReads",
                    physicalReads: "$nodes.analyze-capture.physicalReads",
                    writes: "$nodes.analyze-capture.writes",
                },
            },
            {
                id: "dispose",
                label: "Remove disposable SQL container",
                kind: "activity",
                activityKind: "sql.container.dispose",
                inputs: { database: "$nodes.provision.connectionRef" },
            },
            { id: "report", label: "Summarize workload analysis", kind: "report" },
        ],
        edges: [
            { from: "generate-workload", to: "approve-provision" },
            { from: "generate-workload", to: "report", when: "failure" },
            { from: "approve-provision", to: "provision", when: "approved" },
            { from: "approve-provision", to: "report", when: "rejected" },
            { from: "provision", to: "approve-capture" },
            { from: "provision", to: "report", when: "failure" },
            { from: "approve-capture", to: "start-capture", when: "approved" },
            { from: "approve-capture", to: "dispose", when: "rejected" },
            { from: "start-capture", to: "approve-workload" },
            { from: "start-capture", to: "dispose", when: "failure" },
            { from: "approve-workload", to: "run-workload", when: "approved" },
            { from: "approve-workload", to: "stop-capture", when: "rejected" },
            { from: "run-workload", to: "stop-capture" },
            { from: "run-workload", to: "stop-capture", when: "failure" },
            { from: "stop-capture", to: "analyze-capture" },
            { from: "stop-capture", to: "dispose", when: "failure" },
            { from: "analyze-capture", to: "collect-capture" },
            { from: "analyze-capture", to: "dispose", when: "failure" },
            { from: "collect-capture", to: "summarize-performance" },
            { from: "collect-capture", to: "summarize-performance", when: "failure" },
            { from: "summarize-performance", to: "dispose" },
            { from: "summarize-performance", to: "dispose", when: "failure" },
            { from: "dispose", to: "report" },
            { from: "dispose", to: "report", when: "failure" },
        ],
    };
    return parseCompiledProposal(JSON.stringify(proposal), base, intent);
}

/**
 * Compile the first closed schema-evolution workflow without asking the
 * language model to reconstruct its ownership and approval lifecycle. This
 * deliberately supports only an explicitly named representative logging
 * table. Arbitrary DDL remains on the catalog-governed model path until each
 * mutation shape has its own admission policy.
 */
export function compileDeterministicDacpacEvolution(
    base: RunbookArtifactFile,
    intent: string,
): ProposalParseResult | undefined {
    const required = base.source.requirements?.activities.map((activity) => activity.kind) ?? [];
    const includesSchemaVisualization = required.includes(
        DETERMINISTIC_SCHEMA_VISUALIZATION_ACTIVITY,
    );
    if (
        required.length !==
            DETERMINISTIC_DACPAC_EVOLUTION_ACTIVITIES.size +
                (includesSchemaVisualization ? 1 : 0) ||
        !required.every(
            (kind) =>
                DETERMINISTIC_DACPAC_EVOLUTION_ACTIVITIES.has(kind) ||
                kind === DETERMINISTIC_SCHEMA_VISUALIZATION_ACTIVITY,
        )
    ) {
        return undefined;
    }
    const names = extractDacpacRoundTripDatabaseNames(intent);
    const table = extractRepresentativeLoggingTable(intent);
    if (!names || !table || names.source.toLowerCase() === names.target.toLowerCase()) {
        return undefined;
    }
    const ddl = buildRepresentativeLoggingTableSql(table.schema, table.table);
    if (!validateLocalCreateTableSql(ddl)) {
        return undefined;
    }

    const qualifiedTableName = `${table.schema}.${table.table}`;
    const proposal: CompiledProposal = {
        name: `${names.target} schema evolution`,
        description:
            `Extracts ${names.source}, deploys it to the owned development database ` +
            `${names.target}, creates ${qualifiedTableName}, and reports the resulting schema deltas` +
            `${includesSchemaVisualization ? " with a read-only ER diagram" : ""}.`,
        parameters: [
            {
                id: "sourceConnection",
                label: `${names.source} source server`,
                type: "connection",
                required: true,
            },
            {
                id: "targetServer",
                label: "Local target server",
                type: "connection",
                required: true,
            },
            {
                id: "sourceDatabaseName",
                label: "Source database name",
                type: "string",
                required: true,
                default: names.source,
            },
            {
                id: "targetDatabaseName",
                label: "New development database name",
                type: "string",
                required: true,
                default: names.target,
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
                    database: "$params.sourceConnection",
                    databaseName: "$params.sourceDatabaseName",
                },
            },
            {
                id: "approve-provision",
                label: `Approve creation of ${names.target}`,
                kind: "gate",
            },
            {
                id: "provision",
                label: `Create ${names.target}`,
                kind: "activity",
                activityKind: "devdatabase.provision",
                inputs: {
                    server: "$params.targetServer",
                    databaseName: "$params.targetDatabaseName",
                },
            },
            {
                id: "preview",
                label: "Preview DACPAC deployment",
                kind: "activity",
                activityKind: "dacpac.deploy.preview",
                inputs: {
                    dacpac: "$nodes.extract.artifactPath",
                    database: "$nodes.provision.connectionRef",
                },
            },
            {
                id: "approve-deploy",
                label: `Approve deployment to ${names.target}`,
                kind: "gate",
            },
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
                id: "approve-schema",
                label: `Approve creation of ${qualifiedTableName}`,
                kind: "gate",
            },
            {
                id: "create-logging-table",
                label: `Create ${qualifiedTableName}`,
                kind: "activity",
                activityKind: "sql.schema.apply",
                inputs: {
                    database: "$nodes.provision.connectionRef",
                    sql: ddl,
                },
            },
            {
                id: "compare",
                label: "Report schema deltas",
                kind: "activity",
                activityKind: "schema.compare.export",
                inputs: {
                    dacpac: "$nodes.extract.artifactPath",
                    database: "$nodes.provision.connectionRef",
                },
            },
            ...(includesSchemaVisualization
                ? [
                      {
                          id: "visualize-schema",
                          label: "Visualize evolved schema",
                          kind: "activity" as const,
                          activityKind: DETERMINISTIC_SCHEMA_VISUALIZATION_ACTIVITY,
                          inputs: {
                              database: "$nodes.provision.connectionRef",
                          },
                      },
                  ]
                : []),
            { id: "report", label: "Summarize schema evolution", kind: "report" },
        ],
        edges: [
            { from: "extract", to: "approve-provision" },
            { from: "approve-provision", to: "provision", when: "approved" },
            { from: "approve-provision", to: "report", when: "rejected" },
            { from: "provision", to: "preview" },
            { from: "preview", to: "approve-deploy" },
            { from: "approve-deploy", to: "deploy", when: "approved" },
            { from: "approve-deploy", to: "report", when: "rejected" },
            { from: "deploy", to: "approve-schema" },
            { from: "approve-schema", to: "create-logging-table", when: "approved" },
            { from: "approve-schema", to: "report", when: "rejected" },
            { from: "create-logging-table", to: "compare" },
            {
                from: "compare",
                to: includesSchemaVisualization ? "visualize-schema" : "report",
            },
            ...(includesSchemaVisualization ? [{ from: "visualize-schema", to: "report" }] : []),
        ],
    };
    return parseCompiledProposal(JSON.stringify(proposal), base, intent);
}

/**
 * Compile the closed extract -> named local deploy -> schema inventory
 * workflow without asking a general-purpose model to rediscover its safety
 * lifecycle. The capability classifier remains the admission boundary: this
 * path is selected only when its exact six typed operations were requested
 * and both database names are explicit in the user's intent.
 *
 * Names are surfaced as editable string parameters. This preserves the
 * literal user request while allowing a typo to be corrected in the Run
 * parameter sheet without regenerating the plan.
 */
export function compileDeterministicDacpacInventory(
    base: RunbookArtifactFile,
    intent: string,
): ProposalParseResult | undefined {
    const required = base.source.requirements?.activities.map((activity) => activity.kind) ?? [];
    if (
        required.length !== DETERMINISTIC_DACPAC_INVENTORY_ACTIVITIES.size ||
        !required.every((kind) => DETERMINISTIC_DACPAC_INVENTORY_ACTIVITIES.has(kind))
    ) {
        return undefined;
    }
    const names = extractDacpacRoundTripDatabaseNames(intent);
    if (!names || names.source.toLowerCase() === names.target.toLowerCase()) {
        return undefined;
    }

    const proposal: CompiledProposal = {
        name: `${names.source} deployment to ${names.target}`,
        description:
            `Extracts ${names.source}, provisions ${names.target}, previews and deploys the ` +
            "DACPAC, verifies schema equality, and inventories the deployed schema.",
        parameters: [
            {
                id: "sourceConnection",
                label: `${names.source} source server`,
                type: "connection",
                required: true,
            },
            {
                id: "targetServer",
                label: "Local target server",
                type: "connection",
                required: true,
            },
            {
                id: "sourceDatabaseName",
                label: "Source database name",
                type: "string",
                required: true,
                default: names.source,
            },
            {
                id: "targetDatabaseName",
                label: "New development database name",
                type: "string",
                required: true,
                default: names.target,
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
                    database: "$params.sourceConnection",
                    databaseName: "$params.sourceDatabaseName",
                },
            },
            {
                id: "approve-provision",
                label: `Approve creation of ${names.target}`,
                kind: "gate",
            },
            {
                id: "provision",
                label: `Create ${names.target}`,
                kind: "activity",
                activityKind: "devdatabase.provision",
                inputs: {
                    server: "$params.targetServer",
                    databaseName: "$params.targetDatabaseName",
                },
            },
            {
                id: "preview",
                label: "Preview DACPAC deployment",
                kind: "activity",
                activityKind: "dacpac.deploy.preview",
                inputs: {
                    dacpac: "$nodes.extract.artifactPath",
                    database: "$nodes.provision.connectionRef",
                },
            },
            {
                id: "approve-deploy",
                label: `Approve deployment to ${names.target}`,
                kind: "gate",
            },
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
            { id: "report", label: "Summarize deployment", kind: "report" },
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
    return parseCompiledProposal(JSON.stringify(proposal), base, intent);
}

function extractDacpacRoundTripDatabaseNames(
    intent: string,
): { source: string; target: string } | undefined {
    const identifier = String.raw`(\[[^\]\r\n]{1,128}\]|[A-Za-z_][A-Za-z0-9_$#@-]{0,127})`;
    const sourcePatterns = [
        new RegExp(
            String.raw`\b(?:extract|exact)\s+(?:database\s+)?${identifier}\s+(?:database\s+)?(?:to|into|as)\s+(?:an?\s+)?dacpac\b`,
            "i",
        ),
        new RegExp(
            String.raw`\b(?:extract|create|generate|make)\s+(?:an?\s+)?dacpac\s+(?:from|of)\s+(?:database\s+)?${identifier}`,
            "i",
        ),
        new RegExp(String.raw`\bdacpac\s+from\s+(?:database\s+)?${identifier}`, "i"),
    ];
    const targetPatterns = [
        new RegExp(String.raw`\bname\s+(?:it|the\s+(?:target\s+)?database)\s+${identifier}`, "i"),
        // Prefer explicit naming/preposition forms. This deliberately skips
        // an earlier phrase such as "back to server" in
        // "deploy it back to server as WWI_2".
        new RegExp(
            String.raw`\b(?:deploy|publish|import)\b[^.\r\n]{0,100}?\b(?:as|into)\s+(?:database\s+)?${identifier}`,
            "i",
        ),
        new RegExp(
            String.raw`\b(?:deploy|publish|import)\b[^.\r\n]{0,100}?\bto\s+(?:database\s+)?${identifier}`,
            "i",
        ),
    ];
    const source = sourcePatterns.map((pattern) => pattern.exec(intent)?.[1]).find(Boolean);
    const target = targetPatterns.map((pattern) => pattern.exec(intent)?.[1]).find(Boolean);
    if (!source || !target) {
        return undefined;
    }
    const normalizedSource = unwrapIdentifier(source);
    const normalizedTarget = unwrapIdentifier(target);
    if (
        !isValidDacpacSourceDatabaseName(normalizedSource) ||
        !isValidLocalDevelopmentDatabaseName(normalizedTarget)
    ) {
        return undefined;
    }
    return { source: normalizedSource, target: normalizedTarget };
}

function extractRepresentativeLoggingTable(
    intent: string,
): { schema: string; table: string } | undefined {
    if (!/\b(?:representative\s+)?(?:logging|log|audit)\s+table\b/i.test(intent)) {
        return undefined;
    }
    const part = String.raw`(?:\[[^\]\r\n]{1,128}\]|[A-Za-z_][A-Za-z0-9_$#@-]{0,127})`;
    const qualified = String.raw`(${part})(?:\s*\.\s*(${part}))?`;
    const patterns = [
        new RegExp(String.raw`\btable\b[^\r\n]{0,100}?\bthat\s+is\s+${qualified}`, "i"),
        new RegExp(String.raw`\btable\b[^\r\n]{0,60}?\b(?:named|called)\s+${qualified}`, "i"),
    ];
    const match = patterns.map((pattern) => pattern.exec(intent)).find(Boolean);
    if (!match) {
        return undefined;
    }
    const first = unwrapIdentifier(match[1]);
    const second = match[2] ? unwrapIdentifier(match[2]) : undefined;
    const schema = second ? first : "dbo";
    const table = second ?? first;
    if (
        !/^[A-Za-z_][A-Za-z0-9_$#@-]{0,127}$/.test(schema) ||
        !/^[A-Za-z_][A-Za-z0-9_$#@-]{0,127}$/.test(table)
    ) {
        return undefined;
    }
    return { schema, table };
}

function buildRepresentativeLoggingTableSql(schema: string, table: string): string {
    const qualified = `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
    const constraintStem = table.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 100);
    return [
        `CREATE TABLE ${qualified} (`,
        `    [LogId] bigint IDENTITY(1,1) NOT NULL CONSTRAINT ${quoteSqlIdentifier(`PK_${constraintStem}`)} PRIMARY KEY,`,
        `    [LoggedAtUtc] datetime2(7) NOT NULL CONSTRAINT ${quoteSqlIdentifier(`DF_${constraintStem}_LoggedAtUtc`)} DEFAULT (SYSUTCDATETIME()),`,
        "    [Level] nvarchar(32) NOT NULL,",
        "    [Message] nvarchar(4000) NOT NULL,",
        "    [Category] nvarchar(256) NULL,",
        "    [CorrelationId] uniqueidentifier NULL,",
        "    [PropertiesJson] nvarchar(max) NULL",
        ");",
    ].join("\n");
}

function quoteSqlIdentifier(value: string): string {
    return `[${value.replace(/]/g, "]]")}]`;
}

function unwrapIdentifier(value: string): string {
    return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

export function buildCompilePrompt(
    intent: string,
    previousError?: string,
    family: NonNullable<RunbookArtifactFile["family"]> = "investigate",
): string {
    return [
        "You compile a database developer's intent into a runbook execution plan.",
        "Respond with ONE JSON object only — no prose, no markdown fences.",
        "",
        "Available activities (you may ONLY use these — nothing else):",
        describeCatalogForPrompt(),
        "",
        describePlannerContract(family),
        "",
        'Node kinds: "activity" (uses an activity above), "gate" (pauses for human approval — include one only when the intent implies a consequential/approval step), "report" (final summary; every plan ends with exactly one report node, no inputs).',
        "Bind syntax: $params.<parameterId> references a parameter; $nodes.<nodeId>.<value> references a produced value.",
        'Every plan that queries a pre-existing SQL target needs exactly one parameter of type "connection". Parameter types: connection, string, int, boolean, enum, secret. A container password must be a required secret parameter with no default.',
        'Edges connect node ids; optional "when": success | failure | approved | rejected. Default (no when) is the success path.',
        "Inputs marked sql must be one read-only SELECT (or WITH...SELECT). Inputs marked ddl must be exactly one complete CREATE TABLE statement. Never place mutation SQL in any other input.",
        "",
        "JSON shape:",
        '{ "name": string, "description": string,',
        '  "parameters": [{ "id": string, "label": string, "type": string, "required"?: boolean, "default"?: string|number|boolean, "enumValues"?: string[] }],',
        '  "entryNodeId": string,',
        '  "nodes": [{ "id": string, "label": string, "kind": "activity"|"gate"|"report", "activityKind"?: string, "inputs"?: object }],',
        '  "edges": [{ "from": string, "to": string, "when"?: string }] }',
        "",
        'Example — intent: "Check that the Orders table stays under 1 million rows":',
        '{ "name": "Orders row-count check", "description": "Verifies Orders stays under a configured limit.",',
        '  "parameters": [ { "id": "target", "label": "Target connection", "type": "connection", "required": true },',
        '                  { "id": "maxRows", "label": "Maximum rows", "type": "int", "default": 1000000 } ],',
        '  "entryNodeId": "query",',
        '  "nodes": [ { "id": "query", "label": "Count Orders rows", "kind": "activity", "activityKind": "sql.query.read",',
        '               "inputs": { "connection": "$params.target", "sql": "SELECT COUNT(*) AS OrderCount FROM dbo.Orders" } },',
        '             { "id": "limit", "label": "Assert under limit", "kind": "activity", "activityKind": "assert.threshold",',
        '               "inputs": { "value": "$nodes.query.rowCount", "max": "$params.maxRows" } },',
        '             { "id": "report", "label": "Summarize", "kind": "report" } ],',
        '  "edges": [ { "from": "query", "to": "limit" }, { "from": "limit", "to": "report" } ] }',
        "",
        ...(previousError
            ? [
                  `Your previous response was rejected: ${previousError}. Produce a corrected JSON object.`,
                  "",
              ]
            : []),
        `Intent: ${intent}`,
    ].join("\n");
}

// ---------------------------------------------------------------------------
// vscode.lm invocation
// ---------------------------------------------------------------------------

export async function compileIntentWithModel(
    base: RunbookArtifactFile,
    intent: string,
    context: RunbookOperationContext,
    token?: vscode.CancellationToken,
): Promise<{ artifact?: RunbookArtifactFile; error?: RbsError }> {
    Perf.marker("mssql.runbookStudio.compile.begin", "begin", undefined, context.traceId);
    const end = (outcome: string, nodeCount = 0) =>
        Perf.marker(
            "mssql.runbookStudio.compile.end",
            "end",
            { outcome, nodeCount, modelRole: "compiler" },
            context.traceId,
        );

    const deterministicWorkload = compileDeterministicCitiesWorkload(base, intent);
    if (deterministicWorkload && !isProposalFailure(deterministicWorkload)) {
        emitRunbookEvent(context, "runbookStudio.compile.accepted", "ok", {
            compiler: metaField("deterministicCitiesWorkload"),
            nodeCount: metaField(deterministicWorkload.artifact.lock?.nodes.length ?? 0),
            parameterCount: metaField(deterministicWorkload.artifact.source.parameters.length),
        });
        end("ok", deterministicWorkload.artifact.lock?.nodes.length ?? 0);
        return { artifact: deterministicWorkload.artifact };
    }
    if (deterministicWorkload && isProposalFailure(deterministicWorkload)) {
        emitRunbookEvent(context, "runbookStudio.compile.rejected", "warning", {
            compiler: metaField("deterministicCitiesWorkload"),
            reasonClass: metaField(deterministicWorkload.detail.slice(0, 80)),
        });
    }

    const deterministicEvolution = compileDeterministicDacpacEvolution(base, intent);
    if (deterministicEvolution && !isProposalFailure(deterministicEvolution)) {
        emitRunbookEvent(context, "runbookStudio.compile.accepted", "ok", {
            compiler: metaField("deterministicDacpacEvolution"),
            nodeCount: metaField(deterministicEvolution.artifact.lock?.nodes.length ?? 0),
            parameterCount: metaField(deterministicEvolution.artifact.source.parameters.length),
        });
        end("ok", deterministicEvolution.artifact.lock?.nodes.length ?? 0);
        return { artifact: deterministicEvolution.artifact };
    }
    if (deterministicEvolution && isProposalFailure(deterministicEvolution)) {
        emitRunbookEvent(context, "runbookStudio.compile.rejected", "warning", {
            compiler: metaField("deterministicDacpacEvolution"),
            reasonClass: metaField(deterministicEvolution.detail.slice(0, 80)),
        });
    }

    const deterministic = compileDeterministicDacpacInventory(base, intent);
    if (deterministic && !isProposalFailure(deterministic)) {
        emitRunbookEvent(context, "runbookStudio.compile.accepted", "ok", {
            compiler: metaField("deterministicDacpacInventory"),
            nodeCount: metaField(deterministic.artifact.lock?.nodes.length ?? 0),
            parameterCount: metaField(deterministic.artifact.source.parameters.length),
        });
        end("ok", deterministic.artifact.lock?.nodes.length ?? 0);
        return { artifact: deterministic.artifact };
    }
    if (deterministic && isProposalFailure(deterministic)) {
        emitRunbookEvent(context, "runbookStudio.compile.rejected", "warning", {
            compiler: metaField("deterministicDacpacInventory"),
            reasonClass: metaField(deterministic.detail.slice(0, 80)),
        });
    }

    let models: vscode.LanguageModelChat[] = [];
    try {
        models = await vscode.lm.selectChatModels({ vendor: "copilot" });
        if (models.length === 0) {
            models = await vscode.lm.selectChatModels({});
        }
    } catch {
        models = [];
    }
    const model = models[0];
    if (!model) {
        end("modelUnavailable");
        return {
            error: {
                code: "RunbookStudio.ModelUnavailable",
                message: LocRunbookStudio.compileModelUnavailable,
            },
        };
    }

    let previousError: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
        Perf.marker(
            "mssql.runbookStudio.model.request.begin",
            "begin",
            { modelRole: "compiler" },
            context.traceId,
        );
        let responseText = "";
        try {
            const response = await model.sendRequest(
                [
                    vscode.LanguageModelChatMessage.User(
                        buildCompilePrompt(intent, previousError, base.family ?? "investigate"),
                    ),
                ],
                {},
                token,
            );
            for await (const chunk of response.text) {
                responseText += chunk;
            }
            Perf.marker(
                "mssql.runbookStudio.model.request.end",
                "end",
                {
                    modelRole: "compiler",
                    outcome: "ok",
                    modelVendor: model.vendor,
                    modelFamily: model.family,
                    modelId: model.id,
                },
                context.traceId,
            );
        } catch (error) {
            Perf.marker(
                "mssql.runbookStudio.model.request.end",
                "end",
                { modelRole: "compiler", outcome: "error" },
                context.traceId,
            );
            end("modelError");
            const denied =
                error instanceof vscode.LanguageModelError &&
                (error.code === "NoPermissions" || error.code === "Blocked");
            return {
                error: {
                    code: denied ? "RunbookStudio.ModelDenied" : "RunbookStudio.ModelUnavailable",
                    message: denied
                        ? LocRunbookStudio.compileModelDenied
                        : LocRunbookStudio.compileModelUnavailable,
                    retryable: !denied,
                },
            };
        }

        const parsed = parseCompiledProposal(responseText, base, intent);
        if (!isProposalFailure(parsed)) {
            emitRunbookEvent(context, "runbookStudio.compile.accepted", "ok", {
                attempt: metaField(attempt),
                nodeCount: metaField(parsed.artifact.lock?.nodes.length ?? 0),
                parameterCount: metaField(parsed.artifact.source.parameters.length),
            });
            end("ok", parsed.artifact.lock?.nodes.length ?? 0);
            return { artifact: parsed.artifact };
        }
        emitRunbookEvent(context, "runbookStudio.compile.rejected", "warning", {
            attempt: metaField(attempt),
            reasonClass: metaField(parsed.detail.slice(0, 80)),
        });
        previousError = parsed.detail;
    }
    end("invalid");
    return {
        error: {
            code: "RunbookStudio.CompileInvalid",
            message: LocRunbookStudio.compileInvalid(previousError ?? ""),
            retryable: true,
        },
    };
}
