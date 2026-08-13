/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceStatsProvider } from "../observability/index.js";
import type { SemanticSnapshot } from "../semantics/index.js";
import type { SyntaxSnapshot } from "../syntax/index.js";
import type { TextChange, TextSnapshot } from "../text/index.js";

export interface DocumentAnalysisSnapshot {
    readonly text: TextSnapshot;
    readonly syntax: SyntaxSnapshot;
    readonly semantics: SemanticSnapshot;
}

export interface LanguageServiceRuntime extends LanguageServiceStatsProvider {
    readonly mode: "in-process" | "node-worker" | "web-worker";
    open(uri: string, version: number, text: string): Promise<DocumentAnalysisSnapshot>;
    change(
        uri: string,
        expectedVersion: number,
        version: number,
        changes: readonly TextChange[],
    ): Promise<DocumentAnalysisSnapshot>;
    /** Rebinds the existing parse against the latest metadata without invoking the parser. */
    rebind(uri: string, expectedVersion: number): Promise<DocumentAnalysisSnapshot>;
    close(uri: string): Promise<void>;
    snapshot(uri: string, expectedVersion: number): DocumentAnalysisSnapshot;
}
