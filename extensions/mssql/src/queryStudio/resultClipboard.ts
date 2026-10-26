/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { QsCopySelectionResult, QsResultSetSummary } from "../sharedInterfaces/queryStudio";
import {
    buildQueryStudioGridCopyText,
    planQueryStudioGridCopy,
    QueryStudioGridCopyRange,
} from "../sharedInterfaces/queryStudioGridCopy";

/** Shared host copy for live and pinned grids, with identical bounds and cell fidelity. */
export async function copyQueryStudioSelection(
    summary: QsResultSetSummary | undefined,
    selection: QueryStudioGridCopyRange[],
    includeHeaders: boolean,
    getRows: Parameters<typeof buildQueryStudioGridCopyText>[0]["getRows"],
): Promise<QsCopySelectionResult> {
    if (!summary) {
        return {
            outcome: "empty" as const,
            characters: 0,
            fetchCount: 0,
            fetchMs: 0,
            formatMs: 0,
            clipboardMs: 0,
            windowRows: 0,
        };
    }
    // Re-plan against host-authoritative cardinality. A stale
    // webview command therefore cannot fetch outside the current
    // run or bypass the grid copy bounds.
    const planned = planQueryStudioGridCopy(
        selection,
        summary.rowCount,
        summary.columnNames.length,
    );
    if (planned.kind !== "ok") {
        return {
            outcome: planned.kind,
            characters: 0,
            fetchCount: 0,
            fetchMs: 0,
            formatMs: 0,
            clipboardMs: 0,
            windowRows: 0,
            ...(planned.kind === "tooLarge" ? { reason: planned.reason } : {}),
        };
    }
    const built = await buildQueryStudioGridCopyText({
        plan: planned.plan,
        columnNames: summary.columnNames,
        includeHeaders,
        getRows,
    });
    const details = {
        rows: planned.plan.rowCount,
        columns: planned.plan.columnCount,
        cells: planned.plan.outputCellCount,
    };
    if (built.kind !== "copied") {
        return {
            outcome: built.kind,
            characters: built.characters,
            fetchCount: built.fetchCount,
            fetchMs: built.fetchMs,
            formatMs: built.formatMs,
            clipboardMs: 0,
            windowRows: built.windowRows,
            ...details,
            ...(built.kind === "tooLarge" ? { reason: "characters" as const } : {}),
        };
    }
    const clipboardStarted = performance.now();
    await vscode.env.clipboard.writeText(built.text);
    return {
        outcome: "copied" as const,
        characters: built.characters,
        fetchCount: built.fetchCount,
        fetchMs: built.fetchMs,
        formatMs: built.formatMs,
        clipboardMs: Math.max(0, performance.now() - clipboardStarted),
        windowRows: built.windowRows,
        ...details,
    };
}
