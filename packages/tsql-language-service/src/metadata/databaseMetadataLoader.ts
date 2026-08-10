/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlMetadataColumn,
    SqlMetadataLoadResult,
    SqlMetadataLoader,
    SqlMetadataObject,
    SqlMetadataObjectKind,
    SqlMetadataParameter,
    SqlQueryColumn,
    SqlQueryExecutor,
} from "./contracts.js";

interface MetadataRow {
    readonly database: string;
    readonly schema: string;
    readonly object: string;
    readonly objectType: string;
    readonly memberKind: string;
    readonly memberName?: string;
    readonly typeName?: string;
    readonly nullable?: boolean;
    readonly ordinal?: number;
    readonly output?: boolean;
    readonly synonymTarget?: string;
}

/** Repository loader which turns normalized catalog rows into immutable object aggregates. */
export class DatabaseMetadataLoader implements SqlMetadataLoader {
    public constructor(private readonly executor: SqlQueryExecutor) {}

    public async load(signal?: AbortSignal): Promise<SqlMetadataLoadResult> {
        const rows = await this.executor.execute(METADATA_QUERY, mapMetadataRow, signal);
        const database = rows[0]?.database ?? "";
        const builders = new Map<
            string,
            {
                database: string;
                schema: string;
                name: string;
                kind: SqlMetadataObjectKind;
                columns: SqlMetadataColumn[];
                parameters: SqlMetadataParameter[];
                returnType?: string;
                synonymTarget?: readonly string[];
            }
        >();

        for (const row of rows) {
            const key = `${row.database}\u0000${row.schema}\u0000${row.object}`;
            let object = builders.get(key);
            if (!object) {
                object = {
                    database: row.database,
                    schema: row.schema,
                    name: row.object,
                    kind: mapObjectKind(row.objectType),
                    columns: [],
                    parameters: [],
                    synonymTarget: splitMultipartName(row.synonymTarget),
                };
                builders.set(key, object);
            }
            if (row.memberKind === "column" && row.memberName && row.typeName) {
                object.columns.push({
                    name: row.memberName,
                    type: row.typeName,
                    nullable: row.nullable ?? true,
                    ordinal: row.ordinal ?? object.columns.length + 1,
                });
            } else if (row.memberKind === "parameter" && row.memberName && row.typeName) {
                object.parameters.push({
                    name: row.memberName,
                    type: row.typeName,
                    ordinal: row.ordinal ?? object.parameters.length + 1,
                    output: row.output ?? false,
                });
            } else if (row.memberKind === "return" && row.typeName) {
                object.returnType = row.typeName;
            }
        }

        const objects: SqlMetadataObject[] = [...builders.values()].map((object) => ({
            ...object,
            columns: object.columns.sort((left, right) => left.ordinal - right.ordinal),
            parameters: object.parameters.sort((left, right) => left.ordinal - right.ordinal),
        }));
        return { database, objects };
    }
}

function mapMetadataRow(columns: readonly SqlQueryColumn[]): MetadataRow | undefined {
    const values = new Map(columns.map((column) => [column.name.toLowerCase(), column.value]));
    const database = toString(values.get("database_name"));
    const schema = toString(values.get("schema_name"));
    const object = toString(values.get("object_name"));
    const objectType = toString(values.get("object_type"));
    const memberKind = toString(values.get("member_kind"));
    if (!database || !schema || !object || !objectType || !memberKind) {
        return undefined;
    }
    return {
        database,
        schema,
        object,
        objectType,
        memberKind,
        memberName: toString(values.get("member_name")),
        typeName: toString(values.get("type_name")),
        nullable: toBoolean(values.get("is_nullable")),
        ordinal: toNumber(values.get("ordinal")),
        output: toBoolean(values.get("is_output")),
        synonymTarget: toString(values.get("synonym_target")),
    };
}

function mapObjectKind(type: string): SqlMetadataObjectKind {
    switch (type.trim()) {
        case "U":
            return "table";
        case "V":
            return "view";
        case "P":
        case "PC":
            return "procedure";
        case "FN":
        case "FS":
            return "scalarFunction";
        case "IF":
        case "TF":
        case "FT":
            return "tableFunction";
        case "SN":
            return "synonym";
        default:
            return "unknown";
    }
}

function toString(value: unknown): string | undefined {
    return value === undefined || value === null ? undefined : String(value);
}

function toNumber(value: unknown): number | undefined {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        if (/^(true|1)$/iu.test(value)) {
            return true;
        }
        if (/^(false|0)$/iu.test(value)) {
            return false;
        }
    }
    return undefined;
}

function splitMultipartName(value: string | undefined): readonly string[] | undefined {
    return value
        ?.split(".")
        .map((part) => part.trim())
        .filter(Boolean);
}

// One set-based read prevents object/column/parameter N+1 metadata queries. Do not use NOLOCK:
// a catalog snapshot must not publish a mixture of pre- and post-DDL metadata rows.
const METADATA_QUERY = `
SELECT
    DB_NAME() AS database_name,
    schema_name = s.name,
    object_name = o.name,
    object_type = o.type,
    member_kind = COALESCE(m.member_kind, N'object'),
    member_name = m.member_name,
    type_name = CASE
        WHEN ty.name IN (N'nvarchar', N'nchar') AND m.max_length <> -1
            THEN CONCAT(ty.name, N'(', m.max_length / 2, N')')
        WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary')
            THEN CONCAT(ty.name, N'(', CASE WHEN m.max_length = -1 THEN N'max'
                ELSE CONVERT(nvarchar(10), m.max_length) END, N')')
        WHEN ty.name IN (N'decimal', N'numeric')
            THEN CONCAT(ty.name, N'(', m.precision, N',', m.scale, N')')
        WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time')
            THEN CONCAT(ty.name, N'(', m.scale, N')')
        ELSE ty.name
    END,
    is_nullable = m.is_nullable,
    ordinal = m.ordinal,
    is_output = m.is_output,
    synonym_target = sy.base_object_name
FROM sys.all_objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
OUTER APPLY (
    SELECT
        member_kind = N'column',
        member_name = c.name,
        user_type_id = c.user_type_id,
        max_length = c.max_length,
        precision = c.precision,
        scale = c.scale,
        is_nullable = c.is_nullable,
        ordinal = c.column_id,
        is_output = CONVERT(bit, 0)
    FROM sys.all_columns AS c
    WHERE c.object_id = o.object_id
    UNION ALL
    SELECT
        member_kind = CASE WHEN p.parameter_id = 0 THEN N'return' ELSE N'parameter' END,
        member_name = p.name,
        user_type_id = p.user_type_id,
        max_length = p.max_length,
        precision = p.precision,
        scale = p.scale,
        is_nullable = CONVERT(bit, 1),
        ordinal = p.parameter_id,
        is_output = p.is_output
    FROM sys.all_parameters AS p
    WHERE p.object_id = o.object_id
) AS m
LEFT JOIN sys.types AS ty ON ty.user_type_id = m.user_type_id
LEFT JOIN sys.synonyms AS sy ON sy.object_id = o.object_id
WHERE (o.is_ms_shipped = 0 OR s.name IN (N'sys', N'INFORMATION_SCHEMA'))
  AND o.type IN (N'U', N'V', N'P', N'PC', N'FN', N'FS', N'IF', N'TF', N'FT', N'SN')
ORDER BY s.name, o.name, member_kind, ordinal;
`;
