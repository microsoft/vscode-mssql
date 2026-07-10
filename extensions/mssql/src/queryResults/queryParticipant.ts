/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `@query` chat participant (C2D-6, plan §13.5): a THIN orchestrator over
 * the result-access platform — context resolution via
 * QueryResultContextService, data via GatedQueryResultAccess, consent via
 * the gate's own modal (the participant never re-implements row fetching,
 * bounds, or permissions). `mssql.agent` is untouched.
 *
 * /list      — live Query Studio results and snapshots
 * /summarize — schema, counts, null ratios (no values, no confirmation)
 * /profile   — adds per-column min/max (values class → one modal consent)
 * /pin       — pin the active results to a read-only snapshot document
 *
 * Ambiguity is asked about, never guessed (§12.2): with no active context
 * and multiple live sources, the participant lists candidates instead of
 * silently picking one.
 */

import * as crypto from "crypto";
import * as vscode from "vscode";
import { getQueryResultAccessService } from "./queryResultAccessService";
import { getQueryResultContextService } from "./queryResultContextService";
import { resolveQueryResultsParams } from "./queryResultsParams";
import { GatedQueryResultAccess, ResultAccessGate } from "./resultAccessGate";
import { openPinnedResultsDocument } from "./pinnedResultsDocumentProvider";
import { QueryResultSnapshotDescription } from "./queryResultTypes";
import { TransformAggregate, TransformSpec } from "./transformSpec";

const PARTICIPANT_ID = "mssql.query";
const OWNER_KEY = `chat_${crypto.randomBytes(9).toString("base64url")}`;
/** Columns covered by summarize/profile aggregates (32-agg spec cap). */
const PROFILE_COLUMN_LIMIT = 8;

let gated: GatedQueryResultAccess | undefined;
const gate = new ResultAccessGate();

function access(): GatedQueryResultAccess {
    gated ??= new GatedQueryResultAccess(
        getQueryResultAccessService(),
        gate,
        () => resolveQueryResultsParams().params,
    );
    return gated;
}

function featureBlocked(stream: vscode.ChatResponseStream): boolean {
    const config = vscode.workspace.getConfiguration();
    if (!config.get<boolean>("mssql.queryStudio.enabled", false)) {
        stream.markdown(
            "Query result analysis needs Query Studio — enable `mssql.queryStudio.enabled`, run a query, then ask again.",
        );
        return true;
    }
    if (!resolveQueryResultsParams().params.aiEnabled) {
        stream.markdown(
            "AI access to query results is disabled (`mssql.queryResults.ai.enabled`).",
        );
        return true;
    }
    return false;
}

/**
 * Resolve "these results" (§12.2 subset): active pinned snapshot, else the
 * active grid's source (snapshotted on demand), else a single unambiguous
 * live source, else ask.
 */
async function resolveTargetSnapshot(
    stream: vscode.ChatResponseStream,
): Promise<string | undefined> {
    const service = getQueryResultAccessService();
    const context = getQueryResultContextService().current();
    if (context?.kind === "pinnedSnapshot" && context.snapshotId) {
        if (service.describeSnapshot(context.snapshotId)) {
            return context.snapshotId;
        }
    }
    const candidateSourceId = (() => {
        if (context?.kind === "queryStudio" && context.sourceId) {
            return context.sourceId;
        }
        const withResults = service
            .listLiveSources()
            .filter((source) => source.resultSetCount > 0 && !source.streaming);
        return withResults.length === 1 ? withResults[0].sourceId : undefined;
    })();
    if (candidateSourceId) {
        const lease = await access().createSnapshot({
            ownerKey: OWNER_KEY,
            sourceId: candidateSourceId,
            reason: "@query analysis",
        });
        return lease.snapshotId;
    }
    const live = service.listLiveSources();
    if (live.length === 0) {
        stream.markdown(
            "No query results are available. Run a query in Query Studio first, then ask again.",
        );
    } else {
        stream.markdown(
            "More than one result source is open and none is focused — click into the grid you mean (or pin it), then ask again.\n\n" +
                live
                    .map(
                        (source) =>
                            `- **${source.sourceTitle}** — ${source.resultSetCount} result set(s), ${source.totalRows.toLocaleString()} rows${source.streaming ? " (still running)" : ""}`,
                    )
                    .join("\n"),
        );
    }
    return undefined;
}

function describeOrExplain(
    snapshotId: string,
    stream: vscode.ChatResponseStream,
): QueryResultSnapshotDescription | undefined {
    const description = getQueryResultAccessService().describeSnapshot(snapshotId);
    if (!description) {
        stream.markdown("That snapshot has expired — run the query and pin it again.");
    }
    return description;
}

async function summarize(
    snapshotId: string,
    stream: vscode.ChatResponseStream,
    withValues: boolean,
    token: vscode.CancellationToken,
): Promise<void> {
    const description = describeOrExplain(snapshotId, stream);
    if (!description) {
        return;
    }
    stream.markdown(
        `**${description.source.sourceTitle}** — ${description.resultSetCount} result set(s), ` +
            `${description.totalRows.toLocaleString()} rows` +
            `${description.derived ? " (derived view)" : ""}.\n\n`,
    );
    for (const set of description.resultSets.slice(0, 5)) {
        const columns = set.columnNames.slice(0, PROFILE_COLUMN_LIMIT);
        const aggs: TransformAggregate[] = [{ fn: "count" }];
        for (let index = 0; index < columns.length; index++) {
            aggs.push({ fn: "nullCount", col: index });
            if (withValues) {
                aggs.push({ fn: "min", col: index });
                aggs.push({ fn: "max", col: index });
            }
        }
        const spec: TransformSpec = {
            v: 1,
            source: { snapshotId, resultSetId: set.resultSetId },
            terminal: { kind: "aggregate", aggs },
        };
        const grantId = withValues
            ? gate.mint({ snapshotId, ownerKey: OWNER_KEY, operationClass: "values" }).grantId
            : undefined;
        const result = await access().evaluateTransform(spec, {
            ownerKey: OWNER_KEY,
            ...(grantId ? { grantId } : {}),
            isCancelled: () => token.isCancellationRequested,
        });
        const total = result.rows[0]?.[0] as number;
        const lines = columns.map((name, index) => {
            const base = 1 + index * (withValues ? 3 : 1);
            const nulls = result.rows[0]?.[base] as number;
            const nullPct = total > 0 ? Math.round((nulls / total) * 100) : 0;
            const truncated = set.truncatedReason ? " · truncated" : "";
            if (!withValues) {
                return `| \`${name}\` | ${set.columns?.[index]?.sqlType ?? ""} | ${nullPct}% |`;
            }
            const min = result.rows[0]?.[base + 1];
            const max = result.rows[0]?.[base + 2];
            return `| \`${name}\` | ${set.columns?.[index]?.sqlType ?? ""} | ${nullPct}% | ${String(min ?? "—")} | ${String(max ?? "—")}${truncated} |`;
        });
        const header = withValues
            ? "| column | type | nulls | min | max |\n|---|---|---|---|---|"
            : "| column | type | nulls |\n|---|---|---|";
        stream.markdown(
            `**Result set ${set.resultSetId}** — ${set.rowCount.toLocaleString()} rows` +
                `${set.truncatedReason ? ` (truncated: ${set.truncatedReason})` : ""}\n\n${header}\n${lines.join("\n")}\n\n`,
        );
        if (set.columnNames.length > PROFILE_COLUMN_LIMIT) {
            stream.markdown(
                `_…and ${set.columnNames.length - PROFILE_COLUMN_LIMIT} more columns (profiled columns are capped)._\n\n`,
            );
        }
        if (result.stats.partial) {
            stream.markdown(
                `⚠ Partial scan (${result.stats.partialReason}): numbers cover the first ${result.stats.rowsScanned.toLocaleString()} rows.\n\n`,
            );
        }
    }
    if (description.resultSets.length > 5) {
        stream.markdown(`_…and ${description.resultSets.length - 5} more result sets._\n`);
    }
}

/** The gate's own consent surface for the participant path (§1.3). */
async function confirmValues(target: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
        "Share query result values with chat?",
        {
            modal: true,
            detail:
                `@query will read per-column minimum/maximum values from ${target} and show them in this chat. ` +
                "Schema, row counts, and null ratios never need this confirmation. This allows one read.",
        },
        "Allow once",
    );
    return choice === "Allow once";
}

async function handleRequest(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<void> {
    if (featureBlocked(stream)) {
        return;
    }
    const service = getQueryResultAccessService();
    switch (request.command) {
        case "list": {
            const live = service.listLiveSources();
            const snapshots = service.listSnapshots();
            stream.markdown(
                `**Live results** (${live.length})\n\n` +
                    (live.length
                        ? live
                              .map(
                                  (source) =>
                                      `- ${source.sourceTitle} — ${source.resultSetCount} set(s), ${source.totalRows.toLocaleString()} rows${source.streaming ? " (running)" : ""}`,
                              )
                              .join("\n")
                        : "- none — run a query in Query Studio") +
                    `\n\n**Snapshots** (${snapshots.length})\n\n` +
                    (snapshots.length
                        ? snapshots
                              .map(
                                  (snapshot) =>
                                      `- ${snapshot.source.sourceTitle} — ${snapshot.totalRows.toLocaleString()} rows, ${snapshot.purpose}, ${Math.round((Date.now() - snapshot.createdEpochMs) / 60000)}m old`,
                              )
                              .join("\n")
                        : "- none"),
            );
            return;
        }
        case "pin": {
            const context = getQueryResultContextService().current();
            const sourceId =
                context?.kind === "queryStudio" && context.sourceId
                    ? context.sourceId
                    : service.listLiveSources().find((s) => s.resultSetCount > 0 && !s.streaming)
                          ?.sourceId;
            if (!sourceId) {
                stream.markdown("No completed live results to pin — run a query first.");
                return;
            }
            const lease = await service.createSnapshot({
                owner: { kind: "pinnedDocument", label: "@query /pin" },
                reason: "Pinned from @query",
                sourceId,
                scope: { kind: "allCompleteResultSets" },
                includeMessages: "allLocal",
                includeQueryText: "digest",
            });
            try {
                const opened = await openPinnedResultsDocument(lease.snapshotId);
                stream.markdown(
                    opened
                        ? "Pinned — the results now live in a read-only tab that survives reruns."
                        : "The snapshot was created but the pinned tab could not be opened.",
                );
            } finally {
                lease.dispose();
            }
            return;
        }
        case "profile": {
            const snapshotId = await resolveTargetSnapshot(stream);
            if (!snapshotId) {
                return;
            }
            const description = describeOrExplain(snapshotId, stream);
            if (!description) {
                return;
            }
            if (!(await confirmValues(description.source.sourceTitle))) {
                stream.markdown("Profile cancelled — here is the value-free summary instead.\n\n");
                await summarize(snapshotId, stream, false, token);
                return;
            }
            await summarize(snapshotId, stream, true, token);
            return;
        }
        case "summarize":
        default: {
            const snapshotId = await resolveTargetSnapshot(stream);
            if (!snapshotId) {
                return;
            }
            await summarize(snapshotId, stream, false, token);
            if (!request.command) {
                stream.markdown(
                    "\n_Commands: `/list`, `/summarize`, `/profile` (adds min/max, asks first), `/pin`. " +
                        "Agent mode can analyze further with the `query_results` tool._",
                );
            }
        }
    }
}

export function registerQueryParticipant(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleRequest);
    participant.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "images",
        "mssql-chat-avatar.jpg",
    );
    context.subscriptions.push(participant);
}
