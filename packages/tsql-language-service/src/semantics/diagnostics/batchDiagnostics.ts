/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxKind } from "../../syntax/index.js";
import type { SyntaxNode } from "../../syntax/index.js";
import {
    containsSyntaxError,
    directChildrenOfKind,
    firstDescendantOfKind,
    sameSyntaxNode,
} from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

const fixedStatementPhrases = new Map<SyntaxKind, string>([
    ["CreateSchemaStatement", "CREATE SCHEMA"],
    ["CreateFunctionStatement", "CREATE FUNCTION"],
    ["AlterFunctionStatement", "ALTER FUNCTION"],
    ["CreateProcedureStatement", "CREATE PROCEDURE"],
    ["AlterProcedureStatement", "ALTER PROCEDURE"],
    ["CreateTriggerStatement", "CREATE TRIGGER"],
    ["AlterTriggerStatement", "ALTER TRIGGER"],
    ["CreateViewStatement", "CREATE VIEW"],
    ["AlterViewStatement", "ALTER VIEW"],
]);

const batchIsolatedKinds = [...fixedStatementPhrases.keys(), "RuleDefaultStatement"] as const;

/** Validates DDL that must be a direct and sole statement in its GO batch. */
export function validateBatchContracts(context: DiagnosticFamilyContext): void {
    for (const kind of batchIsolatedKinds) {
        for (const body of context.nodes(kind)) {
            const phrase = isolatedStatementPhrase(body);
            if (!phrase || isSchemaElement(body) || isIncompleteModule(body)) continue;

            const statement = body.parent();
            const batch = outermostBatch(body);
            const directBatchStatement =
                statement?.kind === "Statement" && sameSyntaxNode(statement.parent(), batch);
            if (
                !directBatchStatement &&
                isProcedureOrTrigger(body) &&
                !firstDescendantOfKind(body, "ExternalModuleBody")
            ) {
                continue;
            }
            const isOnlyStatement =
                batch !== undefined && directChildrenOfKind(batch, "Statement").length === 1;
            const incompleteSchemaElement = hasUncommittedSchemaElement(body);
            const incompleteAuthorization =
                body.kind === "CreateSchemaStatement" &&
                directChildrenOfKind(body, "Authorization").length > 0 &&
                containsSyntaxError(body);
            const invalidViewBody =
                (body.kind === "CreateViewStatement" || body.kind === "AlterViewStatement") &&
                firstDescendantOfKind(body, "IntoClause") !== undefined;

            if (
                directBatchStatement &&
                isOnlyStatement &&
                !incompleteSchemaElement &&
                !incompleteAuthorization &&
                !invalidViewBody
            ) {
                continue;
            }
            context.add(
                "MustBeOnlyStatementInBatch",
                `Incorrect syntax: '${phrase}' must be the only statement in the batch.`,
                body,
            );
        }
    }
}

function isolatedStatementPhrase(node: SyntaxNode): string | undefined {
    const fixed = fixedStatementPhrases.get(node.kind);
    if (fixed) return fixed;
    if (node.kind !== "RuleDefaultStatement") return undefined;

    const children = [...node.children()];
    if (!children.some(({ kind }) => kind === "Create")) return undefined;
    if (children.some(({ kind }) => kind === "Rule")) return "CREATE RULE";
    if (children.some(({ kind }) => kind === "Default")) return "CREATE DEFAULT";
    return undefined;
}

function isSchemaElement(node: SyntaxNode): boolean {
    for (let parent = node.parent(); parent; parent = parent.parent()) {
        if (parent.kind === "SchemaElement") return true;
    }
    return false;
}

function isIncompleteModule(node: SyntaxNode): boolean {
    return node.kind !== "CreateSchemaStatement" && containsSyntaxError(node);
}

function hasUncommittedSchemaElement(node: SyntaxNode): boolean {
    if (node.kind !== "CreateSchemaStatement") return false;
    for (const element of directChildrenOfKind(node, "SchemaElement")) {
        if (!containsSyntaxError(element)) continue;
        const body = [...element.children()][0];
        if (!body) return true;
        if (body.kind === "CreateTableStatement") {
            if (!firstDescendantOfKind(body, "TableElement")) return true;
        } else if (body.kind === "CreateViewStatement") {
            if (!firstDescendantOfKind(body, "SelectStatement")) return true;
        } else if (body.kind === "PermissionStatement") {
            return true;
        }
    }
    return false;
}

function outermostBatch(node: SyntaxNode): SyntaxNode | undefined {
    let result: SyntaxNode | undefined;
    for (let parent = node.parent(); parent; parent = parent.parent()) {
        if (parent.kind === "Batch") result = parent;
    }
    return result;
}

function isProcedureOrTrigger(node: SyntaxNode): boolean {
    return (
        node.kind === "CreateProcedureStatement" ||
        node.kind === "AlterProcedureStatement" ||
        node.kind === "CreateTriggerStatement" ||
        node.kind === "AlterTriggerStatement"
    );
}
