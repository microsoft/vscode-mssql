/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type {
    DocumentSymbol as ProtocolDocumentSymbol,
    Range as ProtocolRange,
    SelectionRange as ProtocolSelectionRange,
} from "vscode-languageserver-protocol";
import { betaSqlOwnsDocument } from "../betaSqlLanguageServiceOwnership";
import { SqlSymbolRenameProvider } from "../sqlSymbolRenameProvider";
import type { TsqlSqlLanguageServices } from "./sqlLanguageServices";

export interface TsqlSessionLoader {
    readonly languageServices: TsqlSqlLanguageServices;
    getSession(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken,
    ): Promise<unknown | undefined>;
    getParsedSession(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken,
    ): unknown | undefined;
}

/** Thin VS Code adapters over the protocol-shaped providers composed by Langium. */
export class TsqlVsCodeFeatureProviders
    implements
        vscode.ReferenceProvider,
        vscode.DocumentHighlightProvider,
        vscode.DocumentSymbolProvider,
        vscode.DocumentSemanticTokensProvider,
        vscode.DocumentRangeSemanticTokensProvider,
        vscode.FoldingRangeProvider,
        vscode.SelectionRangeProvider,
        vscode.InlayHintsProvider,
        vscode.DocumentFormattingEditProvider,
        vscode.RenameProvider
{
    public readonly semanticTokensLegend: vscode.SemanticTokensLegend;

    public constructor(private readonly _sessions: TsqlSessionLoader) {
        const legend = this._sessions.languageServices.lsp.SemanticTokenProvider.legend;
        this.semanticTokensLegend = new vscode.SemanticTokensLegend(
            [...legend.tokenTypes],
            [...legend.tokenModifiers],
        );
    }

    public register(selector: vscode.DocumentSelector): vscode.Disposable[] {
        return [
            vscode.languages.registerReferenceProvider(selector, this),
            vscode.languages.registerDocumentHighlightProvider(selector, this),
            vscode.languages.registerDocumentSymbolProvider(selector, this),
            vscode.languages.registerDocumentSemanticTokensProvider(
                selector,
                this,
                this.semanticTokensLegend,
            ),
            vscode.languages.registerDocumentRangeSemanticTokensProvider(
                selector,
                this,
                this.semanticTokensLegend,
            ),
            vscode.languages.registerFoldingRangeProvider(selector, this),
            vscode.languages.registerSelectionRangeProvider(selector, this),
            vscode.languages.registerInlayHintsProvider(selector, this),
            vscode.languages.registerDocumentFormattingEditProvider(selector, this),
            vscode.languages.registerRenameProvider(
                selector,
                new RoutedSqlRenameProvider(this, new SqlSymbolRenameProvider()),
            ),
        ];
    }

    public async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.Location[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const locations =
            await this._sessions.languageServices.lsp.ReferencesProvider.findReferences(
                document.uri.toString(),
                asProtocolPosition(position),
                context.includeDeclaration,
            );
        return !this.isCurrent(document, token)
            ? []
            : locations.map(
                  (location) =>
                      new vscode.Location(
                          vscode.Uri.parse(location.uri),
                          asVsCodeRange(location.range),
                      ),
              );
    }

    public async provideDocumentHighlights(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentHighlight[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const highlights =
            await this._sessions.languageServices.lsp.DocumentHighlightProvider.getDocumentHighlights(
                document.uri.toString(),
                asProtocolPosition(position),
            );
        return !this.isCurrent(document, token)
            ? []
            : (highlights ?? []).map(
                  (highlight) =>
                      new vscode.DocumentHighlight(
                          asVsCodeRange(highlight.range),
                          highlight.kind as vscode.DocumentHighlightKind,
                      ),
              );
    }

    public async provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentSymbol[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const symbols = await this._sessions.languageServices.lsp.DocumentSymbolProvider.getSymbols(
            document.uri.toString(),
        );
        return this.isCurrent(document, token) ? symbols.map(asVsCodeDocumentSymbol) : [];
    }

    public async provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens> {
        if (!(await this.load(document, token))) {
            return emptySemanticTokens();
        }
        const result =
            await this._sessions.languageServices.lsp.SemanticTokenProvider.getSemanticTokens(
                document.uri.toString(),
            );
        return !this.isCurrent(document, token)
            ? emptySemanticTokens()
            : new vscode.SemanticTokens(Uint32Array.from(result.data), result.resultId);
    }

    public async provideDocumentSemanticTokensEdits(
        document: vscode.TextDocument,
        previousResultId: string,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | vscode.SemanticTokensEdits> {
        if (!(await this.load(document, token))) {
            return emptySemanticTokens();
        }
        const result =
            await this._sessions.languageServices.lsp.SemanticTokenProvider.getSemanticTokenEdits(
                document.uri.toString(),
                previousResultId,
            );
        if (!this.isCurrent(document, token)) {
            return emptySemanticTokens();
        }
        return "edits" in result
            ? new vscode.SemanticTokensEdits(
                  result.edits.map(
                      (edit) =>
                          new vscode.SemanticTokensEdit(
                              edit.start,
                              edit.deleteCount,
                              edit.data ? Uint32Array.from(edit.data) : undefined,
                          ),
                  ),
                  result.resultId,
              )
            : new vscode.SemanticTokens(Uint32Array.from(result.data), result.resultId);
    }

    public async provideDocumentRangeSemanticTokens(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens> {
        if (!(await this.load(document, token))) {
            return emptySemanticTokens();
        }
        const result =
            await this._sessions.languageServices.lsp.SemanticTokenProvider.getSemanticTokens(
                document.uri.toString(),
                asProtocolRange(range),
            );
        return !this.isCurrent(document, token)
            ? emptySemanticTokens()
            : new vscode.SemanticTokens(Uint32Array.from(result.data));
    }

    public async provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.FoldingRange[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const ranges =
            await this._sessions.languageServices.lsp.FoldingRangeProvider.getFoldingRanges(
                document.uri.toString(),
            );
        return !this.isCurrent(document, token)
            ? []
            : ranges.map(
                  (range) =>
                      new vscode.FoldingRange(
                          range.startLine,
                          range.endLine,
                          range.kind === "comment"
                              ? vscode.FoldingRangeKind.Comment
                              : range.kind === "imports"
                                ? vscode.FoldingRangeKind.Imports
                                : range.kind === "region"
                                  ? vscode.FoldingRangeKind.Region
                                  : undefined,
                      ),
              );
    }

    public async provideSelectionRanges(
        document: vscode.TextDocument,
        positions: readonly vscode.Position[],
        token: vscode.CancellationToken,
    ): Promise<vscode.SelectionRange[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const ranges =
            await this._sessions.languageServices.lsp.SelectionRangeProvider.getSelectionRanges(
                document.uri.toString(),
                positions.map(asProtocolPosition),
            );
        return this.isCurrent(document, token) ? ranges.map(asVsCodeSelectionRange) : [];
    }

    public async provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlayHint[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const hints = await this._sessions.languageServices.lsp.InlayHintProvider.getInlayHints(
            document.uri.toString(),
            asProtocolRange(range),
        );
        if (!this.isCurrent(document, token)) {
            return [];
        }
        return hints.map((hint) => {
            const label =
                typeof hint.label === "string"
                    ? hint.label
                    : hint.label.map((part) => new vscode.InlayHintLabelPart(part.value));
            const result = new vscode.InlayHint(
                new vscode.Position(hint.position.line, hint.position.character),
                label,
                hint.kind as vscode.InlayHintKind | undefined,
            );
            result.paddingLeft = hint.paddingLeft;
            result.paddingRight = hint.paddingRight;
            result.tooltip = typeof hint.tooltip === "string" ? hint.tooltip : undefined;
            return result;
        });
    }

    public async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken,
    ): Promise<vscode.TextEdit[]> {
        if (!(await this.load(document, token))) {
            return [];
        }
        const edits = await this._sessions.languageServices.lsp.FormattingProvider.formatDocument(
            document.uri.toString(),
            { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        );
        return !this.isCurrent(document, token)
            ? []
            : edits.map((edit) => new vscode.TextEdit(asVsCodeRange(edit.range), edit.newText));
    }

    public async prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Range | undefined> {
        if (!(await this.load(document, token))) {
            return undefined;
        }
        const range = await this._sessions.languageServices.lsp.RenameProvider.prepareRename(
            document.uri.toString(),
            asProtocolPosition(position),
        );
        return range && this.isCurrent(document, token) ? asVsCodeRange(range) : undefined;
    }

    public async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken,
    ): Promise<vscode.WorkspaceEdit | undefined> {
        if (!(await this.load(document, token))) {
            return undefined;
        }
        const edit = await this._sessions.languageServices.lsp.RenameProvider.rename(
            document.uri.toString(),
            asProtocolPosition(position),
            newName,
        );
        if (!edit || !this.isCurrent(document, token)) {
            return undefined;
        }
        const result = new vscode.WorkspaceEdit();
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
            result.set(
                vscode.Uri.parse(uri),
                edits.map(
                    (textEdit) =>
                        new vscode.TextEdit(asVsCodeRange(textEdit.range), textEdit.newText),
                ),
            );
        }
        return result;
    }

    private async load(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<boolean> {
        if (!betaSqlOwnsDocument(document) || token.isCancellationRequested) {
            return false;
        }
        return this._sessions.getParsedSession(document, token) !== undefined;
    }

    private isCurrent(document: vscode.TextDocument, token: vscode.CancellationToken): boolean {
        return (
            !token.isCancellationRequested &&
            this._sessions.languageServices.documents.get(document.uri.toString())?.version ===
                document.version
        );
    }
}

/** Routes project-wide schema refactors to STS and local query identities to Langium. */
class RoutedSqlRenameProvider implements vscode.RenameProvider {
    public constructor(
        private readonly _local: TsqlVsCodeFeatureProviders,
        private readonly _project: SqlSymbolRenameProvider,
    ) {}

    public async prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Range | { range: vscode.Range; placeholder: string } | undefined> {
        if (!betaSqlOwnsDocument(document)) {
            return this._project.prepareRename(document, position);
        }
        const local = await this._local.prepareRename(document, position, token);
        if (local) {
            return local;
        }
        return (await SqlSymbolRenameProvider.isInSqlProject(document.uri.fsPath))
            ? this._project.prepareRename(document, position)
            : undefined;
    }

    public async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken,
    ): Promise<vscode.WorkspaceEdit | null | undefined> {
        if (!betaSqlOwnsDocument(document)) {
            return this._project.provideRenameEdits(document, position, newName, token);
        }
        const local = await this._local.provideRenameEdits(document, position, newName, token);
        if (local) {
            return local;
        }
        return (await SqlSymbolRenameProvider.isInSqlProject(document.uri.fsPath))
            ? this._project.provideRenameEdits(document, position, newName, token)
            : undefined;
    }
}

function asProtocolPosition(position: vscode.Position): { line: number; character: number } {
    return { line: position.line, character: position.character };
}

function asProtocolRange(range: vscode.Range): ProtocolRange {
    return { start: asProtocolPosition(range.start), end: asProtocolPosition(range.end) };
}

function asVsCodeRange(range: ProtocolRange): vscode.Range {
    return new vscode.Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
    );
}

function asVsCodeDocumentSymbol(symbol: ProtocolDocumentSymbol): vscode.DocumentSymbol {
    const result = new vscode.DocumentSymbol(
        symbol.name,
        symbol.detail ?? "",
        symbol.kind as vscode.SymbolKind,
        asVsCodeRange(symbol.range),
        asVsCodeRange(symbol.selectionRange),
    );
    result.children = symbol.children?.map(asVsCodeDocumentSymbol) ?? [];
    return result;
}

function asVsCodeSelectionRange(range: ProtocolSelectionRange): vscode.SelectionRange {
    return new vscode.SelectionRange(
        asVsCodeRange(range.range),
        range.parent ? asVsCodeSelectionRange(range.parent) : undefined,
    );
}

function emptySemanticTokens(): vscode.SemanticTokens {
    return new vscode.SemanticTokens(new Uint32Array());
}
