/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EngineCapabilities } from "../common/engineCapabilities.js";
import type { EngineFacts } from "../common/engineProfile.js";
import type {
    LanguageServiceStatsProvider,
    RequestLatencyRecorder,
} from "../observability/index.js";
import type { SemanticSnapshot } from "../semantics/index.js";
import type { MetadataView } from "../metadata/index.js";
import type { SyntaxSnapshot } from "../syntax/index.js";
import type { SqlCmdDocumentSnapshot, SqlCmdSourceRange } from "../sqlcmd/index.js";
import type { TextChange, TextRange, TextSnapshot } from "../text/index.js";

export interface DocumentAnalysisSnapshot {
    /** The document as the host holds it, in the coordinates a host edit and a host range use. */
    readonly text: TextSnapshot;
    /**
     * The SQLCMD reading of {@link text}: directives, variables, includes, connection regions, and
     * the map from projected SQL back to whichever file each character came from.
     *
     * It is present for every document. A file that uses no SQLCMD syntax projects its own text
     * unchanged and carries one identity mapping, so an ordinary `.sql` file pays nothing for it,
     * and no feature has to invent its own handling for `:setvar`, `$(var)`, or `:r`.
     */
    readonly projection: SqlCmdDocumentSnapshot;
    /**
     * The text the parser and binder actually analysed.
     *
     * Identical to {@link text} — the same object — whenever the projection is the identity one.
     * Syntax and semantic offsets are in these coordinates; {@link sourceRangeOf} converts them
     * back to the host's.
     */
    readonly projectedText: TextSnapshot;
    readonly syntax: SyntaxSnapshot;
    readonly semantics: SemanticSnapshot;
    /** The immutable pinned catalog view used to produce {@link semantics}. */
    readonly metadata: MetadataView;
    /**
     * The source spans a projected range came from, or several when it crosses an included file.
     *
     * A range inside a substitution maps to the whole `$(name)` reference rather than to a
     * character position that does not exist in the source.
     */
    sourceRangeOf(range: TextRange): readonly SqlCmdSourceRange[];
}

export interface LanguageServiceRuntime extends LanguageServiceStatsProvider {
    readonly mode: "in-process" | "node-worker" | "web-worker";
    /**
     * Where feature latency is recorded, when this runtime reports it.
     *
     * Exposed on the runtime rather than owned by the feature service because the statistics store
     * is here: a recorder the publisher could not reach would collect numbers nothing reports.
     */
    readonly requests?: RequestLatencyRecorder;
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
