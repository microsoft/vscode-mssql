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
    /** Values other nodes can bind to ($nodes.<id>.<value>). */
    producedValues: string[];
    /** Target semantics are catalog authority, not model-authored metadata.
     * `bindingInput` must be a $params binding when present. */
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
        producedValues: ["artifactPath", "diagnosticCount"],
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
        kind: "sandbox.provision",
        version: 1,
        label: "Provision ephemeral SQL target (deterministic preview)",
        description:
            "Creates a typed fake lease and connection reference; no container, process, or database is created.",
        inputs: [
            {
                name: "sandbox",
                kind: "bind",
                required: true,
                description: "Portable sandbox specification parameter",
            },
        ],
        outputContract: "databaseLease/1",
        producedValues: ["connectionRef", "leaseId"],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "sandbox" },
        previewOnly: true,
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
        label: "Preview DACPAC deployment (deterministic preview)",
        description:
            "Produces a typed fake deployment report and script from bound DACPAC and ephemeral-target outputs.",
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
        outputContract: "deploymentPreview/1",
        producedValues: ["changeCount", "scriptPath"],
        target: { kind: "ephemeralSqlDatabase", bindingInput: "database" },
        previewOnly: true,
        blastRadius: {
            resource: "databaseSchema",
            operation: "read",
            targetEnvironment: "ephemeral",
            reversibility: "noEffect",
            breadth: "bounded",
        },
    },
    {
        kind: "sandbox.dispose",
        version: 1,
        label: "Dispose ephemeral SQL target (deterministic preview)",
        description:
            "Consumes a fake lease connection reference and produces typed cleanup evidence.",
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
        previewOnly: true,
        blastRadius: {
            resource: "container",
            operation: "delete",
            targetEnvironment: "ephemeral",
            reversibility: "irreversible",
            breadth: "bounded",
        },
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
        }
    }
    return issues;
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
        return `- "${a.kind}" (${a.label}): ${a.description} Inputs: ${inputs}.${values}`;
    }).join("\n");
}
