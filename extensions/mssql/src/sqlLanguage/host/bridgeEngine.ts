/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * STS v1 bridge engine (design 05 §9.3, option 1: provider-command
 * aggregation). The Query Studio backing document is a real TextDocument with
 * languageId "sql", so the classic STS v1 LanguageClient serves it once the
 * shadow connection exists; vscode.execute*Provider commands aggregate the
 * registered providers for that URI. Recorded risk (worksheet #1): the
 * aggregation may include non-STS providers — move to a direct client adapter
 * if that pollutes parity.
 *
 * The shadow connection itself is owned by the Query Studio facade (lazy
 * create / retarget / teardown); the bridge only asks for it via the host
 * callback before language calls, and reports bridge spans
 * (queryStudio.languageService.bridge — feature/duration only, never text).
 */

import * as vscode from "vscode";
import { diag } from "../../diagnostics/diagnosticsCore";
import {
    CompletionRequest,
    CompletionResult,
    DefinitionLocationResult,
    DiagnosticsRequest,
    DiagnosticsResult,
    DocumentSymbolResult,
    FoldingRangeResult,
    HighlightResult,
    HoverResult,
    SemanticTokensResult,
    SignatureHelpResult,
    SqlCompletionItem,
    SqlCompletionItemKind,
    SqlDiagnostic,
    SqlLanguageFeatureEngine,
    SqlLanguageRequest,
} from "../api";

export interface BridgeEngineHost {
    /** The live backing document, undefined once disposed. */
    backingDocument(): vscode.TextDocument | undefined;
    /**
     * Ensure the shadow STS v1 connection exists for the backing URI
     * (lazy — design §9.3). Resolves false when unavailable (no profile,
     * connect failed); the bridge then serves connection-free results
     * (keyword completions still work through the STS v1 client).
     */
    ensureShadowConnection(): Promise<boolean>;
    /**
     * Connect a definition-target document this engine opened to the SOURCE
     * editor's connection context (shadow profile + current database) — the
     * new editor must never inherit an unrelated ambient profile.
     */
    adoptDefinitionDocument?(uri: vscode.Uri): Promise<boolean>;
}

export class Sts2BridgeEngine implements SqlLanguageFeatureEngine {
    readonly engineId = "sqlToolsServiceBridge" as const;

    constructor(private readonly host: BridgeEngineHost) {}

    private async bridged<T>(
        feature: string,
        run: (uri: vscode.Uri) => Promise<T | undefined>,
    ): Promise<T | undefined> {
        const document = this.host.backingDocument();
        if (document === undefined) {
            return undefined;
        }
        const span = diag.startSpan({
            feature: "queryStudio",
            kind: "span",
            type: "queryStudio.languageService.bridge",
            fields: { languageFeature: { raw: feature, cls: "diagnostic.metadata" } },
        });
        try {
            const connected = await this.host.ensureShadowConnection();
            const result = await run(document.uri);
            span.end("ok", {
                connected: { raw: connected, cls: "diagnostic.metadata" },
                returned: { raw: result !== undefined, cls: "diagnostic.metadata" },
            });
            return result;
        } catch (error) {
            span.fail(error);
            return undefined;
        }
    }

    async completion(req: CompletionRequest): Promise<CompletionResult | undefined> {
        return this.bridged("completion", async (uri) => {
            const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                uri,
                new vscode.Position(req.position.line, req.position.character),
                req.triggerCharacter,
            );
            if (list === undefined || list.items.length === 0) {
                return { items: [], isIncomplete: false };
            }
            return {
                items: list.items.slice(0, 500).map(mapCompletionItem),
                isIncomplete: list.isIncomplete === true,
            };
        });
    }

    async hover(req: SqlLanguageRequest): Promise<HoverResult | undefined> {
        return this.bridged("hover", async (uri) => {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                "vscode.executeHoverProvider",
                uri,
                new vscode.Position(req.position.line, req.position.character),
            );
            if (hovers === undefined || hovers.length === 0) {
                return undefined;
            }
            const first = hovers[0];
            const contents = first.contents
                .map((c) => (typeof c === "string" ? c : c.value))
                .filter((c) => c.length > 0)
                .join("\n\n");
            if (contents.length === 0) {
                return undefined;
            }
            return {
                contentsMarkdown: contents,
                range: first.range !== undefined ? mapRange(first.range) : undefined,
            };
        });
    }

    async signatureHelp(req: SqlLanguageRequest): Promise<SignatureHelpResult | undefined> {
        return this.bridged("signatureHelp", async (uri) => {
            const help = await vscode.commands.executeCommand<vscode.SignatureHelp>(
                "vscode.executeSignatureHelpProvider",
                uri,
                new vscode.Position(req.position.line, req.position.character),
            );
            if (help === undefined || help.signatures.length === 0) {
                return undefined;
            }
            return {
                activeSignature: help.activeSignature,
                activeParameter: help.activeParameter,
                signatures: help.signatures.map((s) => ({
                    label: s.label,
                    documentation: markdownToString(s.documentation),
                    parameters: s.parameters.map((p) => ({
                        label:
                            typeof p.label === "string"
                                ? p.label
                                : s.label.slice(p.label[0], p.label[1]),
                        documentation: markdownToString(p.documentation),
                    })),
                })),
            };
        });
    }

    async definition(req: SqlLanguageRequest): Promise<DefinitionLocationResult | undefined> {
        return this.bridged("definition", async (uri) => {
            const locations = await vscode.commands.executeCommand<
                (vscode.Location | vscode.LocationLink)[]
            >(
                "vscode.executeDefinitionProvider",
                uri,
                new vscode.Position(req.position.line, req.position.character),
            );
            if (locations === undefined || locations.length === 0) {
                return undefined;
            }
            const first = locations[0];
            const targetUri = "targetUri" in first ? first.targetUri : first.uri;
            const targetRange = "targetRange" in first ? first.targetRange : first.range;
            if (targetUri.toString() === uri.toString()) {
                return { range: mapRange(targetRange) };
            }
            // Cross-file target (old-engine temp/virtual docs): open beside,
            // accepted as old behavior until LS-4 replaces definition.
            const doc = await vscode.workspace.openTextDocument(targetUri);
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                selection: targetRange,
                preview: true,
            });
            await this.host.adoptDefinitionDocument?.(doc.uri);
            return {};
        });
    }

    async diagnostics(_req: DiagnosticsRequest): Promise<DiagnosticsResult | undefined> {
        const document = this.host.backingDocument();
        if (document === undefined) {
            return undefined;
        }
        // Pull model: the LanguageClient publishes into the "mssql" collection
        // for the backing URI; the facade additionally forwards change events.
        const diagnostics = vscode.languages
            .getDiagnostics(document.uri)
            .filter((d) => d.source === "mssql" || d.source === undefined)
            .map(mapDiagnostic);
        return { diagnostics };
    }

    folding(_req: DiagnosticsRequest): Promise<readonly FoldingRangeResult[] | undefined> {
        return Promise.resolve(undefined); // native-only feature
    }
    documentSymbols(
        _req: DiagnosticsRequest,
    ): Promise<readonly DocumentSymbolResult[] | undefined> {
        return Promise.resolve(undefined); // native-only feature
    }
    highlights(_req: SqlLanguageRequest): Promise<readonly HighlightResult[] | undefined> {
        return Promise.resolve(undefined);
    }
    semanticTokens(_req: DiagnosticsRequest): Promise<SemanticTokensResult | undefined> {
        return Promise.resolve(undefined);
    }
}

function markdownToString(value: string | vscode.MarkdownString | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return typeof value === "string" ? value : value.value;
}

function mapRange(range: vscode.Range): {
    start: { line: number; character: number };
    end: { line: number; character: number };
} {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}

const COMPLETION_KIND_MAP: Partial<Record<vscode.CompletionItemKind, SqlCompletionItemKind>> = {
    [vscode.CompletionItemKind.Keyword]: "keyword",
    [vscode.CompletionItemKind.Class]: "table",
    [vscode.CompletionItemKind.Interface]: "view",
    [vscode.CompletionItemKind.Field]: "column",
    [vscode.CompletionItemKind.Property]: "column",
    [vscode.CompletionItemKind.Module]: "schema",
    [vscode.CompletionItemKind.Method]: "procedure",
    [vscode.CompletionItemKind.Function]: "function",
    [vscode.CompletionItemKind.Variable]: "variable",
    [vscode.CompletionItemKind.Snippet]: "snippet",
    [vscode.CompletionItemKind.File]: "database",
};

function mapCompletionItem(item: vscode.CompletionItem): SqlCompletionItem {
    const label = typeof item.label === "string" ? item.label : item.label.label;
    const insert =
        item.insertText === undefined
            ? label
            : typeof item.insertText === "string"
              ? item.insertText
              : item.insertText.value;
    return {
        label,
        kind: (item.kind !== undefined ? COMPLETION_KIND_MAP[item.kind] : undefined) ?? "keyword",
        insertText: insert,
        isSnippet: typeof item.insertText === "object" || undefined,
        detail: item.detail,
        documentation: markdownToString(item.documentation),
        sortText: item.sortText,
        filterText: item.filterText,
    };
}

function mapDiagnostic(d: vscode.Diagnostic): SqlDiagnostic {
    const severity =
        d.severity === vscode.DiagnosticSeverity.Error
            ? "error"
            : d.severity === vscode.DiagnosticSeverity.Warning
              ? "warning"
              : d.severity === vscode.DiagnosticSeverity.Information
                ? "information"
                : "hint";
    return {
        range: mapRange(d.range),
        severity,
        message: d.message,
        code:
            typeof d.code === "object" && d.code !== null
                ? String(d.code.value)
                : d.code !== undefined
                  ? String(d.code)
                  : undefined,
        source: d.source ?? "mssql",
    };
}
