/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Position } from "vscode-languageserver-types";
import type { SqlAnalysisSnapshot } from "../../analysis/contracts.js";

export interface SqlFeatureDocument {
    readonly uri: string;
    /** Exact editor text; analysis text may contain recovery-only suffixes. */
    readonly text: string;
    readonly analysis: SqlAnalysisSnapshot;
    readonly version?: number;
}

export type MaybePromise<T> = T | Promise<T>;

export interface SqlFeatureDocumentAccessor {
    getDocument(uri: string): MaybePromise<SqlFeatureDocument | undefined>;
}

export function positionAt(document: SqlFeatureDocument, offset: number): Position {
    return document.analysis.positionAt(clampOffset(document, offset));
}

export function offsetAt(document: SqlFeatureDocument, position: Position): number {
    return clampOffset(document, document.analysis.offsetAt(position));
}

function clampOffset(document: SqlFeatureDocument, offset: number): number {
    return Math.max(0, Math.min(offset, document.text.length));
}
