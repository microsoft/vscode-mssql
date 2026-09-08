/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue, IDbColumn, ISlickRange } from "../../sharedInterfaces/queryResult";
import type { IDisposableDataProvider } from "../pages/QueryResult/table/dataProvider";
import { getEOL } from "./utils";

export const NUMERIC_SQL_TYPES = new Set([
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "decimal",
    "numeric",
    "float",
    "real",
    "money",
    "smallmoney",
    "bit",
]);

const SQL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
export const INSERT_ROW_LIMIT = 1000;

export function isNumericSqlType(dataTypeName: string | undefined): boolean {
    return !!dataTypeName && NUMERIC_SQL_TYPES.has(dataTypeName.toLowerCase());
}

export function sqlStr(v: string): string {
    return "'" + v.replace(/'/g, "''") + "'";
}

export function escapeSqlIdentifier(value: string): string {
    return `[${value.replaceAll("]", "]]")}]`;
}

export function getColumnInfo<T extends Slick.SlickData>(
    columnInfo: IDbColumn[],
    col: Slick.Column<T> | undefined,
): IDbColumn | undefined {
    const colIndex = col?.field ? parseInt(col.field, 10) : NaN;
    return !isNaN(colIndex) ? columnInfo[colIndex] : undefined;
}

export function getAllDataColumnIndices<T extends Slick.SlickData>(
    columns: Slick.Column<T>[],
): number[] {
    const result: number[] = [];
    columns.forEach((col, i) => {
        if (col?.id !== "rowNumber" && col?.field) {
            result.push(i);
        }
    });
    return result;
}

export function getSelectedColumnIndices<T extends Slick.SlickData>(
    ranges: ISlickRange[],
    columns: Slick.Column<T>[],
): number[] {
    const selected = new Set<number>();
    for (const range of ranges) {
        for (let c = range.fromCell; c <= range.toCell; c++) {
            const col = columns[c];
            if (col?.id !== "rowNumber" && col?.field) {
                selected.add(c);
            }
        }
    }
    return [...selected].sort((a, b) => a - b);
}

export function isCellSelected(ranges: ISlickRange[], row: number, colIndex: number): boolean {
    return ranges.some(
        (rng) =>
            row >= rng.fromRow &&
            row <= rng.toRow &&
            colIndex >= rng.fromCell &&
            colIndex <= rng.toCell,
    );
}

export function isSingleRowSelection(ranges: ISlickRange[]): boolean {
    return ranges.length === 1 && ranges[0].fromRow === ranges[0].toRow;
}

export function isFullRowSelected<T extends Slick.SlickData>(
    ranges: ISlickRange[],
    columns: Slick.Column<T>[],
): boolean {
    const dataColIndices = getAllDataColumnIndices(columns);
    if (!isSingleRowSelection(ranges) || dataColIndices.length === 0) {
        return false;
    }
    const [range] = ranges;
    const minIdx = Math.min(...dataColIndices);
    const maxIdx = Math.max(...dataColIndices);
    return range.fromCell <= minIdx && range.toCell >= maxIdx;
}

export interface ColumnValuePair<T extends Slick.SlickData> {
    column: Slick.Column<T>;
    dbColumn: IDbColumn | undefined;
    cellValue: DbCellValue | undefined;
}

export function getColumnValuePair<T extends Slick.SlickData>(
    colIndex: number,
    row: number,
    columns: Slick.Column<T>[],
    dataProvider: IDisposableDataProvider<T>,
    columnInfo: IDbColumn[],
): ColumnValuePair<T> {
    const column = columns[colIndex];
    const item = dataProvider.getItem(row) as Slick.SlickData;
    const cellValue = column?.field ? (item?.[column.field] as DbCellValue | undefined) : undefined;
    return { column, dbColumn: getColumnInfo(columnInfo, column), cellValue };
}

export function getColumnIdentifier<T extends Slick.SlickData>(pair: ColumnValuePair<T>): string {
    return pair.dbColumn?.baseColumnName || pair.column?.toolTip || pair.column?.name || "";
}

export function formatSqlValue<T extends Slick.SlickData>(pair: ColumnValuePair<T>): string {
    if (!pair.cellValue || pair.cellValue.isNull) {
        return "NULL";
    }
    const val = pair.cellValue.displayValue ?? "";
    return isNumericSqlType(pair.dbColumn?.dataTypeName) && SQL_NUMBER_PATTERN.test(val)
        ? val
        : sqlStr(val);
}

export function buildQualifiedTableName(dbColumn: IDbColumn | undefined): string {
    if (!dbColumn?.baseTableName) {
        return "UnknownTable";
    }
    const table = escapeSqlIdentifier(dbColumn.baseTableName);
    return dbColumn.baseSchemaName
        ? `${escapeSqlIdentifier(dbColumn.baseSchemaName)}.${table}`
        : table;
}

export function buildWhereClause<T extends Slick.SlickData>(pairs: ColumnValuePair<T>[]): string {
    return pairs
        .map((pair) => {
            const colName = escapeSqlIdentifier(getColumnIdentifier(pair));
            if (!pair.cellValue || pair.cellValue.isNull) {
                return `${colName} IS NULL`;
            }
            return `${colName} = ${formatSqlValue(pair)}`;
        })
        .join(" AND ");
}

function getRowPairs<T extends Slick.SlickData>(
    colIndices: number[],
    row: number,
    columns: Slick.Column<T>[],
    dataProvider: IDisposableDataProvider<T>,
    columnInfo: IDbColumn[],
): ColumnValuePair<T>[] {
    return colIndices.map((i) => getColumnValuePair(i, row, columns, dataProvider, columnInfo));
}

export function generateSelect<T extends Slick.SlickData>(
    row: number,
    selectedColumnIndices: number[],
    columns: Slick.Column<T>[],
    dataProvider: IDisposableDataProvider<T>,
    columnInfo: IDbColumn[],
): string {
    const eol = getEOL();
    const allPairs = getRowPairs(
        getAllDataColumnIndices(columns),
        row,
        columns,
        dataProvider,
        columnInfo,
    );
    const wherePairs = getRowPairs(selectedColumnIndices, row, columns, dataProvider, columnInfo);
    const colNames = allPairs.map((p) => escapeSqlIdentifier(getColumnIdentifier(p))).join(", ");
    const table = buildQualifiedTableName(wherePairs[0]?.dbColumn ?? allPairs[0]?.dbColumn);
    return `SELECT ${colNames}${eol}FROM ${table}${eol}WHERE ${buildWhereClause(wherePairs)};`;
}

export function generateDelete<T extends Slick.SlickData>(
    row: number,
    selectedColumnIndices: number[],
    columns: Slick.Column<T>[],
    dataProvider: IDisposableDataProvider<T>,
    columnInfo: IDbColumn[],
): string {
    const eol = getEOL();
    const wherePairs = getRowPairs(selectedColumnIndices, row, columns, dataProvider, columnInfo);
    const table = buildQualifiedTableName(wherePairs[0]?.dbColumn);
    return `DELETE FROM ${table}${eol}WHERE ${buildWhereClause(wherePairs)};`;
}

export function generateUpdate<T extends Slick.SlickData>(
    row: number,
    selectedColumnIndices: number[],
    columns: Slick.Column<T>[],
    dataProvider: IDisposableDataProvider<T>,
    columnInfo: IDbColumn[],
): string {
    const eol = getEOL();
    const wherePairs = getRowPairs(selectedColumnIndices, row, columns, dataProvider, columnInfo);
    const whereFields = new Set(wherePairs.map((p) => p.column.field));
    const setPairs = getRowPairs(
        getAllDataColumnIndices(columns),
        row,
        columns,
        dataProvider,
        columnInfo,
    ).filter((p) => !whereFields.has(p.column.field));
    const table = buildQualifiedTableName(wherePairs[0]?.dbColumn ?? setPairs[0]?.dbColumn);
    const setClause = setPairs
        .map((p) => `${escapeSqlIdentifier(getColumnIdentifier(p))} = ${formatSqlValue(p)}`)
        .join(`,${eol}    `);
    return `UPDATE ${table}${eol}SET ${setClause}${eol}WHERE ${buildWhereClause(wherePairs)};`;
}

export function generateInsertForRows<T extends Slick.SlickData>(
    ranges: ISlickRange[],
    columns: Slick.Column<T>[],
    dataProvider: IDisposableDataProvider<T>,
    columnInfo: IDbColumn[],
): string {
    const eol = getEOL();
    const colIndices = getSelectedColumnIndices(ranges, columns);
    const colMeta = colIndices.map((i) => ({
        index: i,
        column: columns[i],
        dbColumn: getColumnInfo(columnInfo, columns[i]),
    }));

    const valueRows: string[] = [];
    for (const range of ranges) {
        for (let r = range.fromRow; r <= range.toRow; r++) {
            const values = colMeta.map(({ index }) =>
                isCellSelected(ranges, r, index)
                    ? formatSqlValue(
                          getColumnValuePair(index, r, columns, dataProvider, columnInfo),
                      )
                    : "NULL",
            );
            valueRows.push(`    (${values.join(", ")})`);
        }
    }

    if (colMeta.length === 0 || valueRows.length === 0) {
        return "";
    }

    const colNames = colMeta
        .map(({ column, dbColumn }) =>
            escapeSqlIdentifier(dbColumn?.baseColumnName || column.toolTip || column.name || ""),
        )
        .join(", ");
    const table = buildQualifiedTableName(colMeta[0]?.dbColumn);
    const statements: string[] = [];
    for (let start = 0; start < valueRows.length; start += INSERT_ROW_LIMIT) {
        const batch = valueRows.slice(start, start + INSERT_ROW_LIMIT);
        const rowLines = batch.map((row, i) => row + (i < batch.length - 1 ? "," : ";"));
        statements.push([`INSERT INTO ${table} (${colNames})`, "VALUES", ...rowLines].join(eol));
    }
    return statements.join(eol + eol);
}
