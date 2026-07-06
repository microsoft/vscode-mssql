/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CreateTableEmitter (design 05 §13.3): synthesizes CREATE TABLE from pinned
 * catalog metadata at explicit fidelity (§13.2):
 *
 *   F1 — columns in ordinal order, type display, nullability, IDENTITY flag,
 *        PRIMARY KEY from column flags (unnamed when constraint names are
 *        not hydrated).
 *   F2 — F1 plus NAMED key constraints (PK + UNIQUE with key-ordinal column
 *        order) and FOREIGN KEY constraints with ordered column pairs, plus
 *        MS_Description comments where hydrated.
 *
 * HONESTY: computed columns are emitted as comments (their expressions are
 * not hydrated — a plain column would be a fabrication); defaults, checks,
 * indexes, collation, and identity seed/increment are NOT hydrated and are
 * declared missing in the fidelity notes. Columns must be fully ready or
 * the emitter refuses. Pure: no vscode, no node builtins (lint-enforced).
 */

import { quoteIdentifier } from "../sqlLanguage/core/quote";
import {
    IPinnedMetadataView,
    LangColumn,
    LangKeyConstraint,
    LangObjectInfo,
} from "../sqlLanguage/provider/types";
import { ScriptAnchor, ScriptFidelity } from "./api";
import { ScriptWriter, fidelityHeader, sanitizeCommentText, withHeader } from "./scriptWriter";

export interface CreateTableEmitOutput {
    readonly text: string;
    readonly anchors: readonly ScriptAnchor[];
    readonly fidelityNotes: readonly string[];
    readonly fidelity: ScriptFidelity;
}

const NEVER_HYDRATED_NOTE =
    "not hydrated: default constraints, check constraints, indexes, column collation, " +
    "identity seed/increment";

export function emitCreateTable(
    info: LangObjectInfo,
    columns: readonly LangColumn[],
    pinned: IPinnedMetadataView,
): CreateTableEmitOutput {
    const notes: string[] = [NEVER_HYDRATED_NOTE];
    const writer = new ScriptWriter();

    // F2 detail: named key constraints + FK details when trustworthy.
    const keyConstraints =
        pinned.getKeyConstraints !== undefined ? pinned.getKeyConstraints(info.ref) : undefined;
    const fkReady = pinned.readiness.foreignKeys === "ready";
    const fidelity: ScriptFidelity = keyConstraints !== undefined && fkReady ? "F2" : "F1";

    /** Body items: `emit` writes one line; comment items never take commas. */
    const bodyLines: { emit: (comma: boolean) => void; isComment?: boolean }[] = [];
    const identityColumns = columns.filter((c) => c.isIdentity === true);
    if (identityColumns.length > 0) {
        notes.push("identity columns rendered without seed/increment (not hydrated)");
    }
    const computedColumns = columns.filter((c) => c.isComputed === true);
    if (computedColumns.length > 0) {
        notes.push("computed column expressions are not hydrated — emitted as comments");
    }
    if (columns.some((c) => c.nullable === undefined && c.isComputed !== true)) {
        notes.push("nullability unknown for some columns — NULL/NOT NULL omitted");
    }

    for (const column of columns) {
        if (column.isComputed === true) {
            bodyLines.push({
                isComment: true,
                emit: () => {
                    writer.append("    -- ");
                    writer.anchored(
                        { kind: "column", name: column.name },
                        quoteIdentifier(column.name),
                    );
                    writer.append(" computed column (expression not hydrated)");
                },
            });
            continue;
        }
        bodyLines.push({
            emit: (comma) => {
                writer.append("    ");
                writer.anchored(
                    { kind: "column", name: column.name },
                    quoteIdentifier(column.name),
                );
                writer.append(` ${column.typeDisplay}`);
                if (column.isIdentity === true) {
                    writer.append(" IDENTITY");
                }
                if (column.nullable === false) {
                    writer.append(" NOT NULL");
                } else if (column.nullable === true) {
                    writer.append(" NULL");
                }
                if (comma) {
                    writer.append(",");
                }
                // Trailing description comment AFTER the comma (a comma
                // inside the comment would be swallowed — syntax honesty).
                const description = pinned.getDescription?.(info.ref, column.name);
                if (description !== undefined) {
                    writer.append(` -- ${sanitizeCommentText(description)}`);
                }
            },
        });
    }

    if (keyConstraints !== undefined) {
        for (const constraint of keyConstraints) {
            bodyLines.push({ emit: (comma) => appendKeyConstraint(writer, constraint, comma) });
        }
    } else {
        notes.push("key constraint names not hydrated" + pkFallbackNote(columns));
        const pk = columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name);
        if (pk.length > 0) {
            bodyLines.push({
                emit: (comma) => {
                    writer.append("    PRIMARY KEY (");
                    writer.append(pk.map(quoteIdentifier).join(", "));
                    writer.append(comma ? ")," : ")");
                },
            });
        }
    }

    if (fkReady) {
        const edges = pinned.fkFrom(info.ref);
        let omitted = 0;
        for (const edge of edges) {
            const target = pinned.getObject(edge.to);
            if (edge.columns.length === 0 || target === undefined || edge.name === undefined) {
                omitted++;
                continue;
            }
            const fkName = edge.name;
            const fkTarget = target;
            bodyLines.push({
                emit: (comma) => {
                    writer.append("    CONSTRAINT ");
                    writer.anchored({ kind: "foreignKey", name: fkName }, quoteIdentifier(fkName));
                    writer.append(" FOREIGN KEY (");
                    writer.append(
                        edge.columns.map((p) => quoteIdentifier(p.fromColumn)).join(", "),
                    );
                    writer.append(") REFERENCES ");
                    writer.append(
                        `${quoteIdentifier(fkTarget.schema)}.${quoteIdentifier(fkTarget.name)} (`,
                    );
                    writer.append(edge.columns.map((p) => quoteIdentifier(p.toColumn)).join(", "));
                    writer.append(comma ? ")," : ")");
                },
            });
        }
        if (omitted > 0) {
            notes.push(`${omitted} foreign key(s) omitted (column pairs or target not hydrated)`);
        }
    } else {
        notes.push("foreign keys not hydrated");
    }

    // Compose the body. An item needs a comma when any LATER item is a real
    // definition (comment lines never carry commas).
    writer.anchored({ kind: "header" }, "CREATE TABLE");
    writer.append(" ");
    writer.append(`${quoteIdentifier(info.schema)}.`);
    writer.anchored({ kind: "objectName" }, quoteIdentifier(info.name));
    writer.append(" (\r\n");
    bodyLines.forEach((line, index) => {
        const hasLaterReal = bodyLines.slice(index + 1).some((later) => later.isComment !== true);
        line.emit(line.isComment !== true && hasLaterReal);
        writer.append("\r\n");
    });
    writer.append(");\r\n");

    // Header: provenance + object description + fidelity notes as comments.
    const headerLines: string[] = [
        `-- Synthesized from catalog metadata by the native T-SQL language service (fidelity ${fidelity}).`,
    ];
    const objectDescription = pinned.getDescription?.(info.ref);
    if (objectDescription !== undefined) {
        headerLines.push(`-- Description: ${sanitizeCommentText(objectDescription)}`);
        notes.push("descriptions may be truncated at 4000 characters (hydration cast)");
    }
    const header = headerLines.join("\r\n") + "\r\n" + fidelityHeader(notes);
    const composed = withHeader(header, { text: writer.text, anchors: writer.anchors });
    return { ...composed, fidelityNotes: notes, fidelity };
}

function appendKeyConstraint(
    writer: ScriptWriter,
    constraint: LangKeyConstraint,
    comma: boolean,
): void {
    writer.append("    CONSTRAINT ");
    writer.anchored(
        { kind: "constraint", name: constraint.name },
        quoteIdentifier(constraint.name),
    );
    writer.append(constraint.kind === "primaryKey" ? " PRIMARY KEY (" : " UNIQUE (");
    writer.append(constraint.columns.map(quoteIdentifier).join(", "));
    writer.append(comma ? ")," : ")");
}

function pkFallbackNote(columns: readonly LangColumn[]): string {
    return columns.some((c) => c.isPrimaryKey === true)
        ? " — primary key emitted without its constraint name"
        : "";
}
