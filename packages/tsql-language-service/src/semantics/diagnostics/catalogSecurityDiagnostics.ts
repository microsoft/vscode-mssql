/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView, SqlPrincipalKind, SqlSecurableKind } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot, SyntaxToken } from "../../syntax/index.js";
import {
    containsSyntaxError,
    descendantsOfKind,
    firstDescendantOfKind,
    lastDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { normalizeIdentifier } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

/** Catalog/security validation reads one pinned metadata and syntax snapshot from the coordinator. */
export interface CatalogSecurityDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    readonly syntax: SyntaxSnapshot;
    equal(left: string, right: string): boolean;
    fold(value: string): string;
    principalExistsAt(name: string, kinds: readonly SqlPrincipalKind[], offset: number): boolean;
    significantTokens(range: TextRange, limit: number): readonly SyntaxToken[];
}

/** Reports missing credentials, certificates, and asymmetric keys in principal statements. */
export function validateSecurables(context: CatalogSecurityDiagnosticContext): void {
    if (context.metadata.completeness.securables !== "ready") return;
    for (const clause of context.nodes("LoginCreationClause")) {
        if (!containsSyntaxError(clause)) validateSecurableReference(context, clause, undefined);
    }
    for (const clause of context.nodes("UserCreationClause")) {
        if (!containsSyntaxError(clause)) {
            validateSecurableReference(
                context,
                clause,
                context.metadata.environment.currentDatabase,
            );
        }
    }
    for (const option of context.nodes("PrincipalNonPasswordOption")) {
        const tokens = context.significantTokens(option, 3);
        if (tokens[0]?.text.toUpperCase() !== "CREDENTIAL") continue;
        const nameNode = firstDescendantOfKind(option, "IdentifierName");
        if (nameNode) reportMissingSecurable(context, nameNode, "credential", undefined);
    }
}

/** Reports collation names absent from an authoritative server collation catalog. */
export function validateCollations(context: CatalogSecurityDiagnosticContext): void {
    const collations = context.metadata.collations();
    if (!collations) return;
    const accepted = new Set(collations.map((collation) => context.fold(collation)));
    for (const clause of context.nodes("CollateClause")) {
        const nameNode = firstDescendantOfKind(clause, "IdentifierName");
        if (!nameNode) continue;
        const name = normalizeIdentifier(context.source(nameNode));
        if (context.equal(name, "database_default") || accepted.has(context.fold(name))) continue;
        context.add("InvalidCollation", `Invalid collation '${name}'.`, nameNode);
    }
}

/** Reports missing USE targets and USE statements embedded in module bodies. */
export function validateDatabases(context: CatalogSecurityDiagnosticContext): void {
    const databases = context.metadata.databases();
    if (!databases) return;
    for (const statement of context.nodes("UseStatement")) {
        const nameNode = firstDescendantOfKind(statement, "IdentifierName");
        if (!nameNode) continue;
        const name = normalizeIdentifier(context.source(nameNode));
        if (!databases.some((database) => context.equal(database.name, name))) {
            context.add(
                "CouldNotLocateEntryInSysdatabases",
                `Could not locate entry in sysdatabases for database '${name}'. No entry found with that name. Make sure that the name is entered correctly.`,
                nameNode,
            );
        }
        if (moduleOwner(statement)) reportUseInModule(context, statement);
    }

    for (const kind of moduleStatementKinds) {
        for (const module of context.nodes(kind)) {
            if (descendantsOfKind(module, "UseStatement").length > 0) continue;
            const tokens = [...context.syntax.tokens(module)].filter((token) => !token.trivia);
            for (let index = 0; index < tokens.length; index++) {
                const token = tokens[index]!;
                if (token.kind === "BlockChunk") {
                    reportUsesInRecoveryChunk(context, token);
                    continue;
                }
                if (token.text.toUpperCase() !== "USE") continue;
                const previous = tokens[index - 1]?.text.toUpperCase();
                const next = tokens[index + 1]?.text.toUpperCase();
                if (!token.lineStart && previous !== ";" && previous !== "BEGIN") continue;
                if (!next || next === "MODEL" || next === "HINT" || next === "PLAN") continue;
                reportUseInModule(context, token);
            }
        }
    }
}

/** Reports create/alter/drop principal conflicts against the pinned catalog and local timeline. */
export function validatePrincipals(context: CatalogSecurityDiagnosticContext): void {
    if (context.metadata.completeness.principals !== "ready") return;
    for (const statement of [
        ...context.nodes("CreatePrincipalStatement"),
        ...context.nodes("AlterPrincipalStatement"),
        ...context.nodes("DropPrincipalStatement"),
    ]) {
        const operation = principalOperation(context, statement);
        const nameNode = firstDescendantOfKind(statement, "IdentifierName");
        if (!operation || !nameNode) continue;
        const [verb, kind] = operation;
        const name = normalizeIdentifier(context.source(nameNode));
        const existing = context.principalExistsAt(name, principalKinds(kind), nameNode.start);
        if (verb === "CREATE" && existing) {
            context.add(principalExistsCode(kind), principalExistsMessage(kind, name), nameNode);
        } else if (verb !== "CREATE" && !existing) {
            context.add(
                kind === "LOGIN" ? "CouldNotFindLogin" : "CannotFindUser",
                kind === "LOGIN"
                    ? `Cannot find the login '${name}', because it does not exist or you do not have permission.`
                    : `Cannot find the user '${name}', because it does not exist or you do not have permission.`,
                nameNode,
            );
        }

        if (verb === "CREATE" && kind === "USER" && mapsUserToLogin(context, statement)) {
            const loginNode = descendantsOfKind(statement, "IdentifierName")[1];
            if (!loginNode) continue;
            const login = normalizeIdentifier(context.source(loginNode));
            if (!context.principalExistsAt(login, ["login"], loginNode.start)) {
                context.add(
                    "CouldNotFindLogin",
                    `Cannot find the login '${login}', because it does not exist or you do not have permission.`,
                    loginNode,
                );
            }
        }
    }

    for (const statement of [
        ...context.nodes("CreateSchemaStatement"),
        ...context
            .nodes("CreatePrincipalStatement")
            .filter((node) => principalOperation(context, node)?.[1] === "ROLE"),
    ]) {
        if (!hasAuthorizationClause(context, statement)) continue;
        const owner = lastDescendantOfKind(statement, "IdentifierName");
        if (!owner) continue;
        const name = normalizeIdentifier(context.source(owner));
        if (
            context.principalExistsAt(
                name,
                ["user", "databaseRole", "applicationRole"],
                owner.start,
            )
        ) {
            continue;
        }
        context.add(
            "CannotFindUser",
            `Cannot find the user '${name}', because it does not exist or you do not have permission.`,
            owner,
        );
    }
}

function validateSecurableReference(
    context: CatalogSecurityDiagnosticContext,
    clause: SyntaxNode,
    database: string | undefined,
): void {
    const words = context.significantTokens(clause, 4).map((token) => token.text.toUpperCase());
    const kind = words.includes("CERTIFICATE")
        ? "certificate"
        : words.includes("ASYMMETRIC")
          ? "asymmetricKey"
          : undefined;
    const nameNode = kind && firstDescendantOfKind(clause, "IdentifierName");
    if (kind && nameNode) reportMissingSecurable(context, nameNode, kind, database);
}

function reportMissingSecurable(
    context: CatalogSecurityDiagnosticContext,
    nameNode: SyntaxNode,
    kind: SqlSecurableKind,
    database: string | undefined,
): void {
    const name = normalizeIdentifier(context.source(nameNode));
    const found = context.metadata
        .searchSecurables({ database, kinds: [kind], prefix: name, limit: 20 })
        .some((candidate) => context.equal(candidate.name, name));
    if (!found) context.add(securableCodes[kind], securableMessage(kind, name), nameNode);
}

function moduleOwner(statement: SyntaxNode): SyntaxNode | undefined {
    for (const kind of moduleStatementKinds) {
        const owner = parentOfKind(statement, kind);
        if (owner) return owner;
    }
    return undefined;
}

// BlockChunk exists only after parser recovery. This bounded recognizer finds statement-start USE
// inside that one recovery token; valid trees always take the structured UseStatement path.
const recoveredUseStatement = /(?:^|[;\r\n])\s*(USE)\s+(?!MODEL\b|HINT\b|PLAN\b)/giu;

function reportUsesInRecoveryChunk(
    context: CatalogSecurityDiagnosticContext,
    token: SyntaxToken,
): void {
    const source = context.source(token);
    for (const match of source.matchAll(recoveredUseStatement)) {
        const keyword = match[1]!;
        const relativeStart = match.index! + match[0].lastIndexOf(keyword);
        reportUseInModule(context, {
            start: token.start + relativeStart,
            end: token.start + relativeStart + keyword.length,
        });
    }
}

function reportUseInModule(context: CatalogSecurityDiagnosticContext, range: TextRange): void {
    context.add(
        "UseDatabaseStatementNotAllowed",
        "a USE database statement is not allowed in a procedure, function or trigger.",
        range,
    );
}

function principalOperation(
    context: CatalogSecurityDiagnosticContext,
    statement: SyntaxNode,
): readonly [verb: string, kind: string] | undefined {
    const words = context.significantTokens(statement, 2).map((token) => token.text.toUpperCase());
    const verb = words[0];
    const kind = words[1];
    if (!verb || !kind || !principalVerbs.has(verb) || !principalNouns.has(kind)) return undefined;
    return [verb, kind];
}

function mapsUserToLogin(
    context: CatalogSecurityDiagnosticContext,
    statement: SyntaxNode,
): boolean {
    const tokens = context
        .significantTokens(statement, 20)
        .map((token) => token.text.toUpperCase());
    return tokens.some(
        (token, index) => (token === "FOR" || token === "FROM") && tokens[index + 1] === "LOGIN",
    );
}

function hasAuthorizationClause(
    context: CatalogSecurityDiagnosticContext,
    statement: SyntaxNode,
): boolean {
    return context
        .significantTokens(statement, 20)
        .some((token) => token.text.toUpperCase() === "AUTHORIZATION");
}

function principalKinds(kind: string): readonly SqlPrincipalKind[] {
    if (kind === "LOGIN") return ["login"];
    if (kind === "ROLE") return ["databaseRole", "applicationRole"];
    return ["user"];
}

function principalExistsCode(kind: string): string {
    if (kind === "LOGIN") return "LoginExist";
    if (kind === "USER") return "UserExist";
    return "UserGroupOrRoleExists";
}

function principalExistsMessage(kind: string, name: string): string {
    if (kind === "LOGIN") return `There is already a login named '${name}' in the database.`;
    if (kind === "USER") return `There is already a user named '${name}' in the database.`;
    return `User, group, or role '${name}' already exists in the current database.`;
}

const moduleStatementKinds = [
    "CreateProcedureStatement",
    "CreateFunctionStatement",
    "CreateTriggerStatement",
    "AlterProcedureStatement",
    "AlterFunctionStatement",
    "AlterTriggerStatement",
] as const;

const principalVerbs = new Set(["CREATE", "ALTER", "DROP"]);
const principalNouns = new Set(["LOGIN", "USER", "ROLE"]);

const securableCodes: Readonly<Record<SqlSecurableKind, string>> = Object.freeze({
    credential: "CouldNotFindCredential",
    certificate: "CouldNotFindCertificate",
    asymmetricKey: "CouldNotFindAsymmetricKey",
});

function securableMessage(kind: SqlSecurableKind, name: string): string {
    if (kind === "credential") {
        return `Cannot find the credential '${name}', because it does not exist or you do not have permission.`;
    }
    if (kind === "certificate") {
        return `Cannot find the certificate '${name}', because it does not exist or you do not have permission.`;
    }
    return `Cannot find the assymetric key '${name}', because it does not exist or you do not have permission.`;
}
