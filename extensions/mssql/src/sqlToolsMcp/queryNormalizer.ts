/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BridgeErrorCode, BridgeRequestError, QueryContentDescriptor } from "./contracts";

const parameterNameRegex = /^@?[A-Za-z_][A-Za-z0-9_]*$/;
const storedProcedureNamePartRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
const goBatchSeparatorRegex = /^\s*GO\s*(?:--.*)?$/im;
const returnAsMarkdownParameterName = "@returnAsMarkdown";

interface QueryParameter {
    name: string;
    value: string;
}

export function normalizeSqlToolsMcpQuery(descriptor: QueryContentDescriptor): string {
    if (!descriptor || typeof descriptor.query !== "string" || descriptor.query.length === 0) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "QueryContentDescriptor.query is required.",
        );
    }

    const queryParameters = parseQueryParameters(descriptor.queryParameters ?? []);
    const returnAsMarkdown = descriptor.returnAsMarkdown ?? true;

    // The SQL Tools MCP SQL data-access path always supplies this as a SQL parameter.
    // The STS text path has no parameter bag, so mirror it as a declaration.
    if (goBatchSeparatorRegex.test(descriptor.query)) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "Normalized execution does not support GO-separated batches.",
        );
    }

    if (descriptor.executeStoredProcedure === true) {
        const declarations = queryParameters.map(toParameterDeclaration);
        return `${declarations.join("\n")}\n${toStoredProcedureExecution(
            descriptor.query,
            queryParameters,
        )}`;
    }

    // Keep SQL Tools MCP-authored SQL text compatible with queries that reference
    // @returnAsMarkdown. Stored procedures only receive explicit queryParameters.
    if (!hasParameter(queryParameters, returnAsMarkdownParameterName)) {
        queryParameters.push({
            name: returnAsMarkdownParameterName,
            value: returnAsMarkdown === true ? "1" : "0",
        });
    }

    const declarations = queryParameters.map(toParameterDeclaration);
    return `${declarations.join("\n")}\n${descriptor.query}`;
}

function parseQueryParameters(parameters: string[]): QueryParameter[] {
    return parameters.map(parseQueryParameter);
}

function parseQueryParameter(parameter: string): QueryParameter {
    const separatorIndex = parameter.indexOf("=");
    if (separatorIndex <= 0) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "Query parameters must use name=value syntax.",
        );
    }

    const rawName = parameter.slice(0, separatorIndex).trim();
    const value = parameter.slice(separatorIndex + 1);
    if (!parameterNameRegex.test(rawName)) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "Query parameter name is invalid.",
        );
    }

    const normalizedName = rawName.startsWith("@") ? rawName : `@${rawName}`;
    return { name: normalizedName, value };
}

function toParameterDeclaration(parameter: QueryParameter): string {
    if (isReturnAsMarkdownParameter(parameter.name)) {
        const normalizedValue = normalizeBooleanParameter(parameter.value);
        return `DECLARE ${parameter.name} bit = ${normalizedValue};`;
    }

    return `DECLARE ${parameter.name} nvarchar(max) = N'${escapeSqlString(parameter.value)}';`;
}

function toStoredProcedureExecution(query: string, parameters: QueryParameter[]): string {
    const procedureName = normalizeStoredProcedureName(query);
    const parameterBindings = parameters
        .map((parameter) => `${parameter.name} = ${parameter.name}`)
        .join(", ");

    return parameterBindings.length > 0
        ? `EXEC ${procedureName} ${parameterBindings};`
        : `EXEC ${procedureName};`;
}

function normalizeStoredProcedureName(query: string): string {
    const parts = query.trim().split(".");
    if (parts.length === 0 || parts.length > 3) {
        throw invalidStoredProcedureNameError();
    }

    if (parts.some((part) => !storedProcedureNamePartRegex.test(part))) {
        throw invalidStoredProcedureNameError();
    }

    return parts.map((part) => `[${part}]`).join(".");
}

function hasParameter(parameters: QueryParameter[], name: string): boolean {
    return parameters.some((parameter) => parameter.name.toLowerCase() === name.toLowerCase());
}

function isReturnAsMarkdownParameter(name: string): boolean {
    return name.toLowerCase() === returnAsMarkdownParameterName.toLowerCase();
}

function normalizeBooleanParameter(value: string): string {
    switch (value.trim().toLowerCase()) {
        case "1":
        case "true":
            return "1";
        case "0":
        case "false":
            return "0";
        default:
            throw new BridgeRequestError(
                BridgeErrorCode.InvalidRequest,
                "returnAsMarkdown must be true or false.",
            );
    }
}

function invalidStoredProcedureNameError(): BridgeRequestError {
    return new BridgeRequestError(
        BridgeErrorCode.InvalidRequest,
        "Stored procedure execution requires a valid procedure name.",
    );
}

function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}
