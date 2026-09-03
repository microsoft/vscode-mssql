/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode as LezerNode } from "@lezer/common";
import type { SyntaxDiagnostic } from "../contracts.js";
import { contextualKeywordMetadata } from "../keywords.js";

/**
 * Ledger table options reuse the generic option grammar, so the option words themselves stay
 * identifiers and the nesting rules are checked here. Only the words that actually belong to a
 * ledger option list are constrained; every other table option keeps the permissive shape the
 * generic list gives it.
 */
const ledgerOptionContext = "create_table_with_ledger_opt";

const ledgerListOptions = ["append_only", "ledger_view"] as const;

const ledgerViewListOptions = [
    "operation_type_column_name",
    "operation_type_desc_column_name",
    "sequence_number_column_name",
    "transaction_id_column_name",
] as const;

const generatedColumnKinds = new Set(["row", "sequence_number", "transaction_id"]);

const ledgerListNames = new Set<string>(ledgerListOptions);
const ledgerViewListNames = new Set<string>(ledgerViewListOptions);
const ledgerListExpectation = expectation(ledgerListOptions);
const ledgerViewListExpectation = expectation(ledgerViewListOptions);

/** Reports ledger option words used outside the option list that accepts them. */
export function ledgerTableOptionDiagnostics(
    clause: LezerNode,
    text: string,
): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    for (const option of childrenNamed(clause, "TableOption")) {
        const name = childNamed(option, "IdentifierName");
        if (!name) continue;
        const word = text.slice(name.from, name.to).toLowerCase();
        if (ledgerListNames.has(word)) {
            result.push(incorrectSyntax(text, name));
            continue;
        }
        if (word !== "ledger") continue;
        const value = childNamed(option, "TableOptionValue");
        const list = value && nestedOptionList(childNamed(value, "OptionValue"));
        if (list) result.push(...ledgerListDiagnostics(list, text));
    }
    return result;
}

/** Reports a GENERATED ALWAYS AS column whose boundary kind is not a modeled one. */
export function invalidGeneratedColumnKind(
    kind: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const name = childNamed(kind, "IdentifierName");
    if (!name) return undefined;
    const word = text.slice(name.from, name.to).toLowerCase();
    return generatedColumnKinds.has(word) ? undefined : incorrectSyntax(text, name);
}

function ledgerListDiagnostics(list: LezerNode, text: string): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    for (const option of childrenNamed(list, "GenericOption")) {
        const name = optionName(option);
        if (!name) continue;
        const word = text.slice(name.from, name.to).toLowerCase();
        if (!ledgerListNames.has(word)) {
            result.push(incorrectSyntax(text, name, ledgerListExpectation));
            continue;
        }
        if (word !== "ledger_view") continue;
        const nested = childNamed(option, "GenericOptionList");
        if (!nested) continue;
        for (const column of childrenNamed(nested, "GenericOption")) {
            const columnName = optionName(column);
            if (!columnName) continue;
            const columnWord = text.slice(columnName.from, columnName.to).toLowerCase();
            if (ledgerViewListNames.has(columnWord)) continue;
            result.push(incorrectSyntax(text, columnName, ledgerViewListExpectation));
        }
    }
    return result;
}

/**
 * A ledger option list is the parenthesized continuation of `LEDGER = ON`. `LEDGER = ON` on its
 * own, and any value shape other than that nested list, carries nothing to check.
 */
function nestedOptionList(value: LezerNode | undefined): LezerNode | undefined {
    if (!value || !childNamed(value, "On")) return undefined;
    return childNamed(value, "GenericOptionList");
}

function optionName(option: LezerNode): LezerNode | undefined {
    const name = childNamed(option, "GenericOptionName");
    return name && childNamed(name, "IdentifierName");
}

function incorrectSyntax(text: string, range: LezerNode, expected?: string): SyntaxDiagnostic {
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(range.from, range.to)}'.${
            expected ? `  Expecting ${expected}.` : ""
        }`,
        severity: "error",
        range: { start: range.from, end: range.to },
    };
}

/**
 * The expectation list names the grammar terminals rather than the source spellings, so it is
 * derived from the keyword registry that assigns those terminals.
 */
function expectation(words: readonly string[]): string {
    const names = words
        .map((word) => ledgerTerminal(word))
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (names.length === 1) return names[0]!;
    return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

function ledgerTerminal(word: string): string {
    const uses =
        contextualKeywordMetadata[word as keyof typeof contextualKeywordMetadata] ??
        ([] as readonly { readonly context: string; readonly token: string }[]);
    const use = uses.find(({ context }) => context === ledgerOptionContext);
    if (!use) throw new Error(`'${word}' is not a registered ledger option keyword.`);
    return use.token.replace(/^_[a-z]_/u, "");
}

function childNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return child;
    }
    return undefined;
}

function childrenNamed(node: LezerNode, name: string): readonly LezerNode[] {
    const result: LezerNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) result.push(child);
    }
    return result;
}
