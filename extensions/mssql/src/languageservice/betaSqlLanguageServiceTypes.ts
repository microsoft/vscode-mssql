/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlCatalogColumn,
    SqlCatalogObject,
    SqlCatalogMapping,
    SqlCatalogMappingLeaf,
    SqlCatalogProvider,
    SqlCompletion,
    SqlDiagnostic,
    SqlSymbol,
    SqlToken,
} from "@vscode-mssql/tsql-language-service";

export interface DatabaseObject {
    server?: string;
    database?: string;
    schema: string;
    name: string;
    type: "table" | "view" | "scalarFunction" | "tableValuedFunction" | "storedProcedure";
    baseObject?: ObjectReference;
}

export interface ObjectReference {
    server?: string;
    database?: string;
    schema?: string;
    name: string;
}

export interface ObjectMember {
    name: string;
    type: string;
    nullable?: boolean;
    insertable?: boolean;
}

export interface QualifiedPrefix {
    qualifiers: string[];
    prefix: string;
}

export interface InsertColumnContext {
    target: ObjectReference;
    usedColumns: Set<string>;
    contentStartOffset: number;
    canExpand: boolean;
}

export interface SelectStarExpansionContext {
    startOffset: number;
    endOffset: number;
}

export interface ExecuteParameterContext {
    routine: ObjectReference;
    prefix: string;
    usedParameters: Set<string>;
}

export interface RoutineCallContext {
    routine: ObjectReference;
    activeParameter: number;
    kind: "function" | "execute";
}

export interface InsertValuesContext {
    target: ObjectReference;
    columns?: string[];
    activeParameter: number;
}

export type CreateTableCompletionKind =
    | "tableName"
    | "columnName"
    | "definition"
    | "dataType"
    | "typeArgument"
    | "columnOption"
    | "nullKeyword"
    | "keyKeyword"
    | "constraintType"
    | "localColumn"
    | "referencesKeyword"
    | "referenceTable"
    | "referenceColumn"
    | "expression";

export interface CreateTableCompletionContext {
    kind: CreateTableCompletionKind;
    table?: ObjectReference;
    columns: ObjectMember[];
    prefix: string;
    qualifiers?: string[];
    referencedTable?: ObjectReference;
    usedColumns?: Set<string>;
    typeName?: string;
}

export type AnalysisDiagnostic = SqlDiagnostic;
export type Column = SqlCatalogColumn;
export type Completion = SqlCompletion;
export type Sym = SqlSymbol;
export type Token = SqlToken;
export type SchemaMapping = SqlCatalogMapping;
export type SchemaLeaf = SqlCatalogMappingLeaf;

export interface SchemaProvider extends SqlCatalogProvider {
    columnsFor(parts: readonly string[], dialect?: string): readonly Column[] | undefined;
    tableCandidates?(parts: readonly string[], dialect?: string): readonly (readonly string[])[];
    typeCandidates?(parts: readonly string[], dialect?: string): readonly SqlCatalogObject[];
    xmlSchemaCandidates?(parts: readonly string[], dialect?: string): readonly SqlCatalogObject[];
    childrenOf?(
        prefixParts: readonly string[],
        dialect?: string,
    ): readonly {
        name: string;
        kind: "namespace" | "table";
    }[];
    tables?(dialect?: string): readonly string[];
}
