/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Registered activity catalog (the compile guardrail): the plan compiler may
 * PROPOSE only from this catalog, and admission re-validates every compiled
 * plan against it — a model can never invent an activity, an input, or a
 * safety classification (A1 §5 / vision doc "the model proposes from an
 * activity catalog"). Pure module — no vscode imports.
 */

import * as crypto from "crypto";
import {
    BlastRadius,
    CompiledRunbookLock,
    RunbookPlanNode,
    RunbookPlanTarget,
    RunbookTargetKind,
} from "../../sharedInterfaces/runbookStudio";
import type { OutputSchemaDescriptor } from "../../sharedInterfaces/runbookPresentation";
import { isReadOnlySql } from "../readOnlySql";
import { validateLocalCreateTableSql } from "../schemaMutationPolicy";

export interface ActivityInputDescriptor {
    name: string;
    /** "bind" accepts $params.X / $nodes.X.Y; "sql" is read-only;
     * "ddl" is admitted only by the registered mutation policy. */
    kind: "string" | "bind" | "sql" | "ddl";
    required: boolean;
    description: string;
}

export interface ActivityDescriptor {
    kind: string;
    version: number;
    label: string;
    description: string;
    inputs: ActivityInputDescriptor[];
    /** Data contract of the primary output. */
    outputContract: string;
    /** Optional authoring-time field shape. Omit for outputs such as
     * arbitrary SQL rowsets whose columns exist only after execution. */
    outputSchema?: OutputSchemaDescriptor;
    /** Values other nodes can bind to ($nodes.<id>.<value>). */
    producedValues: string[];
    /** Requires one unambiguous incoming approved edge from a gate. */
    approvalRequired?: boolean;
    /** Target semantics are catalog authority, not model-authored metadata.
     * `bindingInput` must be a parameter or upstream-output binding. */
    target?:
        | { kind: RunbookTargetKind; bindingInput: string }
        | { kind: "workspace"; workspace: true };
    /** Preview-only activities are executable solely by the deterministic
     * fake lane until their production executor and recovery protocol land. */
    previewOnly?: boolean;
    blastRadius: BlastRadius;
}

const READ_ONLY_LOCAL: BlastRadius = {
    resource: "none",
    operation: "read",
    targetEnvironment: "local",
    reversibility: "noEffect",
};

export const ACTIVITY_CATALOG: ActivityDescriptor[] = [
    {
        kind: "workspace.inspect",
        version: 1,
        label: "Inspect database workspace",
        description:
            "Produces a bounded snapshot of database-project inputs in the open VS Code workspace without changing files.",
        inputs: [],
        outputContract: "workspaceSnapshot/1",
        // Project selection is deliberately not a produced binding: a
        // multi-project workspace must never silently pick the first target.
        producedValues: ["projectCount"],
        target: { kind: "workspace", workspace: true },
        blastRadius: { ...READ_ONLY_LOCAL, resource: "workspaceFiles" },
    },
    {
        kind: "git.change-set.inspect",
        version: 1,
        label: "Capture Git change set",
        description:
            "Resolves two refs in an explicitly bound trusted workspace repository and retains a bounded unified patch without changing the checkout.",
        inputs: [
            {
                name: "repository",
                kind: "bind",
                required: true,
                description: "Workspace-contained Git repository root",
            },
            {
                name: "baseRef",
                kind: "bind",
                required: true,
                description: "Base branch, tag, or commit",
            },
            {
                name: "headRef",
                kind: "bind",
                required: true,
                description: "Head branch, tag, or commit",
            },
            {
                name: "includeWorkingTree",
                kind: "bind",
                required: true,
                description:
                    "Include the current checked-out working tree when head resolves to HEAD",
            },
        ],
        outputContract: "gitChangeSet/1",
        outputSchema: {
            fields: [
                { name: "status", valueType: "string", roles: ["category"] },
                { name: "path", valueType: "string", roles: ["label"] },
                { name: "previousPath", valueType: "string" },
                { name: "entityRelated", valueType: "boolean" },
            ],
        },
        producedValues: [
            "artifactPath",
            "artifactSha256",
            "changedFileCount",
            "entityRelatedFileCount",
            "baseCommit",
            "headCommit",
            "mergeBase",
            "dirty",
        ],
        target: { kind: "workspace", bindingInput: "repository" },
        blastRadius: { ...READ_ONLY_LOCAL, resource: "workspaceFiles" },
    },
    {
        kind: "ef.project.discover",
        version: 1,
        label: "Discover Entity Framework projects",
        description:
            "Inventories bounded project metadata, DbContext declarations, providers, and entity-related source counts in the trusted workspace without restoring or loading project code.",
        inputs: [],
        outputContract: "efProjectDiscovery/1",
        outputSchema: {
            fields: [
                { name: "project", valueType: "string", roles: ["label"] },
                { name: "targetFrameworks", valueType: "string" },
                { name: "providers", valueType: "string", roles: ["category"] },
                { name: "dbContexts", valueType: "string" },
                { name: "entitySourceFiles", valueType: "number", roles: ["measure"] },
                { name: "truncated", valueType: "boolean" },
            ],
        },
        producedValues: [
            "projectCount",
            "dbContextCount",
            "providerCount",
            "entitySourceFileCount",
            "truncated",
        ],
        target: { kind: "workspace", workspace: true },
        blastRadius: { ...READ_ONLY_LOCAL, resource: "workspaceFiles" },
    },
    {
        kind: "sqltest.discover",
        version: 1,
        label: "Discover repository SQL tests",
        description:
            "Scans bounded workspace SQL sources for repository-owned tSQLt classes and test procedures without executing database code.",
        inputs: [],
        outputContract: "testSuiteDiscovery/1",
        outputSchema: {
            fields: [
                { name: "framework", valueType: "string", roles: ["category"] },
                { name: "suite", valueType: "string", roles: ["category"] },
                { name: "test", valueType: "string", roles: ["label"] },
                { name: "repositoryPath", valueType: "string" },
                { name: "line", valueType: "number" },
            ],
        },
        producedValues: ["tSqltClassCount", "tSqltTestCount", "complete"],
        target: { kind: "workspace", workspace: true },
        blastRadius: { ...READ_ONLY_LOCAL, resource: "workspaceFiles" },
    },
    {
        kind: "dacpac.build",
        version: 1,
        label: "Build DACPAC",
        description:
            "Builds the explicitly bound SQL database project through the native VS Code SQL project task and records typed artifact evidence.",
        inputs: [
            {
                name: "project",
                kind: "bind",
                required: true,
                description: "Database-project path binding",
            },
        ],
        outputContract: "dacpacArtifact/1",
        producedValues: ["artifactPath", "artifactSha256", "diagnosticCount"],
        target: { kind: "databaseProject", bindingInput: "project" },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "create",
            targetEnvironment: "local",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "dacpac.extract",
        version: 2,
        label: "Extract database DACPAC",
        description:
            "Extracts a DACPAC from the explicitly bound database through DacFx and retains it as a hashed Runbook Studio artifact.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Saved connection profile for the source SQL Server",
            },
            {
                name: "databaseName",
                kind: "string",
                required: true,
                description:
                    "Exact source database name stated by the user, as a literal or string parameter binding",
            },
        ],
        outputContract: "dacpacArtifact/1",
        producedValues: ["artifactPath", "artifactSha256", "databaseName"],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "create",
            targetEnvironment: "development",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "sandbox.provision",
        version: 1,
        label: "Provision disposable local SQL database",
        description:
            "Creates an ownership-marked database on an explicitly bound loopback SQL Server and records a durable cleanup lease.",
        inputs: [
            {
                name: "sandbox",
                kind: "bind",
                required: true,
                description: "Saved localhost SQL Server connection profile",
            },
        ],
        outputContract: "databaseLease/1",
        producedValues: ["connectionRef", "leaseId"],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "sandbox" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "provision",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "devdatabase.provision",
        version: 1,
        label: "Provision named local development database",
        description:
            "Creates an absent, explicitly named database on a bound loopback SQL Server and retains an ownership-verified development lease.",
        inputs: [
            {
                name: "server",
                kind: "bind",
                required: true,
                description: "Saved localhost SQL Server connection profile",
            },
            {
                name: "databaseName",
                kind: "bind",
                required: true,
                description: "Explicit name for a new development database",
            },
        ],
        outputContract: "databaseLease/1",
        producedValues: ["connectionRef", "leaseId", "databaseName"],
        approvalRequired: true,
        target: { kind: "sqlDatabase", bindingInput: "server" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "provision",
            targetEnvironment: "development",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "sql.workload.generate",
        version: 1,
        label: "Generate sampled SQL workload",
        description:
            "Samples a closed allowlisted source table through the SQL data plane and retains a reviewable workload that runs only against an owned target.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Saved source server connection",
            },
            {
                name: "sourceDatabaseName",
                kind: "bind",
                required: true,
                description: "Explicit source database containing Application.Cities",
            },
            {
                name: "template",
                kind: "bind",
                required: true,
                description: "Allowlisted template: application-cities-shadow",
            },
            {
                name: "sampleRows",
                kind: "bind",
                required: false,
                description: "Source sample size from 10 to 20 rows (default 20)",
            },
            {
                name: "iterations",
                kind: "bind",
                required: false,
                description: "Insert/delete loop iterations from 1 to 1000 (default 1000)",
            },
        ],
        outputContract: "workloadArtifact/1",
        producedValues: [
            "workloadRef",
            "workloadSha256",
            "artifactPath",
            "sampleRowCount",
            "iterations",
            "workloadFingerprint",
        ],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "create",
            targetEnvironment: "development",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "sql.workload.inspect",
        version: 1,
        label: "Inspect trusted SQL workload",
        description:
            "Reads one workspace-contained .sql file, applies bounded SQLCMD/GO parsing and policy classification, and snapshots an immutable in-memory workload reference for approval.",
        inputs: [
            {
                name: "file",
                kind: "bind",
                required: true,
                description: "Explicit workspace-contained .sql workload file",
            },
        ],
        outputContract: "workloadPreview/1",
        producedValues: [
            "workloadRef",
            "workloadSha256",
            "workloadFingerprint",
            "batchCount",
            "mutating",
        ],
        target: { kind: "workspace", workspace: true },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "read",
            targetEnvironment: "local",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "sql.container.provision",
        version: 1,
        label: "Provision owned local SQL container",
        description:
            "Creates an absent ownership-labeled local SQL Server container with bounded resources, waits for readiness, creates the requested disposable database, and returns an opaque cleanup lease.",
        inputs: [
            {
                name: "containerName",
                kind: "bind",
                required: true,
                description: "Explicit unique name beginning with rbs-",
            },
            {
                name: "databaseName",
                kind: "bind",
                required: true,
                description: "Explicit non-system database name to create inside the container",
            },
            {
                name: "version",
                kind: "bind",
                required: true,
                description: "Allowlisted SQL Server image version: 2019, 2022, or 2025",
            },
            {
                name: "password",
                kind: "bind",
                required: true,
                description: "Bind to a required secret parameter; never persisted in the plan",
            },
            {
                name: "port",
                kind: "bind",
                required: false,
                description: "Optional host port from 1024 to 65535; defaults to an available port",
            },
        ],
        outputContract: "databaseLease/1",
        producedValues: [
            "connectionRef",
            "leaseId",
            "databaseName",
            "containerName",
            "port",
            "version",
            "imageDigest",
            "environmentFingerprint",
        ],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "databaseName" },
        blastRadius: {
            resource: "container",
            operation: "provision",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "dacpac.deploy.preview",
        version: 1,
        label: "Preview DACPAC deployment",
        description:
            "Generates a read-only DacFx deployment report for an explicitly bound SQL database without applying changes.",
        inputs: [
            {
                name: "dacpac",
                kind: "bind",
                required: true,
                description: "Bind to a dacpac.build artifactPath",
            },
            {
                name: "database",
                kind: "bind",
                required: true,
                description:
                    "Bind to a saved connection parameter or sandbox.provision connectionRef",
            },
        ],
        outputContract: "deploymentPreview/1",
        producedValues: ["changeCount", "reportSha256"],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "read",
            targetEnvironment: "development",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "dacpac.deploy",
        version: 1,
        label: "Deploy DACPAC to disposable database",
        description:
            "Applies the exact approved DACPAC preview only to an ownership-verified Runbook Studio localhost lease.",
        inputs: [
            {
                name: "dacpac",
                kind: "bind",
                required: true,
                description: "Bind to a dacpac.build artifactPath",
            },
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sandbox.provision connectionRef",
            },
            {
                name: "artifactDigest",
                kind: "bind",
                required: true,
                description: "Bind to the approved dacpac.build artifactSha256",
            },
            {
                name: "previewDigest",
                kind: "bind",
                required: true,
                description: "Bind to the approved dacpac.deploy.preview reportSha256",
            },
        ],
        outputContract: "deploymentEvidence/1",
        producedValues: ["deployed", "postDeployChangeCount", "artifactSha256"],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "modify",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "dacpac.deploy.dev",
        version: 1,
        label: "Deploy DACPAC to owned development database",
        description:
            "Applies the exact approved DACPAC preview only to an ownership-verified, absent-target-created named local development database.",
        inputs: [
            {
                name: "dacpac",
                kind: "bind",
                required: true,
                description: "Bind to a dacpac.build or dacpac.extract artifactPath",
            },
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a devdatabase.provision connectionRef",
            },
            {
                name: "artifactDigest",
                kind: "bind",
                required: true,
                description: "Bind to the approved DACPAC artifactSha256",
            },
            {
                name: "previewDigest",
                kind: "bind",
                required: true,
                description: "Bind to the approved dacpac.deploy.preview reportSha256",
            },
        ],
        outputContract: "deploymentEvidence/1",
        producedValues: ["deployed", "postDeployChangeCount", "artifactSha256"],
        approvalRequired: true,
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "modify",
            targetEnvironment: "development",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "dacpac.deploy.container",
        version: 1,
        label: "Deploy DACPAC to owned SQL container",
        description:
            "Applies the exact approved DACPAC preview only to a same-run ownership-labeled local SQL container lease.",
        inputs: [
            {
                name: "dacpac",
                kind: "bind",
                required: true,
                description: "Bind to a dacpac.build or dacpac.extract artifactPath",
            },
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sql.container.provision connectionRef",
            },
            {
                name: "artifactDigest",
                kind: "bind",
                required: true,
                description: "Bind to the approved DACPAC artifactSha256",
            },
            {
                name: "previewDigest",
                kind: "bind",
                required: true,
                description: "Bind to the approved dacpac.deploy.preview reportSha256",
            },
        ],
        outputContract: "deploymentEvidence/1",
        producedValues: ["deployed", "postDeployChangeCount", "artifactSha256"],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "modify",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "xevent.session.start",
        version: 1,
        label: "Start owned developer XEvent session",
        description:
            "Starts one ownership-derived, bounded event-file session on a same-run SQL container using the closed developer-diagnostics template.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sql.container.provision connectionRef",
            },
            {
                name: "template",
                kind: "bind",
                required: true,
                description: "Allowlisted template: developer-diagnostics",
            },
            {
                name: "maxFileSizeMb",
                kind: "bind",
                required: false,
                description: "Bounded XEL target size from 1 to 64 MiB (default 16)",
            },
        ],
        outputContract: "xeventSessionLease/1",
        producedValues: ["sessionRef", "sessionName", "template"],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "container",
            operation: "create",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "sql.workload.run",
        version: 1,
        label: "Run approved SQL workload",
        description:
            "Executes the exact inspected workload snapshot sequentially against a same-run owned SQL container with bounded repetitions, timeout, cancellation, and typed measurements.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sql.container.provision connectionRef",
            },
            {
                name: "workload",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.inspect workloadRef",
            },
            {
                name: "workloadDigest",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.inspect workloadSha256",
            },
            {
                name: "repetitions",
                kind: "bind",
                required: false,
                description: "Whole-workload repetitions from 1 to 100 (default 1)",
            },
            {
                name: "timeoutSeconds",
                kind: "bind",
                required: false,
                description: "Per-batch timeout from 1 to 3600 seconds (default 300)",
            },
        ],
        outputContract: "workloadResults/1",
        outputSchema: {
            fields: [
                { name: "iteration", valueType: "number", roles: ["category"] },
                { name: "batch", valueType: "number", roles: ["category"] },
                { name: "durationMs", valueType: "number", roles: ["measure"] },
                { name: "rowCount", valueType: "number", roles: ["measure"] },
                { name: "succeeded", valueType: "boolean" },
                { name: "errorCode", valueType: "string" },
            ],
        },
        producedValues: [
            "succeeded",
            "executedBatchCount",
            "failedBatchCount",
            "totalDurationMs",
            "repetitions",
            "measurementSampleCount",
            "meanDurationMs",
            "p50DurationMs",
            "p95DurationMs",
            "minDurationMs",
            "maxDurationMs",
            "standardDeviationMs",
        ],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseData",
            operation: "execute",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "xevent.session.stop",
        version: 1,
        label: "Stop owned developer XEvent session",
        description:
            "Stops and removes the exact session created by an upstream xevent.session.start activity and issues an opaque capture reference.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to the same sql.container.provision connectionRef",
            },
            {
                name: "session",
                kind: "bind",
                required: true,
                description: "Bind to xevent.session.start sessionRef",
            },
        ],
        outputContract: "xeventCapture/1",
        producedValues: ["captureRef", "sessionName", "eventFileName", "eventCount"],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "container",
            operation: "delete",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "xevent.xel.collect",
        version: 1,
        label: "Collect owned XEL artifact",
        description:
            "Copies the exact bounded event file from an owned local SQL container into extension-managed storage and verifies its size and SHA-256.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to the same sql.container.provision connectionRef",
            },
            {
                name: "capture",
                kind: "bind",
                required: true,
                description: "Bind to xevent.session.stop captureRef",
            },
        ],
        outputContract: "xelArtifact/1",
        producedValues: [
            "artifactPath",
            "artifactSha256",
            "artifactSizeBytes",
            "eventCount",
            "captureComplete",
        ],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "create",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "xevent.xel.analyze",
        version: 1,
        label: "Analyze owned XEvent trace",
        description:
            "Reads the exact retained XEL through the SQL data plane, correlates events to this run's workload application name, and emits bounded server activity rows without SQL text.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to the same sql.container.provision connectionRef",
            },
            {
                name: "capture",
                kind: "bind",
                required: true,
                description: "Bind to xevent.session.stop captureRef",
            },
        ],
        outputContract: "xeventAnalysis/1",
        outputSchema: {
            fields: [
                { name: "timestampUtc", valueType: "dateTime", roles: ["time"] },
                { name: "eventName", valueType: "string", roles: ["category"] },
                { name: "durationMs", valueType: "number", roles: ["measure"] },
                { name: "cpuMs", valueType: "number", roles: ["measure"] },
                { name: "logicalReads", valueType: "number", roles: ["measure"] },
                { name: "physicalReads", valueType: "number", roles: ["measure"] },
                { name: "writes", valueType: "number", roles: ["measure"] },
                { name: "rowCount", valueType: "number", roles: ["measure"] },
                { name: "objectName", valueType: "string" },
                { name: "errorNumber", valueType: "number" },
            ],
        },
        producedValues: [
            "eventCount",
            "durationMs",
            "cpuMs",
            "logicalReads",
            "physicalReads",
            "writes",
        ],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseData",
            operation: "read",
            targetEnvironment: "ephemeral",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "performance.dmv.snapshot",
        version: 1,
        label: "Capture SQL Server performance snapshot",
        description:
            "Runs a closed bounded SQL Data Plane collector on the same-run owned SQL container and emits database IO, space, cumulative wait/query counters, active blocking/request facts, and server uptime without SQL text or application data.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to sql.container.provision connectionRef",
            },
        ],
        outputContract: "performanceSnapshot/1",
        outputSchema: {
            fields: [
                { name: "capturedAtUtc", valueType: "dateTime", roles: ["time"] },
                { name: "scope", valueType: "string", roles: ["category"] },
                { name: "category", valueType: "string", roles: ["category"] },
                { name: "item", valueType: "string", roles: ["label"] },
                { name: "metric", valueType: "string", roles: ["category"] },
                { name: "value", valueType: "number", roles: ["measure"] },
                { name: "unit", valueType: "string" },
            ],
        },
        producedValues: [
            "capturedAtUtc",
            "metricCount",
            "totalMetricCount",
            "snapshotSha256",
            "truncated",
        ],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseData",
            operation: "read",
            targetEnvironment: "ephemeral",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "workload.benchmark",
        version: 1,
        label: "Summarize workload performance",
        description:
            "Combines measured workload and optional correlated XEvent totals into a deterministic performance metrics grid.",
        inputs: [
            {
                name: "workloadFingerprint",
                kind: "bind",
                required: true,
                description:
                    "Bind to sql.workload.generate or sql.workload.inspect workloadFingerprint",
            },
            {
                name: "environmentFingerprint",
                kind: "bind",
                required: true,
                description: "Bind to sql.container.provision environmentFingerprint",
            },
            {
                name: "workloadDurationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run totalDurationMs",
            },
            {
                name: "executedBatchCount",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run executedBatchCount",
            },
            {
                name: "failedBatchCount",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run failedBatchCount",
            },
            {
                name: "repetitions",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run repetitions",
            },
            {
                name: "measurementSampleCount",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run measurementSampleCount",
            },
            {
                name: "meanDurationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run meanDurationMs",
            },
            {
                name: "p50DurationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run p50DurationMs",
            },
            {
                name: "p95DurationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run p95DurationMs",
            },
            {
                name: "minDurationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run minDurationMs",
            },
            {
                name: "maxDurationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run maxDurationMs",
            },
            {
                name: "standardDeviationMs",
                kind: "bind",
                required: true,
                description: "Bind to sql.workload.run standardDeviationMs",
            },
            {
                name: "xeventDurationMs",
                kind: "bind",
                required: false,
                description: "Optional xevent.xel.analyze durationMs",
            },
            {
                name: "xeventCpuMs",
                kind: "bind",
                required: false,
                description: "Optional xevent.xel.analyze cpuMs",
            },
            {
                name: "logicalReads",
                kind: "bind",
                required: false,
                description: "Optional xevent.xel.analyze logicalReads",
            },
            {
                name: "physicalReads",
                kind: "bind",
                required: false,
                description: "Optional xevent.xel.analyze physicalReads",
            },
            {
                name: "writes",
                kind: "bind",
                required: false,
                description: "Optional xevent.xel.analyze writes",
            },
        ],
        outputContract: "performanceMetrics/1",
        outputSchema: {
            fields: [
                { name: "metric", valueType: "string", roles: ["category", "label"] },
                { name: "value", valueType: "number", roles: ["measure"] },
                { name: "unit", valueType: "string" },
            ],
        },
        producedValues: [
            "durationMs",
            "executedBatchCount",
            "failedBatchCount",
            "workloadFingerprint",
            "environmentFingerprint",
            "repetitions",
            "measurementSampleCount",
            "meanDurationMs",
            "p50DurationMs",
            "p95DurationMs",
            "minDurationMs",
            "maxDurationMs",
            "standardDeviationMs",
        ],
        target: { kind: "workspace", workspace: true },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "read",
            targetEnvironment: "development",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "schema.compare",
        version: 1,
        label: "Verify deployed schema",
        description:
            "Regenerates a DacFx deployment report and succeeds only when the disposable target matches the DACPAC.",
        inputs: [
            {
                name: "dacpac",
                kind: "bind",
                required: true,
                description: "Bind to a dacpac.build artifactPath",
            },
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sandbox.provision connectionRef",
            },
        ],
        outputContract: "schemaDiff/1",
        producedValues: ["matches", "changeCount", "reportSha256"],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "read",
            targetEnvironment: "ephemeral",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "sql.schema.apply",
        version: 1,
        label: "Create table in owned development database",
        description:
            "Executes one reviewed CREATE TABLE statement transactionally against an ownership-verified named development database.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a devdatabase.provision connectionRef",
            },
            {
                name: "sql",
                kind: "ddl",
                required: true,
                description:
                    "One complete CREATE TABLE statement; include the exact table and column definitions requested",
            },
        ],
        outputContract: "schemaMutationEvidence/1",
        producedValues: ["applied", "tableName", "sqlSha256"],
        approvalRequired: true,
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "create",
            targetEnvironment: "development",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "schema.compare.export",
        version: 1,
        label: "Export schema comparison report",
        description:
            "Compares a DACPAC with an explicitly bound database, retains the deployment report, and produces a bounded object/script comparison document without treating expected differences as execution failure.",
        inputs: [
            {
                name: "dacpac",
                kind: "bind",
                required: true,
                description: "Bind to a dacpac.build or dacpac.extract artifactPath",
            },
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Saved connection profile or provisioned database reference",
            },
        ],
        outputContract: "schemaCompareDocument/1",
        producedValues: [
            "matches",
            "changeCount",
            "reportSha256",
            "artifactPath",
            "artifactSha256",
        ],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "workspaceFiles",
            operation: "create",
            targetEnvironment: "development",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "database.schema.visualize",
        version: 1,
        label: "Visualize database schema",
        description:
            "Loads a bounded MetadataStore catalog snapshot over the SQL data plane and emits a reusable read-only ER diagram document.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Saved connection profile or provisioned database reference",
            },
        ],
        outputContract: "databaseSchemaGraph/1",
        producedValues: ["totalTables", "renderedTables", "relationshipCount", "truncated"],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "read",
            targetEnvironment: "development",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "sqltest.run",
        version: 1,
        label: "Run SQL assertion suite",
        description:
            "Executes one bounded read-only query whose rows are typed test cases, and fails the run when any case fails.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description:
                    "Bind to a saved connection parameter or sandbox.provision connectionRef",
            },
            {
                name: "sql",
                kind: "sql",
                required: true,
                description:
                    "One read-only query returning test_name (or name), passed, and optional message columns",
            },
            {
                name: "timeoutSeconds",
                kind: "bind",
                required: false,
                description: "Execution timeout from 1 to 300 seconds (default 60)",
            },
        ],
        outputContract: "testResults/1",
        outputSchema: {
            fields: [
                { name: "name", valueType: "string", roles: ["label"] },
                { name: "passed", valueType: "boolean" },
                { name: "message", valueType: "string" },
            ],
        },
        producedValues: ["total", "passed", "failed", "allPassed"],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseData",
            operation: "read",
            targetEnvironment: "development",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "tsqlt.run",
        version: 1,
        label: "Run governed tSQLt suite",
        description:
            "Executes a host-authored tSQLt runner batch on an ownership-verified disposable database and captures typed per-test results.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sandbox.provision connectionRef from this run",
            },
            {
                name: "suite",
                kind: "bind",
                required: false,
                description: "Optional exact tSQLt class name; omission runs every class",
            },
            {
                name: "test",
                kind: "bind",
                required: false,
                description: "Optional exact tSQLt test name; requires suite",
            },
        ],
        outputContract: "testResults/1",
        outputSchema: {
            fields: [
                { name: "suite", valueType: "string", roles: ["category"] },
                { name: "test", valueType: "string", roles: ["label"] },
                { name: "result", valueType: "string" },
                { name: "message", valueType: "string" },
                { name: "durationMs", valueType: "number", roles: ["measure"] },
            ],
        },
        producedValues: ["total", "passed", "failed", "errors", "skipped", "allPassed"],
        approvalRequired: true,
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseData",
            operation: "execute",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
            breadth: "bounded",
        },
    },
    {
        kind: "sandbox.dispose",
        version: 1,
        label: "Dispose local SQL database lease",
        description:
            "Verifies an ownership-marked Runbook Studio lease, removes its generated database, and records durable cleanup evidence.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sandbox.provision connectionRef",
            },
        ],
        outputContract: "cleanupEvidence/1",
        producedValues: ["cleaned"],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "delete",
            targetEnvironment: "ephemeral",
            reversibility: "irreversible",
            breadth: "bounded",
        },
    },
    {
        kind: "sql.container.dispose",
        version: 1,
        label: "Dispose owned local SQL container",
        description:
            "Verifies the exact Runbook Studio owner labels, removes only that container, and records durable cleanup evidence.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Bind to a sql.container.provision connectionRef",
            },
        ],
        outputContract: "cleanupEvidence/1",
        producedValues: ["cleaned"],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "container",
            operation: "delete",
            targetEnvironment: "ephemeral",
            reversibility: "irreversible",
            breadth: "bounded",
        },
    },
    {
        kind: "database.schema.inventory",
        version: 1,
        label: "Inventory deployed schema objects",
        description:
            "Runs a closed bounded catalog query against an upstream deployed database and returns its user tables, views, and stored procedures as a typed grid.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description:
                    "Bind to the connectionRef of the upstream owned database provisioning activity",
            },
        ],
        outputContract: "databaseSchemaInventory/1",
        outputSchema: {
            fields: [
                { name: "ObjectType", valueType: "string", roles: ["category"] },
                { name: "SchemaName", valueType: "string", roles: ["category"] },
                { name: "ObjectName", valueType: "string", roles: ["label"] },
            ],
        },
        producedValues: ["objectCount", "truncated"],
        target: { kind: "sqlDatabase", bindingInput: "database" },
        blastRadius: {
            resource: "databaseSchema",
            operation: "read",
            targetEnvironment: "development",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "evidence.bundle",
        version: 1,
        label: "Assemble run evidence",
        description:
            "Builds a content-addressed, secret-safe manifest over completed node outcomes and durable result handles.",
        inputs: [],
        outputContract: "evidenceBundle/1",
        producedValues: ["bundleSha256", "nodeCount", "verdict"],
        target: { kind: "workspace", workspace: true },
        blastRadius: READ_ONLY_LOCAL,
    },
    {
        kind: "sql.query.read",
        version: 1,
        label: "Run read-only SQL query",
        description:
            "Executes a single read-only SELECT statement against the bound connection and returns the rowset.",
        inputs: [
            {
                name: "connection",
                kind: "bind",
                required: true,
                description: "Bind to a connection parameter, e.g. $params.target",
            },
            {
                name: "sql",
                kind: "sql",
                required: true,
                description: "One read-only SELECT (or WITH…SELECT) statement",
            },
        ],
        outputContract: "rowset/1",
        producedValues: ["rowCount"],
        target: { kind: "sqlDatabase", bindingInput: "connection" },
        blastRadius: { ...READ_ONLY_LOCAL, resource: "databaseData" },
    },
    {
        kind: "assert.threshold",
        version: 1,
        label: "Assert numeric threshold",
        description:
            "Fails the run when value exceeds max. Both inputs accept bind expressions or literals.",
        inputs: [
            {
                name: "value",
                kind: "bind",
                required: true,
                description: "Number or bind, e.g. $nodes.query.rowCount",
            },
            {
                name: "max",
                kind: "bind",
                required: true,
                description: "Number or bind, e.g. $params.maxCount",
            },
        ],
        outputContract: "scalarSet/1",
        producedValues: ["value", "max", "pass"],
        blastRadius: READ_ONLY_LOCAL,
    },
];

export function findActivity(kind: string | undefined): ActivityDescriptor | undefined {
    return ACTIVITY_CATALOG.find((a) => a.kind === kind);
}

/** Stable catalog fingerprint recorded into compiled locks. */
export function activityCatalogFingerprint(): string {
    const identity = ACTIVITY_CATALOG.map((a) => `${a.kind}@${a.version}`)
        .sort()
        .join(",");
    return "sha256:" + crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/**
 * Admission validation (beyond structural artifact validation): every
 * activity node must name a registered activity at a supported version with
 * its required inputs present. Model-authored metadata is never authority —
 * blast radius is REPLACED from the registered descriptor.
 */
export function validateLockAgainstCatalog(lock: CompiledRunbookLock): string[] {
    const issues: string[] = [];
    for (const node of lock.nodes) {
        if (node.kind !== "activity") {
            continue;
        }
        const descriptor = findActivity(node.activityKind);
        if (!descriptor) {
            issues.push(`node '${node.id}' uses unregistered activity '${node.activityKind}'`);
            continue;
        }
        if (node.activityVersion !== undefined && node.activityVersion !== descriptor.version) {
            issues.push(
                `node '${node.id}' pins ${descriptor.kind}@${node.activityVersion}; registered version is ${descriptor.version}`,
            );
        }
        for (const input of descriptor.inputs) {
            if (input.required && (node.inputs === undefined || !(input.name in node.inputs))) {
                issues.push(
                    `node '${node.id}' is missing required input '${input.name}' for ${descriptor.kind}`,
                );
            }
            if (input.kind === "sql" && node.inputs && input.name in node.inputs) {
                const sql = node.inputs[input.name];
                if (typeof sql !== "string" || !isReadOnlySql(sql)) {
                    issues.push(
                        `node '${node.id}' input '${input.name}' must be one read-only SELECT statement`,
                    );
                }
            }
            if (
                input.kind === "ddl" &&
                node.inputs &&
                input.name in node.inputs &&
                !validateLocalCreateTableSql(node.inputs[input.name])
            ) {
                issues.push(
                    `node '${node.id}' input '${input.name}' must be one bounded CREATE TABLE statement`,
                );
            }
        }
        if (descriptor.target) {
            const expectedTarget = targetFromCatalog(node, descriptor);
            if (!node.target) {
                issues.push(
                    `node '${node.id}' is missing its explicit ${descriptor.target.kind} target`,
                );
            } else if (!expectedTarget || !targetsEqual(node.target, expectedTarget)) {
                const targetSource =
                    "bindingInput" in descriptor.target
                        ? `catalog input '${descriptor.target.bindingInput}'`
                        : "the workspace binding";
                issues.push(`node '${node.id}' target does not match ${targetSource}`);
            }
            if (descriptor.target.kind === "ephemeralSqlDatabase") {
                const containerActivity =
                    descriptor.kind === "dacpac.deploy.container" ||
                    descriptor.kind === "xevent.session.start" ||
                    descriptor.kind === "sql.workload.run" ||
                    descriptor.kind === "xevent.session.stop" ||
                    descriptor.kind === "xevent.xel.analyze" ||
                    descriptor.kind === "xevent.xel.collect" ||
                    descriptor.kind === "performance.dmv.snapshot" ||
                    descriptor.kind === "sql.container.dispose";
                const producerKind = containerActivity
                    ? "sql.container.provision"
                    : "sandbox.provision";
                if (
                    descriptor.kind !== "sandbox.provision" &&
                    descriptor.kind !== "sql.container.provision" &&
                    !isOwnedDatabaseOutput(lock, node, producerKind)
                ) {
                    issues.push(
                        `node '${node.id}' must bind its disposable target to an upstream ${producerKind} connectionRef`,
                    );
                }
            }
            if (
                (descriptor.kind === "dacpac.deploy.dev" ||
                    descriptor.kind === "sql.schema.apply") &&
                !isOwnedDatabaseOutput(lock, node, "devdatabase.provision")
            ) {
                issues.push(
                    `node '${node.id}' must bind its development target to an upstream devdatabase.provision connectionRef`,
                );
            }
            if (
                descriptor.kind === "database.schema.inventory" &&
                !hasUpstreamDeploymentForSameTarget(lock, node)
            ) {
                issues.push(
                    `node '${node.id}' must inventory the same target as an upstream DACPAC deployment`,
                );
            }
            if (descriptor.kind === "sql.workload.run" && !isWorkloadSourceOutput(lock, node)) {
                issues.push(
                    `node '${node.id}' must bind workload and workloadDigest to the same upstream sql.workload.inspect or sql.workload.generate node`,
                );
            }
            if (
                descriptor.kind === "xevent.session.stop" &&
                !isUpstreamActivityOutput(
                    lock,
                    node,
                    "session",
                    "sessionRef",
                    "xevent.session.start",
                )
            ) {
                issues.push(
                    `node '${node.id}' must bind session to an upstream xevent.session.start sessionRef`,
                );
            }
            if (
                (descriptor.kind === "xevent.xel.collect" ||
                    descriptor.kind === "xevent.xel.analyze") &&
                !isUpstreamActivityOutput(
                    lock,
                    node,
                    "capture",
                    "captureRef",
                    "xevent.session.stop",
                )
            ) {
                issues.push(
                    `node '${node.id}' must bind capture to an upstream xevent.session.stop captureRef`,
                );
            }
        }
        if (descriptor.approvalRequired) {
            const approvingGates = lock.edges
                .filter((edge) => edge.to === node.id && edge.when === "approved")
                .map((edge) => lock.nodes.find((candidate) => candidate.id === edge.from))
                .filter((candidate) => candidate?.kind === "gate");
            const hasUnambiguousGate =
                approvingGates.length === 1 &&
                lock.edges.filter(
                    (edge) => edge.from === approvingGates[0]!.id && edge.when === "approved",
                ).length === 1;
            if (!hasUnambiguousGate) {
                issues.push(`node '${node.id}' requires one unambiguous incoming approved gate`);
            }
        }
    }
    return issues;
}

function isOwnedDatabaseOutput(
    lock: CompiledRunbookLock,
    node: RunbookPlanNode,
    producerKind: "sandbox.provision" | "devdatabase.provision" | "sql.container.provision",
): boolean {
    if (node.target?.binding.source !== "nodeOutput") {
        return false;
    }
    const binding = node.target.binding;
    const producer = lock.nodes.find((candidate) => candidate.id === binding.nodeId);
    if (
        producer?.kind !== "activity" ||
        producer.activityKind !== producerKind ||
        binding.output !== "connectionRef"
    ) {
        return false;
    }
    const visited = new Set<string>([producer.id]);
    const pending = [producer.id];
    while (pending.length > 0) {
        const current = pending.shift()!;
        for (const edge of lock.edges.filter((candidate) => candidate.from === current)) {
            if (edge.to === node.id) {
                return true;
            }
            if (!visited.has(edge.to)) {
                visited.add(edge.to);
                pending.push(edge.to);
            }
        }
    }
    return false;
}

function hasUpstreamDeploymentForSameTarget(
    lock: CompiledRunbookLock,
    node: RunbookPlanNode,
): boolean {
    if (node.target?.binding.source !== "nodeOutput") {
        return false;
    }
    const target = node.target.binding;
    return lock.nodes.some((candidate) => {
        if (
            candidate.kind !== "activity" ||
            !["dacpac.deploy", "dacpac.deploy.dev", "dacpac.deploy.container"].includes(
                candidate.activityKind ?? "",
            ) ||
            candidate.target?.binding.source !== "nodeOutput" ||
            candidate.target.binding.nodeId !== target.nodeId ||
            candidate.target.binding.output !== target.output
        ) {
            return false;
        }
        const visited = new Set<string>([candidate.id]);
        const pending = [candidate.id];
        while (pending.length > 0) {
            const current = pending.shift()!;
            for (const edge of lock.edges.filter((item) => item.from === current)) {
                if (edge.to === node.id) {
                    return true;
                }
                if (!visited.has(edge.to)) {
                    visited.add(edge.to);
                    pending.push(edge.to);
                }
            }
        }
        return false;
    });
}

function isWorkloadSourceOutput(lock: CompiledRunbookLock, node: RunbookPlanNode): boolean {
    const workload = /^\$nodes\.([A-Za-z0-9_-]+)\.workloadRef$/.exec(
        String(node.inputs?.workload ?? ""),
    );
    const digest = /^\$nodes\.([A-Za-z0-9_-]+)\.workloadSha256$/.exec(
        String(node.inputs?.workloadDigest ?? ""),
    );
    if (!workload || workload[1] !== digest?.[1]) {
        return false;
    }
    const producer = lock.nodes.find((candidate) => candidate.id === workload[1]);
    if (
        producer?.kind !== "activity" ||
        !["sql.workload.inspect", "sql.workload.generate"].includes(producer.activityKind ?? "")
    ) {
        return false;
    }
    const visited = new Set<string>([producer.id]);
    const pending = [producer.id];
    while (pending.length > 0) {
        const current = pending.shift()!;
        for (const edge of lock.edges.filter((candidate) => candidate.from === current)) {
            if (edge.to === node.id) {
                return true;
            }
            if (!visited.has(edge.to)) {
                visited.add(edge.to);
                pending.push(edge.to);
            }
        }
    }
    return false;
}

function isUpstreamActivityOutput(
    lock: CompiledRunbookLock,
    node: RunbookPlanNode,
    inputName: string,
    outputName: string,
    activityKind: string,
): boolean {
    const output = /^\$nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(
        String(node.inputs?.[inputName] ?? ""),
    );
    if (!output || output[2] !== outputName) {
        return false;
    }
    const producer = lock.nodes.find((candidate) => candidate.id === output[1]);
    if (producer?.kind !== "activity" || producer.activityKind !== activityKind) {
        return false;
    }
    const visited = new Set<string>([producer.id]);
    const pending = [producer.id];
    while (pending.length > 0) {
        const current = pending.shift()!;
        for (const edge of lock.edges.filter((candidate) => candidate.from === current)) {
            if (edge.to === node.id) {
                return true;
            }
            if (!visited.has(edge.to)) {
                visited.add(edge.to);
                pending.push(edge.to);
            }
        }
    }
    return false;
}

const PARAMETER_BIND = /^\$params\.([A-Za-z0-9_-]+)$/;
const NODE_BIND = /^\$nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export function targetFromCatalog(
    node: RunbookPlanNode,
    descriptor: ActivityDescriptor,
): RunbookPlanTarget | undefined {
    if (!descriptor.target) {
        return undefined;
    }
    if ("workspace" in descriptor.target) {
        return { kind: "workspace", binding: { source: "workspace" } };
    }
    const input = node.inputs?.[descriptor.target.bindingInput];
    if (typeof input === "string") {
        const parameter = PARAMETER_BIND.exec(input);
        if (parameter) {
            return {
                kind: descriptor.target.kind,
                binding: { source: "parameter", parameterId: parameter[1] },
            };
        }
        const output = NODE_BIND.exec(input);
        if (output) {
            return {
                kind: descriptor.target.kind,
                binding: { source: "nodeOutput", nodeId: output[1], output: output[2] },
            };
        }
    }
    return undefined;
}

export function targetsEqual(left: RunbookPlanTarget, right: RunbookPlanTarget): boolean {
    if (left.kind !== right.kind || left.binding.source !== right.binding.source) {
        return false;
    }
    if (left.binding.source === "parameter" && right.binding.source === "parameter") {
        return left.binding.parameterId === right.binding.parameterId;
    }
    if (left.binding.source === "nodeOutput" && right.binding.source === "nodeOutput") {
        return (
            left.binding.nodeId === right.binding.nodeId &&
            left.binding.output === right.binding.output
        );
    }
    if (left.binding.source === "workspace" && right.binding.source === "workspace") {
        return left.binding.workspaceFolder === right.binding.workspaceFolder;
    }
    return false;
}

/** Enforce trusted safety metadata: blast radius always comes from the
 *  registered descriptor, never from model output. */
export function stampCatalogMetadata(nodes: RunbookPlanNode[]): RunbookPlanNode[] {
    return nodes.map((node) => {
        if (node.kind !== "activity") {
            return {
                ...node,
                target: undefined,
                previewOnly: undefined,
                blastRadius: undefined,
            } as RunbookPlanNode;
        }
        const descriptor = findActivity(node.activityKind);
        if (!descriptor) {
            return node;
        }
        return {
            ...node,
            activityVersion: descriptor.version,
            target: targetFromCatalog(node, descriptor),
            previewOnly: descriptor.previewOnly,
            blastRadius: descriptor.blastRadius,
        };
    });
}

/** Prompt-facing catalog rendering for the plan compiler. */
export function describeCatalogForPrompt(): string {
    return ACTIVITY_CATALOG.map((a) => {
        const inputs = a.inputs
            .map((i) => `${i.name}${i.required ? "" : "?"} (${i.kind}): ${i.description}`)
            .join("; ");
        const values =
            a.producedValues.length > 0
                ? ` Produces bindable values: ${a.producedValues.map((v) => `$nodes.<id>.${v}`).join(", ")}.`
                : "";
        const approval = a.approvalRequired
            ? " Requires a dedicated gate with one approved edge directly to this activity."
            : "";
        return `- "${a.kind}" (${a.label}): ${a.description} Inputs: ${inputs}.${values}${approval}`;
    }).join("\n");
}
