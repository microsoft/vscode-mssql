/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlCompletionResolveProvider } from "./completionResolveProvider.js";
import { SqlDiagnosticProvider } from "./diagnosticProvider.js";
import { SqlDocumentSymbolProvider } from "./documentSymbolProvider.js";
import type { SqlFeatureDocumentAccessor } from "./featureDocument.js";
import { SqlFoldingRangeProvider } from "./foldingRangeProvider.js";
import { SqlFormattingProvider } from "./formattingProvider.js";
import { SqlNavigationProvider } from "./navigationProvider.js";
import { SqlSelectionRangeProvider } from "./selectionRangeProvider.js";
import { SqlSemanticTokenProvider } from "./semanticTokenProvider.js";

/** Parser-neutral editor providers grouped by their LSP responsibilities. */
export interface SqlEditorFeatureServices {
    readonly CompletionResolveProvider: SqlCompletionResolveProvider;
    readonly DiagnosticProvider: SqlDiagnosticProvider;
    readonly DefinitionProvider: SqlNavigationProvider;
    readonly ReferencesProvider: SqlNavigationProvider;
    readonly DocumentHighlightProvider: SqlNavigationProvider;
    readonly RenameProvider: SqlNavigationProvider;
    readonly DocumentSymbolProvider: SqlDocumentSymbolProvider;
    readonly SemanticTokenProvider: SqlSemanticTokenProvider;
    readonly FoldingRangeProvider: SqlFoldingRangeProvider;
    readonly SelectionRangeProvider: SqlSelectionRangeProvider;
    readonly FormattingProvider: SqlFormattingProvider;
}

export function createSqlEditorFeatureServices(
    documents: SqlFeatureDocumentAccessor,
): SqlEditorFeatureServices {
    const navigation = new SqlNavigationProvider(documents);
    return {
        CompletionResolveProvider: new SqlCompletionResolveProvider(documents),
        DiagnosticProvider: new SqlDiagnosticProvider(documents),
        DefinitionProvider: navigation,
        ReferencesProvider: navigation,
        DocumentHighlightProvider: navigation,
        RenameProvider: navigation,
        DocumentSymbolProvider: new SqlDocumentSymbolProvider(documents),
        SemanticTokenProvider: new SqlSemanticTokenProvider(documents),
        FoldingRangeProvider: new SqlFoldingRangeProvider(documents),
        SelectionRangeProvider: new SqlSelectionRangeProvider(documents),
        FormattingProvider: new SqlFormattingProvider(documents),
    };
}
