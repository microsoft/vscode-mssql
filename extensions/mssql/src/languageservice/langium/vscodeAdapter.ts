/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from "vscode";
import {
    URI,
    type TsqlDocumentService,
    type TsqlDocumentSource,
    type TsqlDocumentUpdateOptions,
    type TsqlLangiumDocument,
} from "@vscode-mssql/tsql-language-service/langium";

/** Converts a VS Code editor document directly into the core's host-neutral snapshot input. */
export function asTsqlDocumentSource(document: vscode.TextDocument): TsqlDocumentSource {
    return {
        uri: URI.parse(document.uri.toString()),
        languageId: document.languageId,
        version: document.version,
        getText: () => document.getText(),
    };
}

/** Convenience adapter used by VS Code feature providers; it does not register any provider. */
export function updateFromVsCodeDocument(
    service: TsqlDocumentService,
    document: vscode.TextDocument,
    options: TsqlDocumentUpdateOptions = {},
): TsqlLangiumDocument {
    return service.update(asTsqlDocumentSource(document), options);
}
