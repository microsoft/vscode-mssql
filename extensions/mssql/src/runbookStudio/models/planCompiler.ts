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
