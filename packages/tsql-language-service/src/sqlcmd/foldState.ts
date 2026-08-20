/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlCmdConnectionRegion,
    SqlCmdDiagnostic,
    SqlCmdDirective,
    SqlCmdIncludeDependency,
    SqlCmdMapping,
    SqlCmdVariableDefinition,
    SqlCmdVariableReference,
} from "./contracts.js";

/** Incremental fold state recorded at the start of one root source line. */
export interface FoldCheckpoint {
    readonly projectedLength: number;
    readonly partCount: number;
    readonly mappingCount: number;
    readonly directiveCount: number;
    readonly definitionCount: number;
    readonly referenceCount: number;
    readonly includeCount: number;
    readonly diagnosticCount: number;
    readonly regionCount: number;
    readonly includeCharacters: number;
    readonly regionStart: number;
    readonly variables: ReadonlyMap<string, string>;
    readonly pendingRegion: PendingRegion;
}

export interface PendingRegion {
    readonly index: number;
    readonly server?: string;
    readonly connectionId?: string;
    readonly displayName?: string;
    readonly directive?: SqlCmdDirective;
}

/** Mutable builder state retained privately while producing an immutable SQLCMD snapshot. */
export interface FoldState {
    variables: ReadonlyMap<string, string>;
    readonly parts: string[];
    projectedLength: number;
    readonly mappings: SqlCmdMapping[];
    readonly directives: SqlCmdDirective[];
    readonly definitions: SqlCmdVariableDefinition[];
    readonly references: SqlCmdVariableReference[];
    readonly includes: SqlCmdIncludeDependency[];
    readonly diagnostics: SqlCmdDiagnostic[];
    readonly regions: SqlCmdConnectionRegion[];
    regionStart: number;
    pendingRegion: PendingRegion;
    includeCharacters: number;
}
