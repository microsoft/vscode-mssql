/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FoldingRange } from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import type { DocumentLineSource } from "./previewSemanticTokens";

/**
 * Converts the offset ranges the language service publishes into the line pairs VS Code folds on.
 * The service already guarantees each range covers more than one line, begins on a line of its own,
 * and nests without partial overlap, so this only changes the coordinate system.
 */
export function toVscodeFoldingRanges(
    ranges: readonly FoldingRange[],
    source: DocumentLineSource,
): vscode.FoldingRange[] {
    const result: vscode.FoldingRange[] = [];
    for (const range of ranges) {
        const start = source.lineAt(range.start).line;
        const end = source.lineAt(range.end).line;
        if (end <= start) continue;
        result.push(new vscode.FoldingRange(start, end, foldingKind(range.kind)));
    }
    return result;
}

function foldingKind(kind: FoldingRange["kind"]): vscode.FoldingRangeKind | undefined {
    switch (kind) {
        case "comment":
            return vscode.FoldingRangeKind.Comment;
        case "region":
            return vscode.FoldingRangeKind.Region;
        default:
            return undefined;
    }
}
