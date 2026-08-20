/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    defaultMetadataRuntimeOptions,
    type ColorizationService,
    type CompletionItem as ServiceCompletionItem,
    type CompletionResult,
    type FullColorizationResult,
    type MetadataProvider,
    type MetadataRuntimeOptions,
    type ObjectDefinitionDescriptor,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import { definitionScheme } from "./previewLanguageServiceConstants";
import type { PreviewDocumentState, ResolvedDefinitionTarget } from "./previewLanguageServiceState";
import { toVscodeFoldingRanges } from "./previewFoldingRanges";
import {
    applyColorizationEdits,
    documentLineSource,
    encodeSemanticTokens,
    encodeSemanticTokensEdits,
} from "./previewSemanticTokens";

export class PreviewCompletionProvider implements vscode.CompletionItemProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        private readonly _metadataOptions: MetadataRuntimeOptions = defaultMetadataRuntimeOptions,
    ) {}

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.CompletionList | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            let result = state.features.completion(
                state.connectionUri,
                document.version,
                document.offsetAt(position),
            );
            if (result.incomplete && state.metadata.waitForHydration) {
                await waitForInteractiveHydration(
                    state.metadata,
                    token,
                    completionHydrationTimeoutMs(result, this._metadataOptions),
                );
                // Hydration publishes a new immutable catalog generation. The document snapshot
                // must be rebound to that generation before completion is retried; otherwise the
                // retry correctly sees the old pinned view and can never return the hydrated item.
                // The metadata change listener owns/coalesces that rebind on the document queue.
                await state.queue;
                if (
                    token.isCancellationRequested ||
                    state.disposed ||
                    document.version !== state.syncedVersion
                ) {
                    return undefined;
                }
                result = state.features.completion(
                    state.connectionUri,
                    document.version,
                    document.offsetAt(position),
                );
            }
            return new vscode.CompletionList(
                result.items.map((item) => toVscodeCompletionItem(document, item)),
                result.incomplete,
            );
        } catch {
            return undefined;
        }
    }
}

export function completionHydrationTimeoutMs(
    result: Pick<CompletionResult, "items">,
    options: Pick<
        MetadataRuntimeOptions,
        "interactiveLatencyBudgetMs" | "emptyCompletionLatencyBudgetMs"
    > = defaultMetadataRuntimeOptions,
): number {
    return result.items.length === 0
        ? options.emptyCompletionLatencyBudgetMs
        : options.interactiveLatencyBudgetMs;
}

async function waitForInteractiveHydration(
    metadata: MetadataProvider,
    token: vscode.CancellationToken,
    timeoutMs: number,
): Promise<void> {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            metadata.waitForHydration!(controller.signal).catch(() => undefined),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        cancellation.dispose();
        controller.abort();
    }
}

export class PreviewHoverProvider implements vscode.HoverProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            const result = state.features.hover(
                state.connectionUri,
                document.version,
                document.offsetAt(position),
            );
            return result
                ? new vscode.Hover(
                      new vscode.MarkdownString(result.markdown),
                      result.range &&
                          new vscode.Range(
                              document.positionAt(result.range.start),
                              document.positionAt(result.range.end),
                          ),
                  )
                : undefined;
        } catch {
            return undefined;
        }
    }
}

export class PreviewSignatureHelpProvider implements vscode.SignatureHelpProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.SignatureHelp | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        const requestedVersion = document.version;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            requestedVersion !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            const offset = document.offsetAt(position);
            let result = state.features.signatureHelp(
                state.connectionUri,
                requestedVersion,
                offset,
            );
            if (!result && state.metadata.waitForHydration) {
                await waitForInteractiveHydration(state.metadata, token, 1_000);
                if (
                    token.isCancellationRequested ||
                    state.disposed ||
                    document.version !== requestedVersion ||
                    state.syncedVersion !== requestedVersion
                ) {
                    return undefined;
                }
                result = state.features.signatureHelp(
                    state.connectionUri,
                    requestedVersion,
                    offset,
                );
            }
            if (!result) return undefined;
            const help = new vscode.SignatureHelp();
            help.signatures = result.signatures.map((candidate) => {
                const information = new vscode.SignatureInformation(
                    candidate.label,
                    candidate.documentation
                        ? new vscode.MarkdownString(candidate.documentation)
                        : undefined,
                );
                information.parameters = candidate.parameters.map(
                    (parameter) =>
                        new vscode.ParameterInformation(
                            parameter.label,
                            parameter.documentation
                                ? new vscode.MarkdownString(parameter.documentation)
                                : undefined,
                        ),
                );
                return information;
            });
            help.activeSignature = result.activeSignature;
            help.activeParameter = result.activeParameter;
            return help;
        } catch {
            return undefined;
        }
    }
}

/**
 * Publishes the collapsible regions the language service derives from the parse tree. Registering a
 * folding provider replaces the editor indentation fallback, so this also carries the `#region`
 * markers the SQL language configuration declares.
 */
export class PreviewFoldingRangeProvider implements vscode.FoldingRangeProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.FoldingRange[] | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            return toVscodeFoldingRanges(
                state.features.foldingRanges(state.connectionUri, document.version, {
                    limit: foldingRangeLimit(document),
                }),
                documentLineSource(document),
            );
        } catch {
            return undefined;
        }
    }
}

/**
 * The editor stops folding once a document exceeds this many regions and drops the excess in
 * document order, which would leave the end of a long script unfoldable. Passing the limit to the
 * language service lets it spend the budget on the widest regions instead.
 */
function foldingRangeLimit(document: vscode.TextDocument): number {
    const configured = vscode.workspace
        .getConfiguration("editor", document)
        .get<number>("foldingMaximumRegions");
    return typeof configured === "number" && configured > 0 ? configured : 5000;
}

/**
 * Publishes the language service classifications as VS Code semantic tokens. Every request reads
 * the snapshot the runtime already produced, so coloring never parses and never waits on metadata.
 */
export class PreviewSemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider, vscode.DocumentRangeSemanticTokensProvider
{
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        private readonly _coloring: ColorizationService,
        public readonly onDidChangeSemanticTokens: vscode.Event<void>,
    ) {}

    public async provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | undefined> {
        const state = await this.readySnapshot(document, token);
        if (!state) return undefined;
        try {
            const result = this._coloring.provideDocumentColors(
                state.runtime.snapshot(state.connectionUri, document.version),
            );
            return this.publish(state, document, result);
        } catch {
            return undefined;
        }
    }

    public async provideDocumentSemanticTokensEdits(
        document: vscode.TextDocument,
        previousResultId: string,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | vscode.SemanticTokensEdits | undefined> {
        const state = await this.readySnapshot(document, token);
        if (!state) return undefined;
        const cached = state.semanticTokens;
        if (!cached || cached.result.resultId !== previousResultId) {
            return this.provideDocumentSemanticTokens(document, token);
        }
        try {
            const snapshot = state.runtime.snapshot(state.connectionUri, document.version);
            const delta = this._coloring.provideColorEdits(cached.result, snapshot, []);
            if (delta.kind !== "delta") return this.publish(state, document, delta);
            if (delta.edits.length === 0) {
                state.semanticTokens = {
                    result: { ...cached.result, resultId: delta.resultId },
                    data: cached.data,
                };
                return new vscode.SemanticTokensEdits([], delta.resultId);
            }
            const tokens = applyColorizationEdits(cached.result.tokens, delta.edits);
            const data = encodeSemanticTokens(tokens, documentLineSource(document));
            state.semanticTokens = {
                result: {
                    kind: "full",
                    resultId: delta.resultId,
                    documentVersion: delta.documentVersion,
                    metadataGeneration: delta.metadataGeneration,
                    tokens,
                },
                data,
            };
            return new vscode.SemanticTokensEdits(
                encodeSemanticTokensEdits(cached.data, data),
                delta.resultId,
            );
        } catch {
            return undefined;
        }
    }

    public async provideDocumentRangeSemanticTokens(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | undefined> {
        const state = await this.readySnapshot(document, token);
        if (!state) return undefined;
        try {
            const snapshot = state.runtime.snapshot(state.connectionUri, document.version);
            const result = this._coloring.provideRangeColors({
                ...snapshot,
                range: {
                    start: document.offsetAt(range.start),
                    end: document.offsetAt(range.end),
                },
            });
            // A range result is a viewport view, never the baseline a later delta is built from.
            return new vscode.SemanticTokens(
                encodeSemanticTokens(result.tokens, documentLineSource(document)),
            );
        } catch {
            return undefined;
        }
    }

    private publish(
        state: PreviewDocumentState,
        document: vscode.TextDocument,
        result: FullColorizationResult,
    ): vscode.SemanticTokens {
        const data = encodeSemanticTokens(result.tokens, documentLineSource(document));
        state.semanticTokens = { result, data };
        return new vscode.SemanticTokens(data, result.resultId);
    }

    private async readySnapshot(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<PreviewDocumentState | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        return state;
    }
}

/**
 * Navigates to a name. A declaration in the same document resolves from the published snapshot; a
 * catalog object is fetched by the host, because reading a definition is I/O the language service
 * never performs.
 */
export class PreviewDefinitionProvider implements vscode.DefinitionProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        private readonly _resolve: (
            descriptor: ObjectDefinitionDescriptor,
            state: PreviewDocumentState,
            signal: AbortSignal,
        ) => Promise<ResolvedDefinitionTarget | undefined>,
    ) {}

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.LocationLink[] | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }

        let target;
        try {
            target = state.features.definitionTarget(
                state.connectionUri,
                document.version,
                document.offsetAt(position),
            );
        } catch {
            return undefined;
        }
        const origin =
            target.originRange &&
            new vscode.Range(
                document.positionAt(target.originRange.start),
                document.positionAt(target.originRange.end),
            );
        if (target.locations.length > 0) {
            // A link reports the name that was navigated from and selects the declared name at the
            // other end, so the editor highlights both rather than a whole line.
            return target.locations.map((location) => {
                const range = new vscode.Range(
                    document.positionAt(location.range.start),
                    document.positionAt(location.range.end),
                );
                return {
                    originSelectionRange: origin,
                    targetUri: document.uri,
                    targetRange: range,
                    targetSelectionRange: range,
                };
            });
        }
        if (!target.object) return undefined;

        const requestedVersion = document.version;
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
            const resolved = await this._resolve(target.object, state, controller.signal);
            if (
                !resolved ||
                token.isCancellationRequested ||
                state.disposed ||
                document.version !== requestedVersion ||
                state.syncedVersion !== requestedVersion
            ) {
                return undefined;
            }
            return [
                {
                    originSelectionRange: origin,
                    targetUri: resolved.uri,
                    targetRange: resolved.targetRange,
                    targetSelectionRange: resolved.targetSelectionRange,
                },
            ];
        } catch {
            // A dropped object, a denied permission, or a dead connection is not an error the
            // editor should report; navigation simply finds nothing.
            return undefined;
        } finally {
            cancellation.dispose();
            controller.abort();
        }
    }
}

export class PreviewDefinitionDocumentProvider implements vscode.TextDocumentContentProvider {
    public constructor(
        private readonly _content: (uri: vscode.Uri) => string | undefined,
        public readonly onDidChange: vscode.Event<vscode.Uri>,
    ) {}

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this._content(uri) ?? "";
    }
}

/** A URI per catalog generation and object, ending in `.sql` so the editor colors what it opens. */
export function definitionUri(
    connectionUri: string,
    descriptor: ObjectDefinitionDescriptor,
    metadataGeneration?: number,
): vscode.Uri {
    const name = [descriptor.schema, descriptor.name].join(".").replaceAll(/[\\/?#]/gu, "_");
    return vscode.Uri.from({
        scheme: definitionScheme,
        path: `/${descriptor.database ?? "current"}/${descriptor.kind}/${name}.sql`,
        query: new URLSearchParams({
            connection: connectionUri,
            ...(metadataGeneration === undefined
                ? {}
                : { generation: metadataGeneration.toString() }),
        }).toString(),
    });
}

export function positionOfOffset(text: string, offset: number): vscode.Position {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    const before = text.slice(0, safeOffset);
    const line = before.split("\n").length - 1;
    const lineStart = before.lastIndexOf("\n") + 1;
    return new vscode.Position(line, safeOffset - lineStart);
}

export function toVscodeDiagnostic(
    document: vscode.TextDocument,
    diagnostic: {
        readonly code: string;
        readonly message: string;
        readonly severity: "error" | "warning" | "information" | "hint";
        readonly range: { readonly start: number; readonly end: number };
    },
    source: string,
): vscode.Diagnostic {
    const result = new vscode.Diagnostic(
        new vscode.Range(
            document.positionAt(diagnostic.range.start),
            document.positionAt(diagnostic.range.end),
        ),
        diagnostic.message,
        severity(diagnostic.severity),
    );
    result.code = diagnostic.code;
    result.source = source;
    return result;
}

function severity(value: "error" | "warning" | "information" | "hint"): vscode.DiagnosticSeverity {
    switch (value) {
        case "error":
            return vscode.DiagnosticSeverity.Error;
        case "warning":
            return vscode.DiagnosticSeverity.Warning;
        case "information":
            return vscode.DiagnosticSeverity.Information;
        case "hint":
            return vscode.DiagnosticSeverity.Hint;
    }
}

function toVscodeCompletionItem(
    document: vscode.TextDocument,
    item: ServiceCompletionItem,
): vscode.CompletionItem {
    const result = new vscode.CompletionItem(item.label, completionKind(item.kind));
    result.detail = item.detail;
    result.documentation = item.documentation
        ? new vscode.MarkdownString(item.documentation)
        : undefined;
    result.sortText = item.sortText;
    result.filterText = item.filterText;
    result.insertText = item.edit
        ? item.insertTextFormat === "snippet"
            ? new vscode.SnippetString(item.edit.newText)
            : item.edit.newText
        : item.label;
    result.preselect = item.preselect;
    result.command = item.command;
    if (item.edit) {
        result.range = new vscode.Range(
            document.positionAt(item.edit.start),
            document.positionAt(item.edit.end),
        );
    }
    return result;
}

function completionKind(kind: string): vscode.CompletionItemKind {
    switch (kind) {
        case "database":
            return vscode.CompletionItemKind.Folder;
        case "schema":
            return vscode.CompletionItemKind.Module;
        case "table":
            return vscode.CompletionItemKind.Class;
        case "view":
            return vscode.CompletionItemKind.Interface;
        case "synonym":
            return vscode.CompletionItemKind.Reference;
        case "column":
            return vscode.CompletionItemKind.Field;
        case "procedure":
            return vscode.CompletionItemKind.Method;
        case "function":
        case "scalarFunction":
        case "tableFunction":
            return vscode.CompletionItemKind.Function;
        case "type":
            return vscode.CompletionItemKind.TypeParameter;
        case "parameter":
            return vscode.CompletionItemKind.Variable;
        case "login":
        case "user":
            return vscode.CompletionItemKind.User;
        case "databaseRole":
        case "serverRole":
        case "applicationRole":
            return vscode.CompletionItemKind.Class;
        case "snippet":
            return vscode.CompletionItemKind.Snippet;
        default:
            return vscode.CompletionItemKind.Text;
    }
}

/**
 * The lens sits above line 1 of every SQL file, so it is one glyph rather than a sentence: the
 * timings it used to print were never read at a glance and cost a full line of editor width.
 * The glyph answers only "is the language service healthy"; the numbers move to the tooltip,
 * which costs nothing until a reader hovers.
 */
