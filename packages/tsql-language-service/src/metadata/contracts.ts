/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SqlMetadataObjectKind =
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym"
    | "type"
    | "unknown";

export interface SqlMetadataColumn {
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly ordinal: number;
}

export interface SqlMetadataParameter {
    readonly name: string;
    readonly type: string;
    readonly ordinal: number;
    readonly output: boolean;
}

export interface SqlMetadataObject {
    readonly database: string;
    readonly schema: string;
    readonly name: string;
    readonly kind: SqlMetadataObjectKind;
    readonly columns: readonly SqlMetadataColumn[];
    readonly parameters: readonly SqlMetadataParameter[];
    readonly returnType?: string;
    readonly synonymTarget?: readonly string[];
}

export interface SqlMetadataLoadResult {
    readonly database: string;
    readonly objects: readonly SqlMetadataObject[];
}

export interface SqlQueryColumn {
    readonly name: string;
    readonly value: unknown;
}

/** Strategy seam for executing metadata queries without coupling the repository to Tedious. */
export interface SqlQueryExecutor {
    execute<T>(
        sql: string,
        mapRow: (columns: readonly SqlQueryColumn[]) => T | undefined,
        signal?: AbortSignal,
    ): Promise<readonly T[]>;
}

export interface SqlMetadataLoader {
    load(signal?: AbortSignal): Promise<SqlMetadataLoadResult>;
}

export interface SqlMetadataCatalog {
    readonly version: string | number;
    readonly database: string;
    readonly objects: readonly SqlMetadataObject[];
    resolve(parts: readonly string[]): SqlMetadataObject | undefined;
    search(prefix: readonly string[], limit?: number): readonly SqlMetadataObject[];
    children(prefix: readonly string[]): readonly SqlMetadataObject[];
}
