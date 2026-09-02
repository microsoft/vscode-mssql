/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataSection } from "../metadata/index.js";
import { multipartIdentifierParts } from "../semantics/identifiers.js";
import { LezerSyntaxService, type SyntaxNode, type SyntaxSnapshot } from "../syntax/index.js";
import { firstDescendantOfKind, visitSyntaxTree } from "../syntax/treeUtilities.js";
import { ImmutableTextSnapshot } from "../text/index.js";

const invalidatedCatalogSections = Object.freeze([
    "databases",
    "schemas",
    "objects",
    "columns",
    "parameters",
    "constraints",
    "principals",
    "definitions",
] satisfies readonly MetadataSection[]);

const catalogProcedures = new Set([
    "SP_RENAME",
    "SP_ADDTYPE",
    "SP_DROPTYPE",
    "SP_ADDEXTENDEDPROPERTY",
    "SP_UPDATEEXTENDEDPROPERTY",
    "SP_DROPEXTENDEDPROPERTY",
    "SP_ADDROLE",
    "SP_DROPROLE",
    "SP_ADDROLEMEMBER",
    "SP_DROPROLEMEMBER",
]);

const principalStatementKinds = new Set([
    "CreatePrincipalStatement",
    "AlterPrincipalStatement",
    "DropPrincipalStatement",
]);

let defaultSyntaxService: LezerSyntaxService | undefined;

/**
 * Classifies the catalog effect of SQL that the host successfully executed.
 *
 * Statement and batch boundaries come from the parser. This deliberately does not mask SQL with
 * a host-side lexer: strings, comments, quoted identifiers, nested comments, and UTF-16 offsets
 * are already represented by the published syntax contract.
 */
export function metadataSectionsInvalidatedByExecutedSql(
    sql: string,
    syntaxService: LezerSyntaxService = (defaultSyntaxService ??= new LezerSyntaxService()),
): readonly MetadataSection[] {
    if (sql.trim().length === 0) return Object.freeze([]);
    const syntax = syntaxService.parse(
        new ImmutableTextSnapshot("metadata-effect:///executed.sql", 1, sql),
    );
    let principalMutation = false;
    let catalogMutation = false;

    visitSyntaxTree(syntax.root(), (node) => {
        if (node.kind !== "Statement") return;
        const statement = structuralStatement(node);
        if (!statement) return;
        if (principalStatementKinds.has(statement.kind)) {
            principalMutation = true;
            return;
        }
        if (isCatalogMutation(statement, syntax, sql)) catalogMutation = true;
    });

    if (catalogMutation) return invalidatedCatalogSections;
    return principalMutation ? Object.freeze(["principals"] as const) : Object.freeze([]);
}

function isCatalogMutation(statement: SyntaxNode, syntax: SyntaxSnapshot, sql: string): boolean {
    if (
        /^(?:Create|Alter|Drop|Truncate)/u.test(statement.kind) ||
        statement.kind === "PermissionStatement" ||
        statement.kind === "EnableDisableTriggerStatement"
    ) {
        return true;
    }
    if (statement.kind === "SelectStatement") return hasPersistentSelectInto(statement, sql);
    if (statement.kind === "ExecuteStatement") return executesCatalogProcedure(statement, sql);

    // A successful server execution can still use syntax newer than the current grammar profile.
    // Constrain the conservative fallback to the first significant token of this parsed statement,
    // so a word in a string, comment, identifier, later statement, or procedure body cannot fire it.
    const first = [...syntax.tokens(statement)].find((token) => !token.trivia)?.text.toUpperCase();
    return (
        first !== undefined &&
        ["CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "DENY", "REVOKE"].includes(first)
    );
}

function hasPersistentSelectInto(statement: SyntaxNode, sql: string): boolean {
    const into = firstDescendantOfKind(statement, "IntoClause");
    const name = into && firstDescendantOfKind(into, "MultipartIdentifier");
    if (!name) return false;
    const last = multipartIdentifierParts(sql.slice(name.start, name.end)).at(-1);
    return last !== undefined && !last.startsWith("#");
}

function executesCatalogProcedure(statement: SyntaxNode, sql: string): boolean {
    const entity = firstDescendantOfKind(statement, "ExecutableEntity");
    const name = entity && firstDescendantOfKind(entity, "MultipartIdentifier");
    if (!name) return false;
    const procedure = multipartIdentifierParts(sql.slice(name.start, name.end)).at(-1);
    return procedure !== undefined && catalogProcedures.has(procedure.toUpperCase());
}

function structuralStatement(statement: SyntaxNode): SyntaxNode | undefined {
    for (const child of statement.children()) {
        if (child.kind.endsWith("Statement")) return child;
    }
    return undefined;
}
