/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic, secret-safe projections of a local Runbook Studio evidence
 * manifest. Export never passes the source object through: every field is
 * allowlisted and output handles are reduced to non-content metadata. This
 * keeps SQL, row payloads, paths, connection identifiers, and provider
 * messages out even if a future producer accidentally adds them to the
 * stored manifest.
 */

import * as crypto from "crypto";
import type { RbsEvidenceExportFormat } from "../sharedInterfaces/runbookStudio";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 10_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_CONTRACT = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const PLAN_SHA256 = /^sha256:[a-fA-F0-9]{64}$/;
const SAFE_METRIC_KEY = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SENSITIVE_METRIC_KEY =
    /(path|sql|query|connection|secret|token|password|message|database|lease|operation|name)/i;

type EvidenceVerdict = "pass" | "fail" | "indeterminate";
type NodeState =
    | "pending"
    | "queued"
    | "running"
    | "awaitingApproval"
    | "succeeded"
    | "failed"
    | "skipped"
    | "cancelled";
type NodeOutcome = "success" | "failure" | "cancelled" | "skipped" | "policyDenied";
type ComponentId =
    | "vscode"
    | "mssqlExtension"
    | "sqlDatabaseProjectsExtension"
    | "sqlToolsService"
    | "dacFx";

interface ExportOutput {
    contract: string;
    rows?: number;
    bytes?: number;
    expired?: boolean;
    truncated?: boolean;
}

interface ExportNode {
    nodeId: string;
    activityKind?: string;
    state: NodeState;
    attempt: number;
    outcome?: NodeOutcome;
    outputs: ExportOutput[];
    evidenceScalars?: Record<string, number | string | boolean>;
}

interface ExportComponent {
    id: ComponentId;
    version: string | null;
    status: "resolved" | "unavailable" | "unverified";
    versionSource:
        | "host"
        | "extensionManifest"
        | "runtimeRequest"
        | "packagedConfiguration"
        | "serviceDependencyManifest"
        | "none";
    configuredVersion?: string;
    hostComponent?: ComponentId;
}

interface EvidenceExportModel {
    schemaVersion: 1;
    contract: "runbookEvidenceExport/1";
    sourceBundle: {
        contract: "evidenceBundle/1";
        schemaVersion: 2;
        sha256: string;
        generatedAtUtc: string;
    };
    run: {
        runId: string;
        runbookId: string;
        planRevision: string;
        planHash: string;
        runtimeKind: string;
    };
    summary: {
        verdict: EvidenceVerdict;
        nodeCount: number;
        passedNodeCount: number;
        failedNodeCount: number;
        evidenceHandleCount: number;
        incompleteEvidence: boolean;
        toolchainComplete: boolean;
    };
    toolchain: {
        complete: boolean;
        allComponentsResolved: boolean;
        requiredComponents: ComponentId[];
        components: ExportComponent[];
    };
    nodes: ExportNode[];
}

export interface EvidenceExportArtifact {
    content: string;
    extension: "json" | "xml" | "sarif" | "md";
    mediaType: string;
    filterLabel: string;
    /** Host-only binding check; never sent across the webview RPC. */
    sourceIdentity: EvidenceExportModel["run"] & { verdict: EvidenceVerdict };
}

export class EvidenceExportError extends Error {
    constructor() {
        super("The evidence manifest is unavailable or invalid.");
        this.name = "EvidenceExportError";
    }
}

export function buildEvidenceExport(
    manifestJson: string,
    format: RbsEvidenceExportFormat,
): EvidenceExportArtifact {
    const model = parseEvidenceManifest(manifestJson);
    const sourceIdentity = { ...model.run, verdict: model.summary.verdict };
    switch (format) {
        case "json":
            return {
                content: JSON.stringify(model, undefined, 2) + "\n",
                extension: "json",
                mediaType: "application/json",
                filterLabel: "JSON",
                sourceIdentity,
            };
        case "junit":
            return {
                content: renderJunit(model),
                extension: "xml",
                mediaType: "application/xml",
                filterLabel: "JUnit XML",
                sourceIdentity,
            };
        case "sarif":
            return {
                content: renderSarif(model),
                extension: "sarif",
                mediaType: "application/sarif+json",
                filterLabel: "SARIF",
                sourceIdentity,
            };
        case "markdown":
            return {
                content: renderMarkdown(model),
                extension: "md",
                mediaType: "text/markdown",
                filterLabel: "Markdown",
                sourceIdentity,
            };
        default:
            throw new EvidenceExportError();
    }
}

/** A portable file stem only; the caller chooses the destination URI. */
export function evidenceExportFileName(
    runbookName: string,
    runId: string,
    extension: EvidenceExportArtifact["extension"],
): string {
    const name = safeFilePart(runbookName, "runbook");
    const run = safeFilePart(runId, "run");
    return `${name}-${run}-evidence.${extension}`;
}

function parseEvidenceManifest(manifestJson: string): EvidenceExportModel {
    if (Buffer.byteLength(manifestJson, "utf8") > MAX_MANIFEST_BYTES) {
        throw new EvidenceExportError();
    }
    let root: Record<string, unknown>;
    try {
        root = record(JSON.parse(manifestJson));
    } catch {
        throw new EvidenceExportError();
    }
    if (root.schemaVersion !== 2 || root.contract !== "evidenceBundle/1") {
        throw new EvidenceExportError();
    }
    const claimedDigest = digest(root.bundleSha256);
    const digestContent = Object.fromEntries(
        Object.entries(root).filter(([key]) => key !== "bundleSha256" && key !== "generatedAtUtc"),
    );
    const actualDigest = crypto
        .createHash("sha256")
        .update(JSON.stringify(digestContent))
        .digest("hex");
    if (actualDigest !== claimedDigest) {
        throw new EvidenceExportError();
    }
    const run = record(root.run);
    const summary = record(root.summary);
    const toolchain = record(root.toolchain);
    const sourceNodes = array(root.nodes);
    if (sourceNodes.length > MAX_NODES) {
        throw new EvidenceExportError();
    }
    const nodes = sourceNodes.map(projectNode);
    const components = array(toolchain.components).map(projectComponent);
    const requiredComponents = array(toolchain.requiredComponents).map(componentId);
    const model: EvidenceExportModel = {
        schemaVersion: 1,
        contract: "runbookEvidenceExport/1",
        sourceBundle: {
            contract: "evidenceBundle/1",
            schemaVersion: 2,
            sha256: claimedDigest,
            generatedAtUtc: isoTimestamp(root.generatedAtUtc),
        },
        run: {
            runId: id(run.runId),
            runbookId: id(run.runbookId),
            planRevision: id(run.planRevision),
            planHash: planDigest(run.planHash),
            runtimeKind: id(run.runtimeKind),
        },
        summary: {
            verdict: enumValue(summary.verdict, ["pass", "fail", "indeterminate"]),
            nodeCount: count(summary.nodeCount),
            passedNodeCount: count(summary.passedNodeCount),
            failedNodeCount: count(summary.failedNodeCount),
            evidenceHandleCount: count(summary.evidenceHandleCount),
            incompleteEvidence: bool(summary.incompleteEvidence),
            toolchainComplete: bool(summary.toolchainComplete),
        },
        toolchain: {
            complete: bool(toolchain.complete),
            allComponentsResolved: bool(toolchain.allComponentsResolved),
            requiredComponents,
            components,
        },
        nodes,
    };
    validateProjectedEvidence(model);
    return model;
}

function validateProjectedEvidence(model: EvidenceExportModel): void {
    const passedNodeCount = model.nodes.filter(
        (node) => node.state === "succeeded" && node.outcome !== "failure",
    ).length;
    const failedNodeCount = model.nodes.filter(isFailedNode).length;
    const evidenceHandleCount = model.nodes.reduce((total, node) => total + node.outputs.length, 0);
    const resolved = new Set(
        model.toolchain.components
            .filter((component) => component.status === "resolved")
            .map((component) => component.id),
    );
    const toolchainComplete = model.toolchain.requiredComponents.every((id) => resolved.has(id));
    const incompleteEvidence =
        !toolchainComplete ||
        model.nodes.some((node) =>
            node.outputs.some((output) => output.expired === true || output.truncated === true),
        );
    const verdict: EvidenceVerdict =
        failedNodeCount > 0
            ? "fail"
            : model.nodes.length === 0 || incompleteEvidence
              ? "indeterminate"
              : "pass";
    if (
        model.summary.nodeCount !== model.nodes.length ||
        model.summary.passedNodeCount !== passedNodeCount ||
        model.summary.failedNodeCount !== failedNodeCount ||
        model.summary.evidenceHandleCount !== evidenceHandleCount ||
        model.summary.toolchainComplete !== toolchainComplete ||
        model.toolchain.complete !== toolchainComplete ||
        model.summary.incompleteEvidence !== incompleteEvidence ||
        model.summary.verdict !== verdict
    ) {
        throw new EvidenceExportError();
    }
}

function projectNode(value: unknown): ExportNode {
    const source = record(value);
    const scalars = projectScalars(source.evidenceScalars);
    return {
        nodeId: id(source.nodeId),
        ...(source.activityKind !== undefined ? { activityKind: id(source.activityKind) } : {}),
        state: enumValue(source.state, [
            "pending",
            "queued",
            "running",
            "awaitingApproval",
            "succeeded",
            "failed",
            "skipped",
            "cancelled",
        ]),
        attempt: count(source.attempt),
        ...(source.outcome !== undefined
            ? {
                  outcome: enumValue(source.outcome, [
                      "success",
                      "failure",
                      "cancelled",
                      "skipped",
                      "policyDenied",
                  ]),
              }
            : {}),
        outputs: array(source.outputs).map(projectOutput),
        ...(Object.keys(scalars).length > 0 ? { evidenceScalars: scalars } : {}),
    };
}

function projectOutput(value: unknown): ExportOutput {
    const source = record(value);
    return {
        // Deliberately omit handleId: it is a host-internal locator and has
        // no meaning to a CI consumer.
        contract: contract(source.contract),
        ...(source.rows !== undefined ? { rows: count(source.rows) } : {}),
        ...(source.bytes !== undefined ? { bytes: count(source.bytes) } : {}),
        ...(source.expired !== undefined ? { expired: bool(source.expired) } : {}),
        ...(source.truncated !== undefined ? { truncated: bool(source.truncated) } : {}),
    };
}

function projectComponent(value: unknown): ExportComponent {
    const source = record(value);
    const version = nullableVersion(source.version);
    return {
        id: componentId(source.id),
        version,
        status: enumValue(source.status, ["resolved", "unavailable", "unverified"]),
        versionSource: enumValue(source.versionSource, [
            "host",
            "extensionManifest",
            "runtimeRequest",
            "packagedConfiguration",
            "serviceDependencyManifest",
            "none",
        ]),
        ...(source.configuredVersion !== undefined
            ? { configuredVersion: versionValue(source.configuredVersion) }
            : {}),
        ...(source.hostComponent !== undefined
            ? { hostComponent: componentId(source.hostComponent) }
            : {}),
    };
}

function projectScalars(value: unknown): Record<string, number | string | boolean> {
    if (value === undefined) {
        return {};
    }
    const source = record(value);
    const result: Record<string, number | string | boolean> = {};
    for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
        if (!SAFE_METRIC_KEY.test(key) || SENSITIVE_METRIC_KEY.test(key)) {
            continue;
        }
        const metric = source[key];
        if (
            typeof metric === "boolean" ||
            (typeof metric === "number" && Number.isFinite(metric))
        ) {
            result[key] = metric;
        } else if (
            typeof metric === "string" &&
            /(sha256|digest)$/i.test(key) &&
            SHA256.test(metric)
        ) {
            result[key] = metric.toLowerCase();
        }
    }
    return result;
}

function renderJunit(model: EvidenceExportModel): string {
    const failures = model.nodes.filter(isFailedNode).length;
    const skipped = model.nodes.filter(
        (node) => !isFailedNode(node) && node.state !== "succeeded",
    ).length;
    const cases = model.nodes
        .map((node) => {
            const attributes = `classname="${xml(node.activityKind ?? "runbook")}" name="${xml(node.nodeId)}"`;
            if (isFailedNode(node)) {
                return `    <testcase ${attributes}><failure type="${xml(node.outcome ?? node.state)}">Runbook node did not pass.</failure></testcase>`;
            }
            if (node.state !== "succeeded") {
                return `    <testcase ${attributes}><skipped message="Runbook node did not complete." /></testcase>`;
            }
            return `    <testcase ${attributes} />`;
        })
        .join("\n");
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="MSSQL Runbook Studio" tests="${model.nodes.length}" failures="${failures}" skipped="${skipped}">`,
        `  <testsuite name="${xml(model.run.runbookId)}" tests="${model.nodes.length}" failures="${failures}" skipped="${skipped}" timestamp="${xml(model.sourceBundle.generatedAtUtc)}">`,
        "    <properties>",
        `      <property name="runId" value="${xml(model.run.runId)}" />`,
        `      <property name="planHash" value="${xml(model.run.planHash)}" />`,
        `      <property name="evidenceSha256" value="${xml(model.sourceBundle.sha256)}" />`,
        `      <property name="verdict" value="${model.summary.verdict}" />`,
        "    </properties>",
        cases,
        "  </testsuite>",
        "</testsuites>",
        "",
    ].join("\n");
}

function renderSarif(model: EvidenceExportModel): string {
    const rules = [
        {
            id: "RBS_NODE_FAILURE",
            shortDescription: { text: "Runbook node failed" },
        },
        {
            id: "RBS_NODE_INCOMPLETE",
            shortDescription: { text: "Runbook node did not complete" },
        },
        {
            id: "RBS_EVIDENCE_INDETERMINATE",
            shortDescription: { text: "Runbook evidence is incomplete" },
        },
    ];
    const results: Array<Record<string, unknown>> = model.nodes
        .filter((node) => isFailedNode(node) || node.state !== "succeeded")
        .map((node) => ({
            ruleId: isFailedNode(node) ? "RBS_NODE_FAILURE" : "RBS_NODE_INCOMPLETE",
            level: isFailedNode(node) ? "error" : "warning",
            message: {
                text: `Runbook node ${node.nodeId} completed with ${node.outcome ?? node.state}.`,
            },
            properties: {
                nodeId: node.nodeId,
                activityKind: node.activityKind ?? "runbook",
                state: node.state,
                ...(node.outcome ? { outcome: node.outcome } : {}),
            },
        }));
    if (model.summary.verdict === "indeterminate" && results.length === 0) {
        results.push({
            ruleId: "RBS_EVIDENCE_INDETERMINATE",
            level: "warning",
            message: { text: "Runbook evidence is incomplete." },
        });
    }
    return (
        JSON.stringify(
            {
                $schema: "https://json.schemastore.org/sarif-2.1.0.json",
                version: "2.1.0",
                runs: [
                    {
                        tool: {
                            driver: {
                                name: "MSSQL Runbook Studio",
                                informationUri: "https://aka.ms/vscode-mssql",
                                rules,
                            },
                        },
                        invocations: [
                            {
                                executionSuccessful: model.summary.verdict === "pass",
                                properties: {
                                    runId: model.run.runId,
                                    planHash: model.run.planHash,
                                    evidenceSha256: model.sourceBundle.sha256,
                                    verdict: model.summary.verdict,
                                },
                            },
                        ],
                        results,
                    },
                ],
            },
            undefined,
            2,
        ) + "\n"
    );
}

function renderMarkdown(model: EvidenceExportModel): string {
    const lines = [
        "# Runbook evidence",
        "",
        `- Verdict: **${model.summary.verdict}**`,
        `- Run: \`${markdown(model.run.runId)}\``,
        `- Plan revision: \`${markdown(model.run.planRevision)}\``,
        `- Plan SHA-256: \`${model.run.planHash}\``,
        `- Evidence SHA-256: \`${model.sourceBundle.sha256}\``,
        `- Generated: ${markdown(model.sourceBundle.generatedAtUtc)}`,
        "",
        "## Summary",
        "",
        "| Nodes | Passed | Failed | Evidence outputs | Complete |",
        "| ---: | ---: | ---: | ---: | :---: |",
        `| ${model.summary.nodeCount} | ${model.summary.passedNodeCount} | ${model.summary.failedNodeCount} | ${model.summary.evidenceHandleCount} | ${model.summary.incompleteEvidence ? "No" : "Yes"} |`,
        "",
        "## Toolchain",
        "",
        "| Component | Version | Status | Required |",
        "| --- | --- | --- | :---: |",
        ...model.toolchain.components.map(
            (component) =>
                `| ${markdown(component.id)} | ${markdown(component.version ?? "—")} | ${markdown(component.status)} | ${model.toolchain.requiredComponents.includes(component.id) ? "Yes" : "No"} |`,
        ),
        "",
        "## Nodes",
        "",
        "| Node | Activity | State | Outcome | Attempt | Outputs |",
        "| --- | --- | --- | --- | ---: | ---: |",
        ...model.nodes.map(
            (node) =>
                `| ${markdown(node.nodeId)} | ${markdown(node.activityKind ?? "—")} | ${markdown(node.state)} | ${markdown(node.outcome ?? "—")} | ${node.attempt} | ${node.outputs.length} |`,
        ),
        "",
    ];
    return lines.join("\n");
}

function isFailedNode(node: ExportNode): boolean {
    return (
        node.state === "failed" ||
        node.state === "cancelled" ||
        node.outcome === "failure" ||
        node.outcome === "cancelled" ||
        node.outcome === "policyDenied"
    );
}

function record(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new EvidenceExportError();
    }
    return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new EvidenceExportError();
    }
    return value;
}

function id(value: unknown): string {
    if (typeof value !== "string" || !SAFE_ID.test(value)) {
        throw new EvidenceExportError();
    }
    return value;
}

function digest(value: unknown): string {
    if (typeof value !== "string" || !SHA256.test(value)) {
        throw new EvidenceExportError();
    }
    return value.toLowerCase();
}

function planDigest(value: unknown): string {
    if (typeof value !== "string" || !PLAN_SHA256.test(value)) {
        throw new EvidenceExportError();
    }
    return value.toLowerCase();
}

function contract(value: unknown): string {
    if (typeof value !== "string" || !SAFE_CONTRACT.test(value)) {
        throw new EvidenceExportError();
    }
    return value;
}

function versionValue(value: unknown): string {
    if (typeof value !== "string" || !SAFE_VERSION.test(value)) {
        throw new EvidenceExportError();
    }
    return value;
}

function nullableVersion(value: unknown): string | null {
    return value === null ? null : versionValue(value);
}

function count(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new EvidenceExportError();
    }
    return value;
}

function bool(value: unknown): boolean {
    if (typeof value !== "boolean") {
        throw new EvidenceExportError();
    }
    return value;
}

function isoTimestamp(value: unknown): string {
    if (
        typeof value !== "string" ||
        value.length > 40 ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value
    ) {
        throw new EvidenceExportError();
    }
    return value;
}

function componentId(value: unknown): ComponentId {
    return enumValue(value, [
        "vscode",
        "mssqlExtension",
        "sqlDatabaseProjectsExtension",
        "sqlToolsService",
        "dacFx",
    ]);
}

function enumValue<const T extends string>(value: unknown, values: readonly T[]): T {
    if (typeof value !== "string" || !values.includes(value as T)) {
        throw new EvidenceExportError();
    }
    return value as T;
}

function safeFilePart(value: string, fallback: string): string {
    const sanitized = value
        .normalize("NFKD")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 64);
    return sanitized || fallback;
}

function xml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function markdown(value: string): string {
    return value.replace(/[|`\\\r\n]/g, (character) => `\\${character}`);
}
