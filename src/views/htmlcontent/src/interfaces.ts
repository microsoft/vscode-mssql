/**
 * Interfaces needed for interacting with the localwebservice
 * Separate from the contracts defined in the models folder because that version has
 * a dependency on vscode which will not build on the front end
 * Must be updated whenever there is a change to these interfaces
 */

export interface IDbColumn {
    allowDBNull?: boolean;
    baseCatalogName: string;
    baseColumnName: string;
    baseSchemaName: string;
    baseServerName: string;
    baseTableName: string;
    columnName: string;
    columnOrdinal?: number;
    columnSize?: number;
    isAliased?: boolean;
    isAutoIncrement?: boolean;
    isExpression?: boolean;
    isHidden?: boolean;
    isIdentity?: boolean;
    isKey?: boolean;
    isLong?: boolean;
    isReadOnly?: boolean;
    isUnique?: boolean;
    numericPrecision?: number;
    numericScale?: number;
    udtAssemblyQualifiedName: string;
    dataTypeName: string;
}

export class ResultSetSubset {
    rowCount: number;
    rows: any[][];
}

export interface IGridResultSet {
    columnsUri: string;
    rowsUri: string;
    numberOfRows: number;
}

export interface IGridBatchMetaData {
    resultSets: IGridResultSet[];
    messages: string[];
}
