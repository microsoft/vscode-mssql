/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BridgeErrorCode, BridgeRequestError, QueryContentDescriptor } from "./contracts";

const parameterNameRegex = /^@?[A-Za-z_][A-Za-z0-9_]*$/;
const goBatchSeparatorRegex = /^\s*GO\s*(?:--.*)?$/im;

export function normalizeSqlToolsMcpQuery(descriptor: QueryContentDescriptor): string {
    if (!descriptor || typeof descriptor.query !== "string" || descriptor.query.length === 0) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "QueryContentDescriptor.query is required.",
        );
    }

    if (descriptor.executeStoredProcedure === true) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "Stored procedure execution is not supported by the VS Code SQL Tools MCP bridge.",
        );
    }

    const queryParameters = descriptor.queryParameters ?? [];
    const returnAsMarkdown = descriptor.returnAsMarkdown ?? true;

    // The SQL Tools MCP SQL data-access path always supplies this as a SQL parameter.
    // The STS text path has no parameter bag, so mirror it as a declaration.
    if (goBatchSeparatorRegex.test(descriptor.query)) {
        throw new BridgeRequestError(
            BridgeErrorCode.InvalidRequest,
            "Normalized execution does not support GO-separated batches.",
        );
    }

    const declarations: string[] = [];
    for (const parameter of queryParameters) {
        declarations.push(toParameterDeclaration(parameter));
    }

    declarations.push(`DECLARE @returnAsMarkdown bit = ${returnAsMarkdown === true ? "1" : "0"};`);

    return `${declarations.join("\n")}\n${descriptor.query}`;
}

function toParameterDeclaration(parameter: string): string {
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
    return `DECLARE ${normalizedName} nvarchar(max) = N'${escapeSqlString(value)}';`;
}

function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}
