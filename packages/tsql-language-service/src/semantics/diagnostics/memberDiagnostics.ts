/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { xmlDataTypeMember } from "../../common/typeMemberRegistry.js";
import type { ClrTypeMetadata, MetadataView } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxToken } from "../../syntax/index.js";
import {
    containsSyntaxError,
    directChildrenOfKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import {
    compactMultipartName,
    multipartIdentifierParts,
    normalizeIdentifier,
} from "../identifiers.js";
import { dataTypeNameText } from "./diagnosticTextFacts.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

export interface MemberDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    equal(left: string, right: string): boolean;
    significantTokens(range: TextRange, limit: number): readonly SyntaxToken[];
    variableTypeAt(name: string, offset: number): string | undefined;
    isKnownSystemDataType(parts: readonly string[], name: string, source: string): boolean;
    isInstanceTableMethod(node: SyntaxNode, parts: readonly string[]): boolean;
}

/** Validates CLR UDT and XML member access from parser-owned member-expression nodes. */
export function validateTypeMembers(context: MemberDiagnosticContext): void {
    for (const expression of context.nodes("VariableMemberExpression")) {
        if (containsSyntaxError(expression)) continue;
        const variable = firstDescendantOfKind(expression, "Variable");
        const member = firstMemberAccess(context, expression);
        if (!variable || !member) continue;
        const receiver = receiverType(
            context,
            context.variableTypeAt(context.source(variable), variable.start),
        );
        if (!receiver) continue;
        if (receiver.kind === "other") {
            context.add(
                "CannotCallMethodsOnType",
                `Cannot call methods on ${receiver.name}.`,
                variable,
            );
            continue;
        }
        if (receiver.kind === "xml") {
            validateXmlMember(context, expression, member);
            continue;
        }
        validateClrMember(context, receiver.type, member, false);
    }

    for (const expression of context.nodes("UdtStaticMemberExpression")) {
        if (containsSyntaxError(expression)) continue;
        const typeNode = firstDescendantOfKind(expression, "MultipartIdentifier");
        const member = firstMemberAccess(context, expression);
        if (!typeNode || !member) continue;
        const parts = multipartIdentifierParts(compactMultipartName(context.source(typeNode)));
        const resolution = context.metadata.resolveObject(parts);
        if (resolution.kind !== "resolved") continue;
        if (resolution.object.kind !== "type" || resolution.object.typeCategory !== "clr") {
            context.add(
                "CannotCallMethodsOnType",
                `Cannot call methods on ${parts.at(-1)!}.`,
                typeNode,
            );
            continue;
        }
        const state = context.metadata.clrTypeState(resolution.object.ref);
        if (state.kind !== "loaded") continue;
        validateClrMember(context, state.value, member, true);
    }
}

/** Requires XML nodes() table sources to carry both a rowset and column alias. */
export function validateXmlTableMethods(context: MemberDiagnosticContext): void {
    for (const source of context.nodes("FunctionTableSource")) {
        const nameNode = firstDescendantOfKind(source, "MultipartIdentifier");
        if (!nameNode) continue;
        const parts = multipartIdentifierParts(context.source(nameNode));
        if (!context.isInstanceTableMethod(source, parts)) continue;
        const alias = directChildrenOfKind(source, "TableAlias")[0];
        const columns = directChildrenOfKind(source, "ColumnNameList")[0];
        if (alias && columns && hasNamedColumn(context, columns)) {
            continue;
        }
        context.add(
            "TVFMethodMustBeAliased",
            "The table (and its columns) returned by a table-valued method need to be aliased.",
            nameNode,
        );
    }
    for (const source of context.nodes("VariableTableSource")) {
        const variable = directChildrenOfKind(source, "Variable")[0];
        const member = directChildrenOfKind(source, "IdentifierName")[0];
        if (!variable || !member) continue;
        const type = context.variableTypeAt(context.source(variable), variable.start);
        if (
            receiverType(context, type)?.kind !== "xml" ||
            normalizeIdentifier(context.source(member)).toUpperCase() !== "NODES"
        ) {
            continue;
        }
        const alias = directChildrenOfKind(source, "TableAlias")[0];
        const columns = directChildrenOfKind(source, "ColumnNameList")[0];
        if (alias && columns && hasNamedColumn(context, columns)) {
            continue;
        }
        context.add(
            "TVFMethodMustBeAliased",
            "The table (and its columns) returned by a table-valued method need to be aliased.",
            member,
        );
    }
}

function hasNamedColumn(context: MemberDiagnosticContext, columns: SyntaxNode): boolean {
    return directChildrenOfKind(columns, "IdentifierName").some(
        (column) => normalizeIdentifier(context.source(column)).length > 0,
    );
}

function firstMemberAccess(
    context: MemberDiagnosticContext,
    expression: SyntaxNode,
): { readonly name: SyntaxNode; readonly call: boolean } | undefined {
    for (const child of expression.children()) {
        if (child.kind === "FunctionMemberCall" || child.kind === "UdtDataMemberCall") {
            const name = firstDescendantOfKind(child, "IdentifierName");
            return name ? { name, call: child.kind === "FunctionMemberCall" } : undefined;
        }
        if (child.kind === "IdentifierName") {
            const argumentList = [...expression.children()].some(
                (node) => node.kind === "ArgumentList",
            );
            const opening = context.significantTokens(
                { start: child.end, end: expression.end },
                1,
            )[0];
            return { name: child, call: argumentList || opening?.text === "(" };
        }
    }
    return undefined;
}

function validateClrMember(
    context: MemberDiagnosticContext,
    type: ClrTypeMetadata,
    member: { readonly name: SyntaxNode; readonly call: boolean },
    viaType: boolean,
): void {
    const memberName = normalizeIdentifier(context.source(member.name));
    const candidates = type.members.filter((candidate) =>
        member.call ? candidate.kind === "method" : candidate.kind !== "method",
    );
    const found = candidates.find((candidate) => context.equal(candidate.name, memberName));
    const location = `of class '${type.className}' in assembly '${type.assemblyName}'`;
    if (!found) {
        if (!type.system) return;
        context.add(
            member.call ? "CouldNotFindMethod" : "CouldNotFindPropertyOrField",
            member.call
                ? `Could not find method '${memberName}' for type '${type.className}' in assembly '${type.assemblyName}'.`
                : `Could not find property or field '${memberName}' for type '${type.className}' in assembly '${type.assemblyName}'.`,
            member.name,
        );
        return;
    }
    const isStatic = found.static === true;
    if (isStatic === viaType) return;
    if (member.call) {
        context.add(
            isStatic ? "UdtMemberIsStatic" : "UdtMemberIsNotStatic",
            `Method, property or field '${memberName}' ${location} is${isStatic ? "" : " not"} static.`,
            member.name,
        );
        return;
    }
    context.add(
        isStatic ? "UdtPropertyIsStatic" : "UdtPropertyIsNotStatic",
        isStatic
            ? `Property or field '${memberName}' for type '${type.className}' in assembly '${type.assemblyName}' is static.`
            : `Property or field '${memberName}' for type '${type.className}' in assembly '${type.assemblyName}' is not static`,
        member.name,
    );
}

function validateXmlMember(
    context: MemberDiagnosticContext,
    expression: SyntaxNode,
    member: { readonly name: SyntaxNode; readonly call: boolean },
): void {
    const written = context.source(member.name);
    if (xmlDataTypeMember(normalizeIdentifier(written)) === undefined) {
        context.add(
            "NotValidFunctionOrProperty",
            `"${written}" is not a valid function, property, or field.`,
            member.name,
        );
        return;
    }
    if (member.call) return;
    context.add(
        "IncorrectSyntaxToInvokeXmlMethod",
        `Incorrect syntax was used to invoke the XML data type method '${written}'.`,
        expression,
    );
}

function receiverType(
    context: MemberDiagnosticContext,
    typeDisplay: string | undefined,
):
    | { readonly kind: "clr"; readonly type: ClrTypeMetadata }
    | { readonly kind: "xml" }
    | { readonly kind: "other"; readonly name: string }
    | undefined {
    if (!typeDisplay) return undefined;
    const parts = multipartIdentifierParts(compactMultipartName(dataTypeNameText(typeDisplay)));
    const name = parts.at(-1);
    if (!name) return undefined;
    if (parts.length === 1 && name.toLowerCase() === "xml") return { kind: "xml" };
    const resolution = context.metadata.resolveObject(parts);
    if (resolution.kind === "resolved" && resolution.object.kind === "type") {
        if (resolution.object.typeCategory !== "clr") return { kind: "other", name };
        const state = context.metadata.clrTypeState(resolution.object.ref);
        return state.kind === "loaded" ? { kind: "clr", type: state.value } : undefined;
    }
    if (parts.length === 1 && context.isKnownSystemDataType(parts, name, typeDisplay)) {
        return { kind: "other", name: name.toLowerCase() };
    }
    return undefined;
}
