/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    descendantsOwnedByKind,
    descendantsOfKind,
    directOwnedDescendantsOfKind,
    firstDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import type { SyntaxNode } from "../../syntax/index.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

// OrderExpression is already a parser-owned expression. These recognizers only strip its optional
// direction and distinguish an ordinal or an arithmetic numeric constant. They do not infer clause
// structure from raw text.
const trailingDirection = /\s+(?:ASC|DESC)\s*$/iu;
const unsignedInteger = /^[0-9]+$/u;
const arithmeticOperator = /[+\-*/%]/u;
const numericConstantExpression = /^[\s0-9.eE+\-*/%()]+$/u;

/** Validates ORDER BY ordinals and constant expressions from structured order-expression nodes. */
export function validateOrderBy(context: DiagnosticFamilyContext): void {
    for (const order of context.nodes("OrderByClause")) {
        const select = parentOfKind(order, "SelectStatement");
        const query = select && firstDescendantOfKind(select, "QuerySpecification");
        const selectList = query && firstDescendantOfKind(query, "SelectList");
        if (!selectList) continue;
        const selected = directOwnedDescendantsOfKind(selectList, "SelectElement");
        const expressions = directOwnedDescendantsOfKind(order, "OrderExpression");
        for (const [index, expression] of expressions.entries()) {
            const source = context.source(expression).trim().replace(trailingDirection, "");
            if (unsignedInteger.test(source)) {
                const position = Number(source);
                if (position < 1 || position > selected.length) {
                    context.add(
                        "OrderByPositionNumberIsOutOfRange",
                        `The ORDER BY position number ${position} is out of range of the number of items in the select list.`,
                        expression,
                    );
                } else if (descendantsOfKind(selected[position - 1]!, "Variable").length > 0) {
                    context.add(
                        "OrderByItemContainsVariable",
                        `The SELECT item identified by the ORDER BY number ${position} contains a variable as part of the expression identifying a column position. Variables are only allowed when ordering by an expression referencing a column name.`,
                        expression,
                    );
                }
            } else if (arithmeticOperator.test(source) && numericConstantExpression.test(source)) {
                context.add(
                    "OrderByListHasConstantExpression",
                    `A constant expression was encountered in the ORDER BY list, position ${index + 1}.`,
                    expression,
                );
            }
        }
    }
}

// GroupByOption is a parser-owned option node. Whitespace folding is lexical normalization; the
// regex cannot discover a GROUP BY clause and is directly covered by query-shape tests.
const legacyGroupingOption = /^WITH\s+(?:CUBE|ROLLUP)$/iu;

/** Validates set operators, legacy GROUP BY options, and SELECT INTO placement. */
export function validateQueryShapes(context: DiagnosticFamilyContext): void {
    // Only UNION has an ALL form; EXCEPT ALL and INTERSECT ALL are retained by the grammar so the
    // unsupported operator can be diagnosed precisely rather than becoming recovery.
    for (const kind of ["QueryExpression", "SelectQueryExpression", "QueryTerm"] as const) {
        for (const node of context.nodes(kind)) {
            let operator: SyntaxNode | undefined;
            for (const child of node.children()) {
                if (child.kind === "Except" || child.kind === "Intersect") {
                    operator = child;
                    continue;
                }
                if (child.kind === "All" && operator) {
                    context.add(
                        "OperatorNotSupported",
                        `The 'ALL' version of the ${operator.kind} operator is not supported.`,
                        { start: operator.start, end: child.end },
                    );
                }
                operator = undefined;
            }
        }
    }

    for (const option of context.nodes("GroupByOption")) {
        const spelling = context.source(option).trim().replace(/\s+/gu, " ");
        if (legacyGroupingOption.test(spelling)) continue;
        context.add(
            "InvalidGroupByOption",
            ` '${spelling}' is not a recognized GROUP BY option.`,
            option,
        );
    }

    for (const kind of ["QueryExpression", "SelectQueryExpression"] as const) {
        for (const expression of context.nodes(kind)) {
            if (
                kind === "QueryExpression" &&
                [...expression.children()].some((child) => child.kind === "SelectQueryExpression")
            ) {
                continue;
            }
            const terms = setOperatorTerms(expression);
            if (terms.length < 2) continue;
            for (const term of terms.slice(1)) {
                const into = descendantsOwnedByKind(term, "IntoClause", term)[0];
                if (!into) continue;
                context.add(
                    "SelectIntoMustBeFirstQuery",
                    "SELECT INTO must be the first query in a statement containing a UNION, INTERSECT or EXCEPT operator.",
                    into,
                );
            }
        }
    }
}

/** Validates parser-owned WHERE, HAVING, and JOIN predicate expressions. */
export function validateBooleanContexts(context: DiagnosticFamilyContext): void {
    const expressions: SyntaxNode[] = [];
    for (const kind of ["WhereClause", "HavingClause", "QualifiedJoin"] as const) {
        for (const owner of context.nodes(kind)) {
            if (kind === "WhereClause" && parentOfKind(owner, "CreateIndexStatement")) continue;
            const expression = firstDescendantOfKind(owner, "Expression");
            if (expression) expressions.push(expression);
        }
    }
    for (const expression of expressions) {
        if (isBooleanExpressionText(context.source(expression))) continue;
        context.add(
            "BooleanConditionExpected",
            "An expression of non-boolean type specified in a context where a condition is expected.",
            expression,
        );
    }
}

function setOperatorTerms(expression: SyntaxNode): readonly SyntaxNode[] {
    const terms: SyntaxNode[] = [];
    for (const child of expression.children()) {
        if (child.kind === "SelectQueryExpression") {
            terms.push(...setOperatorTerms(child));
            continue;
        }
        if (
            child.kind === "QuerySpecification" ||
            child.kind === "QueryTerm" ||
            child.kind === "QueryPrimary" ||
            child.kind === "ParenthesizedQuery"
        ) {
            terms.push(child);
        }
    }
    return terms;
}

// This runs only after the parser has isolated one predicate expression. It distinguishes boolean
// operators from scalar text during incomplete typing; it does not locate clauses or statements.
const booleanOperator =
    /(?:=|<>|!=|<=|>=|<|>|\bIS\s+(?:NOT\s+)?NULL\b|\bLIKE\b|\bIN\s*\(|\bBETWEEN\b|\bEXISTS\s*\(|\b(?:CONTAINS|FREETEXT)\s*\(|\bMATCH\s*\()/iu;

function isBooleanExpressionText(source: string): boolean {
    return booleanOperator.test(source);
}
