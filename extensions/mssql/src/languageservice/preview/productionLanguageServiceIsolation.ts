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

/**
 * Keeps SQL Tools Service available for connections and query execution while making editor
 * language features exclusive to the preview implementation when its flag is enabled.
 */
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
        provideDeclaration: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideTypeDefinition: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideImplementation: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideReferences: (document, position, context, token, next) =>
            previewEnabled() ? undefined : next(document, position, context, token),
        provideDocumentHighlights: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideSignatureHelp: (document, position, context, token, next) =>
            previewEnabled() ? undefined : next(document, position, context, token),
        provideDocumentSymbols: (document, token, next) =>
            previewEnabled() ? undefined : next(document, token),
        provideWorkspaceSymbols: (query, token, next) =>
            previewEnabled() ? undefined : next(query, token),
        resolveWorkspaceSymbol: (item, token, next) =>
            previewEnabled() ? undefined : next(item, token),
        provideCodeActions: (document, range, context, token, next) =>
            previewEnabled() ? undefined : next(document, range, context, token),
        resolveCodeAction: (item, token, next) =>
            previewEnabled() ? undefined : next(item, token),
        provideCodeLenses: (document, token, next) =>
            previewEnabled() ? undefined : next(document, token),
        resolveCodeLens: (item, token, next) => (previewEnabled() ? undefined : next(item, token)),
        provideDocumentColors: (document, token, next) =>
            previewEnabled() ? undefined : next(document, token),
        provideColorPresentations: (color, context, token, next) =>
            previewEnabled() ? undefined : next(color, context, token),
        provideFoldingRanges: (document, context, token, next) =>
            previewEnabled() ? undefined : next(document, context, token),
        provideSelectionRanges: (document, positions, token, next) =>
            previewEnabled() ? undefined : next(document, positions, token),
        provideDocumentFormattingEdits: (document, formatOptions, token, next) =>
            previewEnabled() ? undefined : next(document, formatOptions, token),
        provideDocumentRangeFormattingEdits: (document, range, formatOptions, token, next) =>
            previewEnabled() ? undefined : next(document, range, formatOptions, token),
        provideDocumentRangesFormattingEdits: (document, ranges, formatOptions, token, next) =>
            previewEnabled() ? undefined : next(document, ranges, formatOptions, token),
        provideOnTypeFormattingEdits: (
            document,
            position,
            character,
            formatOptions,
            token,
            next,
        ) =>
            previewEnabled()
                ? undefined
                : next(document, position, character, formatOptions, token),
        prepareRename: (document, position, token, next) =>
            previewEnabled() ? undefined : next(document, position, token),
        provideRenameEdits: (document, position, newName, token, next) =>
            previewEnabled() ? undefined : next(document, position, newName, token),
        provideDocumentLinks: (document, token, next) =>
            previewEnabled() ? undefined : next(document, token),
        resolveDocumentLink: (item, token, next) =>
            previewEnabled() ? undefined : next(item, token),
        provideDocumentSemanticTokens: (document, token, next) =>
            previewEnabled() ? undefined : next(document, token),
        provideDocumentSemanticTokensEdits: (document, previousResultId, token, next) =>
            previewEnabled() ? undefined : next(document, previousResultId, token),
        provideDocumentRangeSemanticTokens: (document, range, token, next) =>
            previewEnabled() ? undefined : next(document, range, token),
        provideInlayHints: (document, range, token, next) =>
            previewEnabled() ? undefined : next(document, range, token),
        resolveInlayHint: (item, token, next) => (previewEnabled() ? undefined : next(item, token)),
        provideInlineCompletionItems: (document, position, context, token, next) =>
            previewEnabled() ? undefined : next(document, position, context, token),
        provideDiagnostics: (document, previousResultId, token, next) =>
            previewEnabled() ? undefined : next(document, previousResultId, token),
        provideWorkspaceDiagnostics: (resultIds, token, reporter, next) =>
            previewEnabled() ? undefined : next(resultIds, token, reporter),
        handleDiagnostics: (uri, diagnostics, next) =>
            next(uri, previewEnabled() ? [] : diagnostics),
    };
}
