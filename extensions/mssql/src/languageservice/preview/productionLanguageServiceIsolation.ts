/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { Middleware } from "vscode-languageclient";

export const previewLanguageServiceSetting = "mssql.preview.languageService";
export const previewLanguageServiceStatsCodeLensSetting =
    "mssql.preview.languageServiceStatsCodeLens";

export function isPreviewLanguageServiceEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(previewLanguageServiceSetting, false);
}

interface ProductionLanguageServiceMiddlewareOptions {
    readonly isPreviewEnabled?: () => boolean;
    readonly onCompletionResult?: (
        document: vscode.TextDocument,
        context: vscode.CompletionContext,
        count: number,
    ) => void;
}

/** Routes only features for which the preview host registers a complete replacement. */
export function createProductionLanguageServiceMiddleware(
    options: ProductionLanguageServiceMiddlewareOptions = {},
): Middleware {
    const previewEnabled = options.isPreviewEnabled ?? isPreviewLanguageServiceEnabled;

    return {
        provideCompletionItem: async (document, position, context, token, next) => {
            if (previewEnabled()) return undefined;
            const result = await next(document, position, context, token);
            const count = Array.isArray(result) ? result.length : (result?.items.length ?? 0);
            options.onCompletionResult?.(document, context, count);
            return result;
        },
        resolveCompletionItem: (item, token, next) =>
            previewEnabled() ? undefined : next(item, token),
        provideHover: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideDefinition: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideSignatureHelp: (document, position, context, token, next) =>
            previewEnabled() ? undefined : next(document, position, context, token),
        provideFoldingRanges: (document, context, token, next) =>
            previewEnabled() ? undefined : next(document, context, token),
        provideDocumentSemanticTokens: (document, token, next) =>
            previewEnabled() ? undefined : next(document, token),
        provideDocumentSemanticTokensEdits: (document, previousResultId, token, next) =>
            previewEnabled() ? undefined : next(document, previousResultId, token),
        provideDocumentRangeSemanticTokens: (document, range, token, next) =>
            previewEnabled() ? undefined : next(document, range, token),
        provideDiagnostics: (document, previousResultId, token, next) =>
            previewEnabled() ? undefined : next(document, previousResultId, token),
        handleDiagnostics: (uri, diagnostics, next) =>
            next(uri, previewEnabled() ? [] : diagnostics),
    };
}
