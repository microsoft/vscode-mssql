/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * mssql_query_results language model tool (C2D-5, plan §13 + addendum §4):
 * bounded, audited AI access to Query Studio result snapshots.
 *
 * Metadata operations (list/describe/create/derive/release and
 * aggregate-numeric transforms) run without confirmation. Any operation
 * whose output carries cell values shows a VS Code Continue/Cancel
 * confirmation (prepareInvocation); the gate then mints a single-use grant
 * inside call() and the GatedQueryResultAccess facade enforces it — the
 * tool is UI, the gate is the boundary.
 *
 * Output hygiene (§4.4): cell values are untrusted text — value-bearing
 * responses wrap data in a delimited block with a fixed treat-as-data
 * preamble, control characters stripped, per-cell bytes capped, whole
 * responses byte-capped with explicit truncation metadata.
 */

import { QueryResultsAnalysis as AnalysisLoc } from "../constants/locConstants";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import { ToolBase } from "../copilot/tools/toolBase";
import { isQueryStudioEnabled } from "../queryStudio/queryStudioFeatureGate";
import { windowCellReader } from "./cellReader";
import { getQueryResultAccessService } from "./queryResultAccessService";
import { pinExistingSnapshot } from "./pinCommands";
import { boundResultModelCell, wrapValuesPayload } from "./resultModelContent";
import { QueryResultsParams, resolveQueryResultsParams } from "./queryResultsParams";
import { GatedQueryResultAccess, ResultAccessDenied, ResultAccessGate } from "./resultAccessGate";
import { QueryResultAccessError } from "./queryResultTypes";
import { TransformResult } from "./transformEngine";
import { TransformSpec, transformOutputClass, validateTransformSpec } from "./transformSpec";

export const QUERY_RESULTS_TOOL_NAME = "mssql_query_results";

export type QueryResultsToolOperation =
    | "list_live"
    | "list_snapshots"
    | "create_snapshot"
    | "describe_snapshot"
    | "get_rows"
    | "sample_rows"
    | "evaluate_transform"
    | "derive_snapshot"
    | "pin_snapshot"
    | "release_snapshot";

export interface QueryResultsToolParams {
    operation: QueryResultsToolOperation;
    sourceId?: string;
    snapshotId?: string;
    resultSetId?: string;
    rowStart?: number;
    rowCount?: number;
    sampleStrategy?: "head" | "head_tail" | "uniform_windows" | "reservoir";
    sampleSize?: number;
    /** Transform spec v1 (evaluate_transform / derive_snapshot). */
    spec?: unknown;
    reason?: string;
}

/**
 * Owner key: best-effort accident prevention (addendum §1.8) — VS Code does
 * not expose a durable conversation identity to tools, so all invocations
 * in this window share one nonce. Unguessable snapshot ids + the gate are
 * the primary controls.
 */
const WINDOW_OWNER_KEY = crypto.randomBytes(9).toString("base64url");

function featureEnabled(): { enabled: boolean; message?: string } {
    if (!isQueryStudioEnabled()) {
        return {
            enabled: false,
            message: AnalysisLoc.queryResultSnapshotsRequireQueryStudioMssqlQueryStudioEnabled,
        };
    }
    if (!resolveQueryResultsParams().params.aiEnabled) {
        return {
            enabled: false,
            message: AnalysisLoc.aIAccessToQueryResultsIsDisabledMssqlQueryResultsAiDetails,
        };
    }
    return { enabled: true };
}

/** True when this invocation's OUTPUT will carry cell values (§1.4). */
export function operationNeedsConfirmation(input: QueryResultsToolParams): boolean {
    switch (input.operation) {
        case "get_rows":
        case "sample_rows":
            return true;
        case "evaluate_transform": {
            const outcome = validateTransformSpec(input.spec);
            // Invalid specs fail validation in call() without touching data.
            return outcome.spec ? transformOutputClass(outcome.spec) === "values" : false;
        }
        default:
            return false;
    }
}

export class QueryResultsTool extends ToolBase<QueryResultsToolParams> {
    public readonly toolName = QUERY_RESULTS_TOOL_NAME;
    private readonly gate: ResultAccessGate;
    private gated: GatedQueryResultAccess | undefined;

    constructor(gate: ResultAccessGate = new ResultAccessGate()) {
        super();
        this.gate = gate;
    }

    private access(): GatedQueryResultAccess {
        this.gated ??= new GatedQueryResultAccess(
            getQueryResultAccessService(),
            this.gate,
            () => resolveQueryResultsParams().params,
        );
        return this.gated;
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<QueryResultsToolParams>,
        token: vscode.CancellationToken,
    ): Promise<string> {
        const input = options.input;
        const gatecheck = featureEnabled();
        if (!gatecheck.enabled) {
            return JSON.stringify({ success: false, message: gatecheck.message });
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        const params = resolveQueryResultsParams().params;
        Perf.marker("mssql.queryResults.aiTool.invoke.begin", "begin", {
            operation: input.operation,
        });
        let outcome = "ok";
        try {
            const response = await this.dispatch(input, params, token);
            const bounded =
                Buffer.byteLength(response, "utf8") > params.aiMaxBytesPerResponse
                    ? JSON.stringify({
                          success: false,
                          truncated: true,
                          message:
                              AnalysisLoc.theResponseExceededBytesNarrowTheRequestFewerRowsColumns(
                                  String(params.aiMaxBytesPerResponse),
                              ),
                      })
                    : response;
            return bounded;
        } catch (error) {
            if (error instanceof ResultAccessDenied) {
                outcome = "denied";
                return JSON.stringify({
                    success: false,
                    needsConfirmation: true,
                    message: AnalysisLoc.readingRawResultValuesRequiresUserConfirmationReInvokeThis,
                });
            }
            if (error instanceof QueryResultAccessError) {
                outcome = error.code;
                return JSON.stringify({ success: false, code: error.code, message: error.message });
            }
            outcome = "error";
            throw error;
        } finally {
            Perf.marker("mssql.queryResults.aiTool.invoke.end", "end", {
                operation: input.operation,
                outcome,
            });
        }
    }

    private async dispatch(
        input: QueryResultsToolParams,
        params: QueryResultsParams,
        token: vscode.CancellationToken,
    ): Promise<string> {
        const access = this.access();
        switch (input.operation) {
            case "list_live":
                return JSON.stringify({ success: true, liveSources: access.listLiveSources() });
            case "list_snapshots":
                return JSON.stringify({ success: true, snapshots: access.listSnapshots() });
            case "describe_snapshot": {
                const description = access.describeSnapshot(this.requireId(input));
                return JSON.stringify(
                    description
                        ? { success: true, snapshot: description }
                        : { success: false, message: AnalysisLoc.snapshotNotFoundOrExpired },
                );
            }
            case "create_snapshot": {
                if (!input.sourceId) {
                    return JSON.stringify({
                        success: false,
                        message: AnalysisLoc.createSnapshotRequiresSourceIdSeeListLive,
                    });
                }
                const lease = await access.createSnapshot({
                    ownerKey: WINDOW_OWNER_KEY,
                    sourceId: input.sourceId,
                    reason: input.reason ?? AnalysisLoc.aIAnalysisSnapshot,
                });
                return JSON.stringify({
                    success: true,
                    snapshotId: lease.snapshotId,
                    note: AnalysisLoc.snapshotRetainedMinutesUseDescribeSnapshotForSchemaAndCounts(
                        String(params.snapshotTtlMinutes),
                    ),
                });
            }
            case "derive_snapshot": {
                const spec = this.requireSpec(input);
                const snapshotId = await access.deriveSnapshot(
                    spec,
                    WINDOW_OWNER_KEY,
                    () => token.isCancellationRequested,
                );
                return JSON.stringify({ success: true, snapshotId });
            }
            case "pin_snapshot": {
                // "AI filters, the user pins the view": opens the snapshot
                // (typically a derived one) as a read-only tab. The tab is a
                // user-visible action, not model output — no values cross.
                const outcome = await pinExistingSnapshot(this.requireId(input));
                return JSON.stringify(
                    outcome.opened
                        ? {
                              success: true,
                              note: AnalysisLoc.theSnapshotIsNowOpenAsAPinnedTabAnd,
                          }
                        : { success: false, message: outcome.error },
                );
            }
            case "release_snapshot":
                access.releaseSnapshot(this.requireId(input), WINDOW_OWNER_KEY);
                return JSON.stringify({ success: true });
            case "evaluate_transform": {
                const spec = this.requireSpec(input);
                const needsGrant = transformOutputClass(spec) === "values";
                const result = await access.evaluateTransform(spec, {
                    ownerKey: WINDOW_OWNER_KEY,
                    ...(needsGrant
                        ? {
                              grantId: this.gate.mint({
                                  snapshotId: spec.source.snapshotId,
                                  ownerKey: WINDOW_OWNER_KEY,
                                  operationClass: "values",
                              }).grantId,
                          }
                        : {}),
                    isCancelled: () => token.isCancellationRequested,
                });
                return this.renderTransformResult(result, params, needsGrant);
            }
            case "get_rows":
            case "sample_rows": {
                const snapshotId = this.requireId(input);
                if (!input.resultSetId) {
                    return JSON.stringify({
                        success: false,
                        message: AnalysisLoc.resultSetIdIsRequiredSeeDescribeSnapshot,
                    });
                }
                // sample_rows is a canned spec through the same engine+gate.
                if (input.operation === "sample_rows") {
                    const spec: TransformSpec = {
                        v: 1,
                        source: { snapshotId, resultSetId: input.resultSetId },
                        terminal: {
                            kind: "sample",
                            strategy: input.sampleStrategy ?? "head",
                            n: Math.min(input.sampleSize ?? 20, params.aiMaxRowsPerResponse),
                        },
                    };
                    const result = await access.evaluateTransform(spec, {
                        ownerKey: WINDOW_OWNER_KEY,
                        grantId: this.gate.mint({
                            snapshotId,
                            ownerKey: WINDOW_OWNER_KEY,
                            operationClass: "values",
                        }).grantId,
                        isCancelled: () => token.isCancellationRequested,
                    });
                    return this.renderTransformResult(result, params, true);
                }
                const grant = this.gate.mint({
                    snapshotId,
                    ownerKey: WINDOW_OWNER_KEY,
                    operationClass: "values",
                });
                const window = await access.getRows(
                    {
                        snapshotId,
                        resultSetId: input.resultSetId,
                        rowStart: input.rowStart ?? 0,
                        rowCount: input.rowCount ?? 50,
                    },
                    { ownerKey: WINDOW_OWNER_KEY, grantId: grant.grantId },
                );
                const cells = windowCellReader(window);
                const rows = window.values.map((_, r) =>
                    window.columns.map((__, c) => {
                        const cell = cells.cellAt(r, c);
                        return cell.isNull
                            ? null
                            : boundResultModelCell(cell.value, params.aiMaxCellBytes);
                    }),
                );
                return wrapValuesPayload({
                    success: true,
                    columns: window.columns.map((column) => column.name),
                    rowStart: window.start,
                    rowCount: window.rowCount,
                    rows,
                });
            }
        }
    }

    private renderTransformResult(
        result: TransformResult,
        params: QueryResultsParams,
        valuesClass: boolean,
    ): string {
        const payload = {
            success: true,
            columns: result.columns,
            rows: result.rows
                .slice(0, params.aiMaxRowsPerResponse)
                .map((row) =>
                    row.map((value) => boundResultModelCell(value, params.aiMaxCellBytes)),
                ),
            outputTruncated: result.rows.length > params.aiMaxRowsPerResponse,
            stats: result.stats,
            ...(result.overflowGroups !== undefined
                ? { overflowGroups: result.overflowGroups }
                : {}),
            ...(result.approximate ? { approximate: true } : {}),
        };
        return valuesClass ? wrapValuesPayload(payload) : JSON.stringify(payload);
    }

    private requireId(input: QueryResultsToolParams): string {
        if (!input.snapshotId) {
            throw new QueryResultAccessError("snapshotNotFound", AnalysisLoc.snapshotIdIsRequired);
        }
        return input.snapshotId;
    }

    private requireSpec(input: QueryResultsToolParams): TransformSpec {
        const outcome = validateTransformSpec(input.spec);
        if (!outcome.spec) {
            throw new QueryResultAccessError(
                "snapshotNotFound",
                AnalysisLoc.invalidTransformSpec(
                    String(
                        outcome
                            .errors!.slice(0, 5)
                            .map((error) => `${error.path}: ${error.message}`)
                            .join("; "),
                    ),
                ),
            );
        }
        return outcome.spec;
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<QueryResultsToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const input = options.input;
        const invocationMessage = AnalysisLoc.queryResults(String(input.operation));
        if (!operationNeedsConfirmation(input)) {
            return { invocationMessage };
        }
        const description = input.snapshotId
            ? getQueryResultAccessService().describeSnapshot(input.snapshotId)
            : undefined;
        const specSource =
            input.operation === "evaluate_transform"
                ? validateTransformSpec(input.spec).spec?.source
                : undefined;
        const target = description
            ? AnalysisLoc.resultSetSRowsPinnedSAgo(
                  String(description.source.sourceTitle),
                  String(description.resultSetCount),
                  String(description.totalRows.toLocaleString()),
                  String(Math.round((Date.now() - description.createdEpochMs) / 1000)),
              )
            : (specSource?.snapshotId ?? input.snapshotId ?? AnalysisLoc.theSelectedSnapshot);
        const params = resolveQueryResultsParams().params;
        // All decision details ride the markdown body (Continue/Cancel is
        // the whole button surface — addendum §4.3).
        const confirmationMessages = {
            title: AnalysisLoc.mSSQLShareQueryResultValuesWithTheModel,
            message: new vscode.MarkdownString(
                AnalysisLoc.thisSendsRawResultValuesFromToTheLanguageModel(String(target)) +
                    `- Operation: \`${input.operation}\`\n` +
                    AnalysisLoc.boundsAtMostRowsKBPerResponseKBPerCell(
                        String(params.aiMaxRowsPerResponse),
                        String(Math.round(params.aiMaxBytesPerResponse / 1024)),
                        String(Math.round(params.aiMaxCellBytes / 1024)),
                    ) +
                    AnalysisLoc.scopeThisSingleRequestOnlyGrantsAreSingleUse +
                    AnalysisLoc.schemaRowCountsAndNumericAggregatesNeverRequireThisConfirmation,
            ),
        };
        return { invocationMessage, confirmationMessages };
    }
}
