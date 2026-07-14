/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Informational CREATE script generator (SV-R5; visualizer addendum §12).
 * Pure function over the canonical model — runs host- OR webview-side.
 *
 * THE OUTPUT IS INFORMATIONAL, NEVER THE PUBLISH ARTIFACT (§12.2): DacFx
 * remains the apply authority; every script opens with that label.
 *
 * Honesty (§12.2): unknown facts OMIT the clause and surface a warning —
 * never a substituted value. A column that is identity with unknown
 * seed/increment scripts WITHOUT the IDENTITY clause + a warning; a
 * computed column with an unknown definition cannot be scripted at all
 * and becomes a warning.
 *
 * Deliberate CORRECTNESS divergences from the legacy C# generator
 * (SchemaCreationScriptGenerator) — documented per §12.3, not byte-matched:
 * - `]` in identifiers is escaped (legacy emits broken brackets);
 * - PK/UNIQUE constraints keep their NAMES and key-ordinal column order
 *   (legacy drops names and uses table column order);
 * - default constraints keep their names;
 * - IDENTITY seed/increment ride as exact text (never JS numbers);
 * - FK referential actions emit only when KNOWN (unknown ⇒ omitted +
 *   warning — never a fabricated NO ACTION… which is also the reason an
 *   emitted script omits nothing silently).
 */

import {
    availableValue,
    SchemaVisualizerCatalogModel,
    SqlTypeSpec,
    VisualizerColumn,
    VisualizerForeignKey,
    VisualizerTable,
} from "../model/schemaVisualizerModel";

export interface GeneratedScript {
    text: string;
    warnings: string[];
}

export const INFORMATIONAL_HEADER =
    "-- Informational script generated from cached metadata (Schema Visualizer preview).\n" +
    "-- NOT a publish artifact: apply changes through the Schema Designer (DacFx).\n";

/** `[name]` with `]` doubled — the §12.3 correctness case the legacy generator fails. */
export function quoteIdentifier(name: string): string {
    return `[${name.replace(/\]/g, "]]")}]`;
}

function twoPart(schema: string, name: string): string {
    return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

/** Length/precision decoration from EXACT facts — never parsed from display. */
function renderType(spec: SqlTypeSpec): string {
    const lowered = spec.typeName.toLowerCase();
    if (spec.isUserDefined) {
        // Alias/user-defined types carry their own facets; reference by name.
        return spec.typeSchema !== undefined
            ? twoPart(spec.typeSchema, spec.typeName)
            : quoteIdentifier(spec.typeName);
    }
    if (["char", "varchar", "nchar", "nvarchar", "binary", "varbinary"].includes(lowered)) {
        const length =
            spec.logicalLength ?? (spec.maxLengthBytes < 0 ? "max" : spec.maxLengthBytes);
        return `${lowered}(${length})`;
    }
    if (["decimal", "numeric"].includes(lowered)) {
        return `${lowered}(${spec.precision}, ${spec.scale})`;
    }
    if (["datetime2", "datetimeoffset", "time"].includes(lowered)) {
        return `${lowered}(${spec.scale})`;
    }
    if (lowered === "vector" && spec.vectorDimensions !== undefined) {
        return `vector(${spec.vectorDimensions})`;
    }
    return lowered;
}

function columnLine(
    table: VisualizerTable,
    column: VisualizerColumn,
    warnings: string[],
): string | undefined {
    const quotedName = quoteIdentifier(column.name);
    const computed = column.computed;
    if (column.isComputed) {
        const spec = availableValue(computed);
        if (spec === undefined || spec === null) {
            warnings.push(
                `${table.name}.${column.name}: computed column definition unknown — column omitted.`,
            );
            return undefined;
        }
        return `    ${quotedName} AS ${spec.definition}${spec.persisted ? " PERSISTED" : ""}`;
    }

    const parts: string[] = [quotedName];
    const typeSpec = availableValue(column.type);
    if (typeSpec !== undefined) {
        parts.push(renderType(typeSpec));
        if (typeSpec.collationName !== undefined) {
            parts.push(`COLLATE ${typeSpec.collationName}`);
        }
    } else {
        // typeDisplay is a SERVER-derived fact (H3), not a fabrication —
        // usable, but exact facets were not captured, so flag it.
        parts.push(column.typeDisplay);
        warnings.push(
            `${table.name}.${column.name}: exact type facts unknown — display string used.`,
        );
    }

    if (column.isIdentity) {
        const identity = availableValue(column.identitySpec);
        if (identity !== undefined) {
            parts.push(`IDENTITY(${identity.seedText}, ${identity.incrementText})`);
        } else {
            warnings.push(
                `${table.name}.${column.name}: identity seed/increment unknown — IDENTITY clause omitted.`,
            );
        }
    }

    parts.push(column.nullable ? "NULL" : "NOT NULL");

    const defaultConstraint = column.defaultConstraint;
    if (defaultConstraint.state === "known") {
        if (defaultConstraint.value !== null) {
            const name = defaultConstraint.value.name;
            parts.push(
                `${name !== undefined ? `CONSTRAINT ${quoteIdentifier(name)} ` : ""}DEFAULT ${defaultConstraint.value.definition}`,
            );
        }
    } else if (defaultConstraint.reason !== "notApplicable") {
        warnings.push(
            `${table.name}.${column.name}: default-constraint facts unknown — DEFAULT omitted if one exists.`,
        );
    }
    return `    ${parts.join(" ")}`;
}

/** CREATE TABLE + named key constraints (key-ordinal order preserved). */
export function generateTableScript(
    table: VisualizerTable,
    model: SchemaVisualizerCatalogModel,
): GeneratedScript {
    const warnings: string[] = [];
    const lines: string[] = [];
    for (const column of table.columns) {
        const line = columnLine(table, column, warnings);
        if (line !== undefined) {
            lines.push(line);
        }
    }
    for (const constraint of table.keyConstraints) {
        const kindSql = constraint.kind === "primaryKey" ? "PRIMARY KEY" : "UNIQUE";
        lines.push(
            `    CONSTRAINT ${quoteIdentifier(constraint.name)} ${kindSql} (${constraint.columns
                .map(quoteIdentifier)
                .join(", ")})`,
        );
    }
    if (model.capabilities.keyProperties.state !== "available") {
        warnings.push(`${table.name}: key metadata unknown — key constraints omitted.`);
    }

    const statements: string[] = [
        `CREATE TABLE ${twoPart(table.schema, table.name)} (\n${lines.join(",\n")}\n);`,
    ];

    const tablesById = new Map(model.tables.map((t) => [t.identity.objectId, t]));
    for (const fk of model.foreignKeys.filter(
        (edge) => edge.fromObjectId === table.identity.objectId,
    )) {
        const statement = foreignKeyStatement(table, fk, tablesById, warnings);
        if (statement !== undefined) {
            statements.push(statement);
        }
    }

    return {
        text: `${INFORMATIONAL_HEADER}\n${statements.join("\n\n")}\n`,
        warnings,
    };
}

function foreignKeyStatement(
    table: VisualizerTable,
    fk: VisualizerForeignKey,
    tablesById: ReadonlyMap<number, VisualizerTable>,
    warnings: string[],
): string | undefined {
    const target = tablesById.get(fk.toObjectId);
    if (target === undefined) {
        warnings.push(
            `${table.name}: foreign key ${fk.name} references a table outside this model — statement omitted.`,
        );
        return undefined;
    }
    if (fk.columnPairs.length === 0) {
        warnings.push(`${table.name}: foreign key ${fk.name} has no column pairs — omitted.`);
        return undefined;
    }
    const fromColumns = fk.columnPairs.map((pair) => quoteIdentifier(pair.fromColumnName));
    const toColumns = fk.columnPairs.map((pair) => quoteIdentifier(pair.toColumnName));
    const clauses = [
        `ALTER TABLE ${twoPart(table.schema, table.name)} ADD CONSTRAINT ${quoteIdentifier(fk.name)}`,
        `    FOREIGN KEY (${fromColumns.join(", ")}) REFERENCES ${twoPart(target.schema, target.name)} (${toColumns.join(", ")})`,
    ];
    const onDelete = availableValue(fk.onDelete);
    const onUpdate = availableValue(fk.onUpdate);
    if (onDelete !== undefined && onDelete !== "NO_ACTION") {
        clauses.push(`    ON DELETE ${onDelete.replace("_", " ")}`);
    }
    if (onUpdate !== undefined && onUpdate !== "NO_ACTION") {
        clauses.push(`    ON UPDATE ${onUpdate.replace("_", " ")}`);
    }
    if (onDelete === undefined || onUpdate === undefined) {
        warnings.push(
            `${table.name}: foreign key ${fk.name} referential action(s) unknown — clause omitted (NOT defaulted to NO ACTION).`,
        );
    }
    return `${clauses.join("\n")};`;
}
