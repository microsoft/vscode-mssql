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
    }
    return issues;
}

/** Enforce trusted safety metadata: blast radius always comes from the
 *  registered descriptor, never from model output. */
export function stampCatalogMetadata(nodes: RunbookPlanNode[]): RunbookPlanNode[] {
    return nodes.map((node) => {
        if (node.kind !== "activity") {
            return { ...node, blastRadius: undefined } as RunbookPlanNode;
        }
        const descriptor = findActivity(node.activityKind);
        if (!descriptor) {
            return node;
        }
        return {
            ...node,
            activityVersion: descriptor.version,
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
