/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lookupBuiltIn } from "../common/builtInRegistry.js";
import type { SyntaxNode, SyntaxSnapshot } from "../syntax/index.js";
import { ancestorOfKind } from "../syntax/treeUtilities.js";
import type { HoverResult } from "./contracts.js";

/**
 * Hovers for the names no symbol is bound to: language elements such as data types and system
 * variables, and declarations the binder does not model, such as labels, cursors, index names, and
 * result-column aliases. Everything here reads the tree alone, so it answers about the token under
 * the cursor and never about a neighbour.
 */
export function syntacticHover(
    syntax: SyntaxSnapshot,
    offset: number,
    describeRoutine: (name: string) => string | undefined,
): HoverResult | undefined {
    const leaf = syntax.nodeAt(offset);
    const text = (node: SyntaxNode): string => syntax.document.text.slice(node.start, node.end);
    const range = (node: SyntaxNode): { start: number; end: number } => ({
        start: node.start,
        end: node.end,
    });

    if (leaf.kind === "GlobalVariable") {
        const name = text(leaf);
        const entry = lookupBuiltIn(name, "systemVariable");
        return {
            range: range(leaf),
            markdown: heading("system variable", name, entry?.documentation),
        };
    }
    if (leaf.kind === "Label") {
        // The token carries the colon that marks it; the label itself is the name before it.
        const declared = text(leaf).trim().replace(/:$/u, "");
        return { range: range(leaf), markdown: `**label** \`${declared}\`` };
    }

    const name = ancestorOfKind(leaf, ["IdentifierName"]);
    if (!name) return undefined;
    const parent = name.parent();
    if (!parent) return undefined;

    const dataType = ancestorOfKind(leaf, ["DataTypeName"]);
    if (dataType) {
        // A user-defined type resolves through the catalog; only built-in spellings land here.
        const spelling = text(dataType).replaceAll(/\s+/gu, " ").trim();
        // A declared length or precision follows the name; the registry knows the name alone.
        const declared = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(spelling)?.[0] ?? spelling;
        const entry = lookupBuiltIn(declared, "dataType");
        if (entry) {
            return {
                range: range(dataType),
                markdown: heading("data type", spelling, entry.documentation),
            };
        }
    }

    if (
        ancestorOfKind(leaf, ["CursorDeclaration"]) ||
        ancestorOfKind(leaf, ["CursorLifecycleStatement"])
    ) {
        return { range: range(name), markdown: `**cursor** \`${text(name)}\`` };
    }
    if (parent.kind === "GotoStatement") {
        return { range: range(name), markdown: `**label** \`${text(name)}\`` };
    }
    if (parent.kind === "SelectElement" || parent.kind === "OutputElement") {
        return { range: range(name), markdown: `**result column** \`${text(name)}\`` };
    }
    if (indexOwnerStatements.has(parent.kind)) {
        return { range: range(name), markdown: `**index** \`${text(name)}\`` };
    }

    // A single-part routine name that no catalog object claims is a shipped built-in.
    const multipart = parent.kind === "MultipartIdentifier" ? parent : undefined;
    const call = multipart?.parent();
    if (
        multipart &&
        call &&
        (call.kind === "FunctionCall" || call.kind === "FunctionTableSource")
    ) {
        const parts = [...multipart.children()].filter((part) => part.kind === "IdentifierName");
        if (parts.length === 1) {
            const routine = text(parts[0]!);
            // A name with no documented signature is still worth naming as a shipped routine.
            if (lookupBuiltIn(routine, "routine")) {
                return {
                    range: range(parts[0]!),
                    markdown: heading(
                        "built-in function",
                        routine.toUpperCase(),
                        describeRoutine(routine),
                    ),
                };
            }
        }
    }
    return undefined;
}

/**
 * True when the declaration of a bound local is a routine parameter rather than a `DECLARE`. The
 * tree is probed inside the declaration, because resolving at its first offset looks left and lands
 * on whatever encloses it.
 */
export function isRoutineParameter(
    syntax: SyntaxSnapshot,
    declaration: { readonly start: number; readonly end: number },
): boolean {
    const inside = Math.min(declaration.start + 1, declaration.end);
    return ancestorOfKind(syntax.nodeAt(inside), ["ProcedureParameter"]) !== undefined;
}

const indexOwnerStatements = new Set([
    "CreateIndexStatement",
    "CreateJsonIndexStatement",
    "CreateVectorIndexStatement",
    "CreateSemanticIndexStatement",
    "AlterIndexStatement",
    "CreateStatisticsStatement",
]);

/** A heading naming what the token is, followed by its documentation when there is any. */
function heading(kind: string, name: string, documentation?: string): string {
    const title = `**${kind}** \`${name}\``;
    return documentation ? `${title}\n\n${documentation}` : title;
}
