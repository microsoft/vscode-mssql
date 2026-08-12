/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createSqlEditorFeatureServices,
    type SqlEditorFeatureServices,
    type SqlFeatureDocumentAccessor,
} from "./features/index.js";
import { createTsqlServices } from "./services.js";
import type { TsqlDocumentFactoryOptions, TsqlServiceModule, TsqlServices } from "./types.js";

export interface TsqlSqlLanguageServices extends TsqlServices {
    readonly lsp: SqlEditorFeatureServices;
}

/** Composes parser-neutral structural providers with the package document lifecycle. */
export function createTsqlSqlLanguageServices(
    options: TsqlDocumentFactoryOptions,
): TsqlSqlLanguageServices {
    const providerModule: TsqlServiceModule<{ readonly lsp: SqlEditorFeatureServices }> = {
        lsp: (services) => {
            const documents: SqlFeatureDocumentAccessor = {
                getDocument: (uri) => {
                    const document = services.documents.get(uri);
                    return document
                        ? {
                              uri: document.uri.toString(),
                              version: document.version,
                              text: document.textDocument.getText(),
                              analysis: document.analysis,
                          }
                        : undefined;
                },
            };
            return createSqlEditorFeatureServices(documents);
        },
    };
    return createTsqlServices(options, providerModule);
}
