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

export interface ActivityInputDescriptor {
    name: string;
    /** "string" | "bind" (accepts $params.X / $nodes.X.Y) | "sql" (read-only statement). */
    kind: "string" | "bind" | "sql";
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
        version: 1,
        label: "Extract database DACPAC",
        description:
            "Extracts a DACPAC from the explicitly bound database through DacFx and retains it as a hashed Runbook Studio artifact.",
        inputs: [
            {
                name: "database",
                kind: "bind",
                required: true,
                description: "Saved connection profile for the source database",
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
        kind: "schema.compare.export",
        version: 1,
        label: "Export schema comparison report",
        description:
            "Generates a DacFx comparison report for an explicitly bound database and retains the complete XML as a hashed Runbook Studio artifact without treating differences as execution failure.",
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
        outputContract: "schemaDiff/1",
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
            if (
                descriptor.target.kind === "ephemeralSqlDatabase" &&
                descriptor.kind !== "sandbox.provision" &&
                !isOwnedSandboxOutput(lock, node)
            ) {
                issues.push(
                    `node '${node.id}' must bind its disposable target to an upstream sandbox.provision connectionRef`,
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

function isOwnedSandboxOutput(lock: CompiledRunbookLock, node: RunbookPlanNode): boolean {
    if (node.target?.binding.source !== "nodeOutput") {
        return false;
    }
    const binding = node.target.binding;
    const producer = lock.nodes.find((candidate) => candidate.id === binding.nodeId);
    if (
        producer?.kind !== "activity" ||
        producer.activityKind !== "sandbox.provision" ||
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
