/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EngineCapabilities } from "../common/engineCapabilities.js";
import type { EngineFacts } from "../common/engineProfile.js";
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
    /**
     * The engine profile every document currently open in this runtime is analysed under.
     *
     * It is `unknown` until a host reports server facts. Nothing downgrades it to SQL Server
     * merely because metadata has not arrived.
     */
    readonly capabilities: EngineCapabilities;
    /**
     * Adopts newly observed server facts and republishes every open document under the resolved
     * profile. Documents whose text did not change are not reparsed: only the availability layer
     * and the binding that depends on it are recomputed.
     *
     * Returns the capabilities in force afterwards, which are unchanged when the facts resolve to
     * the same profile generation.
     */
    setEngineFacts(facts: EngineFacts | undefined): Promise<EngineCapabilities>;
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
