/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    descendantsOwnedByKind,
    directChildrenOfKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import type { MetadataView, ObjectMetadata } from "../../metadata/index.js";
import type { SyntaxKind, SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import {
    compactMultipartName,
    multipartIdentifierPartRange,
    multipartIdentifierParts,
} from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";
import { dataTypeNameText, isCreateOrAlter, parseDataTypeText } from "./diagnosticTextFacts.js";

/** Validates the database-prefix restriction on CREATE and DROP SYNONYM names. */
export function validateSynonyms(context: DiagnosticFamilyContext): void {
    for (const create of context.nodes("CreateSynonymStatement")) {
        const name = firstDescendantOfKind(create, "MultipartIdentifier");
        if (name) {
            validateDatabasePrefix(
                context,
                name,
                "DbNameIsNotAllowedForCreateSynonym",
                "'CREATE SYNONYM' does not allow specifying the database name as a prefix to the object name.",
            );
        }
    }
    for (const drop of context.nodes("DropSynonymStatement")) {
        for (const name of descendantsOwnedByKind(drop, "MultipartIdentifier", drop)) {
            validateDatabasePrefix(
                context,
                name,
                "DbNameIsNotAllowedForDropSynonym",
                "'DROP SYNONYM' does not allow specifying the database name as a prefix to the object name.",
            );
        }
    }
}

type DdlObjectKind = "table" | "view" | "procedure" | "function";

export interface DdlObjectState {
    readonly create: boolean;
    readonly kind: "table" | "view" | "tableFunction" | "synonym";
}

export type UserTypeState =
    | { readonly kind: "resolved"; readonly typeCategory: "alias" | "clr" | "table" }
    | { readonly kind: "notFound" }
    | { readonly kind: "unknown" };

export interface ObjectDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    readonly syntax: SyntaxSnapshot;
    equal(left: string, right: string): boolean;
    databaseMissing(name: string): boolean;
    localDdlObjectAt(parts: readonly string[], offset: number): DdlObjectState | undefined;
    userTypeAt(parts: readonly string[], offset: number): UserTypeState;
    isKnownSystemDataType(parts: readonly string[], name: string, source: string): boolean;
}

/** Validates CREATE TYPE names and alias base types. */
export function validateUserTypes(context: ObjectDiagnosticContext): void {
    for (const create of context.nodes("CreateTypeStatement")) {
        const nameNode = firstDescendantOfKind(create, "MultipartIdentifier");
        if (!nameNode) continue;
        const parts = multipartIdentifierParts(context.source(nameNode));
        const existing = context.userTypeAt(parts, create.start);
        if (existing.kind === "resolved") {
            const display = compactMultipartName(context.source(nameNode));
            context.add(
                "UserDefinedTypeExist",
                `The type '${display}' already exists, or you do not have permission to create it.`,
                nameNode,
            );
        }
        const baseType = directChildrenOfKind(create, "DataType")[0];
        if (!baseType) continue;
        const source = context.source(baseType);
        const parsed = parseDataTypeText(source);
        if (!parsed) continue;
        const baseParts = dataTypeParts(context.syntax, baseType);
        const systemType = context.isKnownSystemDataType(baseParts, parsed.name, source);
        if (systemType && !invalidAliasBaseTypes.has(parsed.name)) continue;
        const display = compactMultipartName(dataTypeNameText(source));
        context.add(
            "InvalidBaseTypeForAlias",
            `The base type '${display}' is not a valid base type for the alias data type.`,
            baseType,
        );
    }
}

/** Validates common CREATE, ALTER, and DROP object lifetime/type rules. */
export function validateDdlObjects(context: ObjectDiagnosticContext): void {
    for (const rule of ddlRules) {
        for (const node of context.nodes(rule.create)) validateCreateObject(context, node);
        for (const node of context.nodes(rule.alter)) {
            validateAlterObject(context, node, rule.kind);
        }
        for (const node of context.nodes(rule.drop)) validateDropObject(context, node, rule.kind);
    }
}

function validateCreateObject(context: ObjectDiagnosticContext, node: SyntaxNode): void {
    const nameNode = firstDescendantOfKind(node, "MultipartIdentifier");
    if (!nameNode) return;
    const name = compactMultipartName(context.source(nameNode));
    const parts = multipartIdentifierParts(name);
    if (parts.length >= 3 && databasePrefixedModuleKinds.has(node.kind)) return;
    if (parts.at(-1)?.startsWith("#")) return;
    if (parts.length >= 3 && context.databaseMissing(parts.at(-3)!)) {
        const database = parts.at(-3)!;
        context.add(
            "DatabaseNotExist",
            `Database '${database}' does not exist.`,
            multipartIdentifierPartRange(
                context.source(nameNode),
                nameNode.start,
                parts.length - 3,
                nameNode,
            ),
        );
        return;
    }
    if (parts.length >= 2) {
        const schemaName = parts.at(-2)!;
        const database =
            parts.length >= 3 ? parts.at(-3) : context.metadata.environment.currentDatabase;
        const schemas = context.metadata.schemas(database);
        if (
            schemas &&
            !schemas.some(
                (schema) =>
                    context.equal(schema.name, schemaName) &&
                    (!database || !schema.database || context.equal(schema.database, database)),
            )
        ) {
            context.add(
                "SchemaNotExist",
                ` The specified schema name "${schemaName}" either does not exist or you do not have permission to use it.`,
                multipartIdentifierPartRange(
                    context.source(nameNode),
                    nameNode.start,
                    parts.length - 2,
                    nameNode,
                ),
            );
            return;
        }
    }
    if (
        !isCreateOrAlter(context.source(node)) &&
        context.metadata.resolveObject(parts).kind === "resolved"
    ) {
        context.add(
            "DatabaseObjectExist",
            `There is already an object named '${name}' in the database.`,
            nameNode,
        );
    }
}

function validateAlterObject(
    context: ObjectDiagnosticContext,
    node: SyntaxNode,
    expectedKind: DdlObjectKind,
): void {
    const nameNode = firstDescendantOfKind(node, "MultipartIdentifier");
    if (!nameNode) return;
    const name = compactMultipartName(context.source(nameNode));
    const parts = multipartIdentifierParts(name);
    if (parts.length >= 3 && databasePrefixedModuleKinds.has(node.kind)) return;
    const local = context.localDdlObjectAt(parts, nameNode.start);
    const resolution = context.metadata.resolveObject(parts);
    if (
        (local && (!local.create || !localMatches(local, expectedKind))) ||
        (!local &&
            (resolution.kind === "notFound" ||
                (resolution.kind === "resolved" &&
                    !catalogObjectMatches(resolution.object, expectedKind))))
    ) {
        context.add(
            "CannotPerformAlterOnObject",
            `Cannot perform alter on '${name}' because it is an incompatible object type.`,
            nameNode,
        );
    }
}

function validateDropObject(
    context: ObjectDiagnosticContext,
    node: SyntaxNode,
    expectedKind: DdlObjectKind,
): void {
    for (const nameNode of descendantsOwnedByKind(node, "MultipartIdentifier", node)) {
        const name = compactMultipartName(context.source(nameNode));
        const parts = multipartIdentifierParts(name);
        const local = context.localDdlObjectAt(parts, nameNode.start);
        const resolution = context.metadata.resolveObject(parts);
        if ((local && !local.create) || (!local && resolution.kind === "notFound")) {
            context.add(
                "CannotDropObject",
                `Cannot drop the ${expectedKind} '${name}', because it does not exist or you do not have permission.`,
                nameNode,
            );
        } else if (
            (local?.create && !localMatches(local, expectedKind)) ||
            (!local &&
                resolution.kind === "resolved" &&
                !catalogObjectMatches(resolution.object, expectedKind))
        ) {
            const actualKind =
                local?.kind ?? (resolution.kind === "resolved" ? resolution.object.kind : "object");
            context.add(
                "CannotUseDrop",
                `Cannot use DROP ${expectedKind.toUpperCase()} with '${name}' because '${name}' is a ${actualKind}.`,
                nameNode,
            );
        }
    }
}

function localMatches(event: DdlObjectState, expected: DdlObjectKind): boolean {
    if (expected === "function") return event.kind === "tableFunction";
    return event.kind === expected;
}

function catalogObjectMatches(object: ObjectMetadata, expected: DdlObjectKind): boolean {
    return expected === "function"
        ? object.kind === "scalarFunction" || object.kind === "tableFunction"
        : object.kind === expected;
}

function dataTypeParts(syntax: SyntaxSnapshot, dataType: SyntaxNode): readonly string[] {
    const name = firstDescendantOfKind(dataType, "MultipartIdentifier");
    return name ? multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)) : [];
}

const ddlRules: readonly {
    readonly create: SyntaxKind;
    readonly alter: SyntaxKind;
    readonly drop: SyntaxKind;
    readonly kind: DdlObjectKind;
}[] = [
    {
        create: "CreateTableStatement",
        alter: "AlterTableStatement",
        drop: "DropTableStatement",
        kind: "table",
    },
    {
        create: "CreateViewStatement",
        alter: "AlterViewStatement",
        drop: "DropViewStatement",
        kind: "view",
    },
    {
        create: "CreateProcedureStatement",
        alter: "AlterProcedureStatement",
        drop: "DropProcedureStatement",
        kind: "procedure",
    },
    {
        create: "CreateFunctionStatement",
        alter: "AlterFunctionStatement",
        drop: "DropFunctionStatement",
        kind: "function",
    },
];

const databasePrefixedModuleKinds = new Set<SyntaxKind>([
    "AlterFunctionStatement",
    "AlterProcedureStatement",
    "AlterViewStatement",
    "CreateFunctionStatement",
    "CreateProcedureStatement",
    "CreateViewStatement",
]);

const invalidAliasBaseTypes = new Set([
    "geography",
    "geometry",
    "hierarchyid",
    "json",
    "sysname",
    "vector",
    "xml",
]);

function validateDatabasePrefix(
    context: DiagnosticFamilyContext,
    name: { readonly start: number; readonly end: number },
    code: string,
    message: string,
): void {
    const source = context.source(name);
    const parts = multipartIdentifierParts(source);
    if (parts.length < 3) return;
    context.add(
        code,
        message,
        multipartIdentifierPartRange(source, name.start, parts.length - 3, name),
    );
}
