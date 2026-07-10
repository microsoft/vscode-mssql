/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DmlTemplateEmitter (design 05 §13.3, fidelity F0): query templates — not
 * object reconstruction — from pinned columns/parameters:
 *
 *   selectTop — SELECT TOP (1000) with explicit columns.
 *   insert    — writable columns only (identity/computed skipped) with
 *               typed placeholder comments.
 *   update    — settable columns with a PK-based WHERE when PK is known.
 *   delete    — PK-based WHERE when known.
 *   execute   — classic SSMS shape: DECLARE @RC + parameters, TODO marker,
 *               EXECUTE @RC = proc with named arguments + OUTPUT markers.
 *
 * Missing PK/parameters degrade with explicit placeholder comments and
 * fidelity notes — never a silently unfiltered UPDATE/DELETE.
 * Pure: no vscode, no node builtins (lint-enforced).
 */

import { quoteIdentifier } from "../sqlLanguage/core/quote";
import { LangColumn, LangObjectInfo, LangParam } from "../sqlLanguage/provider/types";
import { ScriptAnchor } from "./api";
import { ScriptWriter, fidelityHeader, withHeader } from "./scriptWriter";

export interface DmlEmitOutput {
    readonly text: string;
    readonly anchors: readonly ScriptAnchor[];
    readonly fidelityNotes: readonly string[];
}

function placeholder(column: LangColumn): string {
    const nullability =
        column.nullable === true ? ", NULL" : column.nullable === false ? ", NOT NULL" : "";
    return `/* ${column.name} ${column.typeDisplay}${nullability} */`;
}

function writable(columns: readonly LangColumn[]): readonly LangColumn[] {
    return columns.filter((c) => c.isIdentity !== true && c.isComputed !== true);
}

function primaryKey(columns: readonly LangColumn[]): readonly LangColumn[] {
    return columns.filter((c) => c.isPrimaryKey === true);
}

export function emitSelectTop(info: LangObjectInfo, columns: readonly LangColumn[]): DmlEmitOutput {
    const writer = new ScriptWriter();
    writer.anchored({ kind: "header" }, "SELECT TOP (1000)");
    writer.append("\r\n");
    columns.forEach((column, index) => {
        writer.append("    ");
        writer.anchored({ kind: "column", name: column.name }, quoteIdentifier(column.name));
        writer.append(index < columns.length - 1 ? ",\r\n" : "\r\n");
    });
    writer.append("FROM ");
    writer.append(`${quoteIdentifier(info.schema)}.`);
    writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
    writer.append(";\r\n");
    return { text: writer.text, anchors: writer.anchors, fidelityNotes: [] };
}

export function emitInsert(info: LangObjectInfo, columns: readonly LangColumn[]): DmlEmitOutput {
    const notes: string[] = [];
    const target = writable(columns);
    const skipped = columns.length - target.length;
    if (skipped > 0) {
        notes.push(`${skipped} identity/computed column(s) omitted from the column list`);
    }
    const writer = new ScriptWriter();
    writer.anchored({ kind: "header" }, "INSERT INTO");
    writer.append(` ${quoteIdentifier(info.schema)}.`);
    writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
    writer.append(" (\r\n");
    target.forEach((column, index) => {
        writer.append("    ");
        writer.anchored({ kind: "column", name: column.name }, quoteIdentifier(column.name));
        writer.append(index < target.length - 1 ? ",\r\n" : "\r\n");
    });
    writer.append(")\r\nVALUES (\r\n");
    target.forEach((column, index) => {
        writer.append(`    ${placeholder(column)}`);
        writer.append(index < target.length - 1 ? ",\r\n" : "\r\n");
    });
    writer.append(");\r\n");
    return composeWithNotes(writer, notes);
}

export function emitUpdate(info: LangObjectInfo, columns: readonly LangColumn[]): DmlEmitOutput {
    const notes: string[] = [];
    const pk = primaryKey(columns);
    const settable = writable(columns).filter((c) => !pk.includes(c));
    const writer = new ScriptWriter();
    writer.anchored({ kind: "header" }, "UPDATE");
    writer.append(` ${quoteIdentifier(info.schema)}.`);
    writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
    writer.append("\r\nSET\r\n");
    settable.forEach((column, index) => {
        writer.append("    ");
        writer.anchored({ kind: "column", name: column.name }, quoteIdentifier(column.name));
        writer.append(` = ${placeholder(column)}`);
        writer.append(index < settable.length - 1 ? ",\r\n" : "\r\n");
    });
    appendKeyedWhere(writer, pk, notes);
    return composeWithNotes(writer, notes);
}

export function emitDelete(info: LangObjectInfo, columns: readonly LangColumn[]): DmlEmitOutput {
    const notes: string[] = [];
    const writer = new ScriptWriter();
    writer.anchored({ kind: "header" }, "DELETE FROM");
    writer.append(` ${quoteIdentifier(info.schema)}.`);
    writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
    writer.append("\r\n");
    appendKeyedWhere(writer, primaryKey(columns), notes);
    return composeWithNotes(writer, notes);
}

export function emitExecute(
    info: LangObjectInfo,
    parameters: readonly LangParam[] | undefined,
): DmlEmitOutput {
    const notes: string[] = [];
    const writer = new ScriptWriter();
    const shown = (parameters ?? []).filter((p) => p.ordinal !== 0);
    if (parameters === undefined) {
        notes.push("parameters not hydrated — EXEC emitted without arguments");
    }
    if (shown.length === 0) {
        writer.anchored({ kind: "header" }, "EXEC");
        writer.append(` ${quoteIdentifier(info.schema)}.`);
        writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
        writer.append(";\r\n");
        return composeWithNotes(writer, notes);
    }
    // Classic "Script as Execute" shape (SSMS parity): a DECLARE block for
    // the return code and every parameter, a TODO marker, then a
    // named-argument EXECUTE (names stay correct if parameter order changes).
    writer.anchored({ kind: "header" }, "DECLARE");
    writer.append(" @RC int;\r\n");
    for (const param of shown) {
        writer.append(`DECLARE ${param.name} ${param.typeDisplay};\r\n`);
    }
    writer.append("\r\n-- TODO: Set parameter values here.\r\n\r\n");
    writer.append(`EXECUTE @RC = ${quoteIdentifier(info.schema)}.`);
    writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
    writer.append("\r\n");
    shown.forEach((param, index) => {
        writer.append("    ");
        writer.anchored({ kind: "parameter", name: param.name }, param.name);
        writer.append(` = ${param.name}${param.isOutput ? " OUTPUT" : ""}`);
        writer.append(index < shown.length - 1 ? ",\r\n" : ";\r\n");
    });
    return composeWithNotes(writer, notes);
}

/** PK-based WHERE, or an explicit placeholder when the PK is unknown. */
function appendKeyedWhere(writer: ScriptWriter, pk: readonly LangColumn[], notes: string[]): void {
    if (pk.length === 0) {
        notes.push("no primary key metadata — WHERE filter left as a placeholder");
        writer.append("WHERE /* add a filter predicate */;\r\n");
        return;
    }
    writer.append("WHERE ");
    pk.forEach((column, index) => {
        writer.anchored({ kind: "column", name: column.name }, quoteIdentifier(column.name));
        writer.append(` = /* ${column.typeDisplay} */`);
        writer.append(index < pk.length - 1 ? "\r\n  AND " : ";\r\n");
    });
}

function composeWithNotes(writer: ScriptWriter, notes: readonly string[]): DmlEmitOutput {
    const header = fidelityHeader(notes);
    const composed = withHeader(header, { text: writer.text, anchors: writer.anchors });
    return { ...composed, fidelityNotes: notes };
}
