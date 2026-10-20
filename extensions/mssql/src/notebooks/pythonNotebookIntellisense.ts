/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ResponseError } from "vscode-languageclient";
import type ConnectionManager from "../controllers/connectionManager";
import SqlToolsServiceClient, { EmbeddedSqlDocument } from "../languageservice/serviceclient";
import { pythonNotebookSqlUriScheme, pythonNotebookMetadataKey } from "../constants/constants";
import { PythonNotebooks as Loc } from "../constants/locConstants";
import { DisconnectRequest } from "../models/contracts/connection";
import type { ILogger } from "../sharedInterfaces/logger";
import {
    PythonNotebookConnectionReference,
    PythonNotebookCredentialsProvider,
    PythonNotebookError,
} from "./pythonNotebookCredentials";
import { connectNotebookIntellisense } from "./notebookIntellisenseConnection";
import {
    projectPythonNotebookSql,
    PythonNotebookSqlProjection,
} from "./pythonNotebookSqlProjection";

interface Projection {
    readonly uri: vscode.Uri;
    readonly document: vscode.TextDocument;
    readonly cancellation: vscode.CancellationTokenSource;
    ready?: Promise<EmbeddedSqlDocument>;
    remote?: EmbeddedSqlDocument;
    tokenProvider?: vscode.Disposable;
    disposed: boolean;
    requests: Promise<void>;
}

interface Authorization {
    document: vscode.NotebookDocument;
    readonly provider: PythonNotebookCredentialsProvider;
    readonly reference: PythonNotebookConnectionReference;
    readonly database: string;
    readonly projections: Map<vscode.TextDocument, Projection>;
    warned: boolean;
}

interface RequestContext {
    auth: Authorization;
    entry: Projection;
    source: PythonNotebookSqlProjection;
    document: vscode.TextDocument;
    version: number;
    token: vscode.CancellationToken;
}

export class PythonNotebookIntellisense
    implements
        vscode.Disposable,
        vscode.CompletionItemProvider,
        vscode.HoverProvider,
        vscode.SignatureHelpProvider
{
    private readonly authorizations = new Set<Authorization>();
    private readonly disposables: vscode.Disposable[];
    private readonly completions = new WeakMap<vscode.CompletionItem, RequestContext>();

    constructor(
        private readonly manager: ConnectionManager,
        private readonly log: ILogger,
        private readonly allowed: () => boolean,
        private readonly client = SqlToolsServiceClient.instance,
    ) {
        const selector: vscode.DocumentSelector = {
            language: "python",
            notebookType: "jupyter-notebook",
        };
        this.disposables = [
            vscode.languages.registerCompletionItemProvider(selector, this, "."),
            vscode.languages.registerHoverProvider(selector, this),
            vscode.languages.registerSignatureHelpProvider(selector, this, "(", ","),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (!this.allowed()) return;
                const owners = [...this.authorizations].filter((auth) =>
                    auth.projections.has(event.document),
                );
                if (!owners.length) return;
                if (!projectPythonNotebookSql(event.document.getText())) {
                    for (const auth of owners) this.removeProjection(auth, event.document);
                }
            }),
            vscode.workspace.onDidChangeNotebookDocument(() => this.prune()),
        ];
    }

    public authorize(
        document: vscode.NotebookDocument,
        provider: PythonNotebookCredentialsProvider,
        reference: PythonNotebookConnectionReference,
        database: string,
    ): vscode.Disposable {
        const auth: Authorization = {
            document,
            provider,
            reference: { ...reference },
            database,
            projections: new Map(),
            warned: false,
        };
        this.authorizations.add(auth);
        this.log.trace("Python notebook IntelliSense authorized.");
        return new vscode.Disposable(() => this.revoke(auth));
    }

    public adopt(previous: vscode.NotebookDocument, next: vscode.NotebookDocument): void {
        for (const auth of this.authorizations) {
            if (auth.document !== previous) continue;
            for (const document of auth.projections.keys()) this.removeProjection(auth, document);
            auth.document = next;
        }
    }

    public suspend(document: vscode.NotebookDocument): void {
        for (const auth of this.authorizations) {
            if (auth.document !== document) continue;
            for (const cell of auth.projections.keys()) this.removeProjection(auth, cell);
        }
    }

    private current(auth: Authorization): boolean {
        if (!this.allowed() || !this.authorizations.has(auth) || auth.document.isClosed)
            return false;
        const metadata = auth.document.metadata;
        const reference =
            metadata?.metadata?.[pythonNotebookMetadataKey] ??
            metadata?.custom?.metadata?.[pythonNotebookMetadataKey] ??
            metadata?.[pythonNotebookMetadataKey];
        return (
            reference?.version === 1 &&
            reference?.connectionId === auth.reference.connectionId &&
            reference?.database === auth.reference.database
        );
    }

    private valid(request: RequestContext): boolean {
        return (
            this.current(request.auth) &&
            !request.entry.disposed &&
            !request.token.isCancellationRequested &&
            request.document.version === request.version &&
            request.auth.document.getCells().some((cell) => cell.document === request.document)
        );
    }

    private prune(): void {
        for (const auth of this.authorizations) {
            if (!this.current(auth)) {
                if (!auth.document.isClosed) this.revoke(auth);
                continue;
            }
            const documents = new Set(auth.document.getCells().map((cell) => cell.document));
            for (const document of auth.projections.keys()) {
                if (!documents.has(document)) this.removeProjection(auth, document);
            }
        }
    }

    private removeProjection(auth: Authorization, document: vscode.TextDocument): void {
        const entry = auth.projections.get(document);
        if (!entry) return;
        auth.projections.delete(document);
        entry.disposed = true;
        entry.cancellation.cancel();
        entry.cancellation.dispose();
        entry.tokenProvider?.dispose();
        entry.remote?.dispose();
        void this.manager
            .sendRequest(DisconnectRequest.type, { ownerUri: entry.uri.toString() })
            .catch(() => this.log.warn("Python notebook IntelliSense connection cleanup failed."));
    }

    private revoke(auth: Authorization): void {
        this.authorizations.delete(auth);
        for (const document of auth.projections.keys()) this.removeProjection(auth, document);
    }

    private async open(
        auth: Authorization,
        entry: Projection,
        source: PythonNotebookSqlProjection,
        version: number,
    ): Promise<EmbeddedSqlDocument> {
        const info = await auth.provider.getLanguageServiceConnectionInfo(
            auth.reference,
            auth.database,
        );
        if (!this.current(auth) || entry.disposed) throw new vscode.CancellationError();
        if (info.accountId && info.tenantId) {
            entry.tokenProvider = this.manager.registerNotebookTokenProvider(
                entry.uri.toString(),
                info.accountId,
                info.tenantId,
                async () => {
                    if (!this.current(auth) || entry.disposed) throw new vscode.CancellationError();
                    const token = await auth.provider.getSqlToken(auth.reference);
                    if (!this.current(auth) || entry.disposed) throw new vscode.CancellationError();
                    return token;
                },
            );
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let readinessListener: vscode.Disposable | undefined;
        let cancellationListener: vscode.Disposable | undefined;
        const ready = new Promise<void>((resolve, reject) => {
            readinessListener = this.manager.onIntellisenseReady((ownerUri) => {
                if (ownerUri === entry.uri.toString()) resolve();
            });
            cancellationListener = entry.cancellation.token.onCancellationRequested(() =>
                reject(new vscode.CancellationError()),
            );
            timer = setTimeout(
                () => reject(new Error("Notebook catalog metadata did not become ready.")),
                30000,
            );
        });
        try {
            const opened = this.client
                .openEmbeddedSqlDocument(entry.uri, source.text, version)
                .then(async (remote) => {
                    entry.remote = remote;
                    if (!this.current(auth) || entry.disposed) {
                        remote.dispose();
                        throw new vscode.CancellationError();
                    }
                    const connected = await connectNotebookIntellisense(
                        this.manager,
                        entry.uri.toString(),
                        this.manager.createConnectionDetails(info),
                        entry.cancellation.token,
                    );
                    if (!this.current(auth) || entry.disposed) throw new vscode.CancellationError();
                    if (
                        !connected?.connectionId ||
                        connected.connectionSummary?.databaseName !== auth.database
                    ) {
                        throw new Error(
                            "Python notebook IntelliSense database connection was not confirmed.",
                        );
                    }
                    return remote;
                });
            const [remote] = await Promise.all([opened, ready]);
            this.log.trace("Python notebook IntelliSense metadata connection confirmed.");
            return remote;
        } finally {
            if (timer) clearTimeout(timer);
            readinessListener?.dispose();
            cancellationListener?.dispose();
        }
    }

    private async run<T>(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        action: (remote: EmbeddedSqlDocument, request: RequestContext) => Promise<T>,
    ): Promise<T | undefined> {
        if (token.isCancellationRequested || !this.allowed()) return undefined;
        const auth = [...this.authorizations].find(
            (candidate) =>
                this.current(candidate) &&
                candidate.document.getCells().some((cell) => cell.document === document),
        );
        const source = projectPythonNotebookSql(document.getText());
        if (!auth || !source || position.line < source.bodyStartLine) return undefined;
        let entry = auth.projections.get(document);
        if (entry?.remote?.isClosed) {
            this.removeProjection(auth, document);
            entry = undefined;
        }
        if (!entry) {
            entry = {
                uri: vscode.Uri.from({
                    scheme: pythonNotebookSqlUriScheme,
                    path: `/${randomUUID()}.sql`,
                }),
                document,
                cancellation: new vscode.CancellationTokenSource(),
                disposed: false,
                requests: Promise.resolve(),
            };
            auth.projections.set(document, entry);
        }
        const cancellation = new vscode.CancellationTokenSource();
        const listeners = [
            token.onCancellationRequested(() => cancellation.cancel()),
            entry.cancellation.token.onCancellationRequested(() => cancellation.cancel()),
        ];
        const request: RequestContext = {
            auth,
            entry,
            source,
            document,
            version: document.version,
            token: cancellation.token,
        };
        try {
            await auth.provider.validate(auth.reference);
            if (!this.valid(request)) return undefined;
            entry.ready ??= this.open(auth, entry, source, request.version);
            const remote = await entry.ready;
            if (!this.valid(request)) return undefined;
            // Keep each request's SQL text stable while STS processes it.
            const pending = entry.requests.then(async () => {
                if (!this.valid(request)) return undefined;
                await remote.update(source.text, request.version);
                if (!this.valid(request)) return undefined;
                return action(remote, request);
            });
            entry.requests = pending.then(
                () => undefined,
                () => undefined,
            );
            const result = await pending;
            await auth.provider.validate(auth.reference);
            this.log.trace("Python notebook IntelliSense response validity.", {
                accepted: this.valid(request),
                cancelled: request.token.isCancellationRequested,
                versionMatches: document.version === request.version,
            });
            return this.valid(request) ? result : undefined;
        } catch (error) {
            if (
                token.isCancellationRequested ||
                entry.disposed ||
                auth.projections.get(document) !== entry
            )
                return undefined;
            const cancelled =
                token.isCancellationRequested ||
                entry.disposed ||
                entry.cancellation.token.isCancellationRequested;
            this.removeProjection(auth, document);
            if (error instanceof PythonNotebookError) this.revoke(auth);
            if (!(error instanceof vscode.CancellationError) && !cancelled) {
                this.log.warn("Python notebook IntelliSense request failed.", {
                    failure:
                        error instanceof ResponseError
                            ? "languageService"
                            : error instanceof TypeError
                              ? "conversion"
                              : "other",
                    code: error instanceof ResponseError ? error.code : undefined,
                });
                if (!auth.warned) {
                    auth.warned = true;
                    void vscode.window.showWarningMessage(Loc.intellisenseUnavailable);
                }
            }
            return undefined;
        } finally {
            listeners.forEach((listener) => listener.dispose());
            cancellation.dispose();
        }
    }

    private safeRange(range: vscode.Range, request: RequestContext): boolean {
        return (
            range.start.line >= request.source.bodyStartLine &&
            range.end.line < request.document.lineCount &&
            range.end.character <= request.document.lineAt(range.end.line).text.length &&
            range.start.character <= request.document.lineAt(range.start.line).text.length
        );
    }

    private safeItem(item: vscode.CompletionItem, request: RequestContext): boolean {
        const range = item.range;
        if (
            range &&
            !(range instanceof vscode.Range
                ? this.safeRange(range, request)
                : this.safeRange(range.inserting, request) &&
                  this.safeRange(range.replacing, request))
        )
            return false;
        if (item.additionalTextEdits?.some((edit) => !this.safeRange(edit.range, request)))
            return false;
        if (item.command && item.command.command !== "editor.action.triggerParameterHints") {
            this.log.warn(
                "Python notebook IntelliSense discarded an unsupported completion command.",
            );
            return false;
        }
        return true;
    }

    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext,
    ): Promise<vscode.CompletionList | undefined> {
        return this.run(document, position, token, async (remote, request) => {
            const result = await remote.completion(position, context, request.token);
            const list = Array.isArray(result) ? new vscode.CompletionList(result) : result;
            const items = (list?.items ?? []).filter((item) => this.safeItem(item, request));
            this.log.trace("Python notebook IntelliSense completion result.", {
                count: items.length,
                character: position.character,
                version: request.version,
            });
            for (const item of items) {
                const label = typeof item.label === "string" ? item.label : item.label.label;
                const sortText = item.sortText ?? label;
                // Prefer SQL catalog entries over the Python kernel's competing suggestions.
                if (!sortText.startsWith("\0")) item.sortText = "\0" + sortText;
                this.completions.set(item, request);
            }
            return new vscode.CompletionList(items, list?.isIncomplete);
        });
    }

    public async resolveCompletionItem(
        item: vscode.CompletionItem,
        token: vscode.CancellationToken,
    ): Promise<vscode.CompletionItem | undefined> {
        const previous = this.completions.get(item);
        if (!previous || !this.valid({ ...previous, token })) return undefined;
        return this.run(
            previous.document,
            new vscode.Position(previous.source.bodyStartLine, 0),
            token,
            async (remote, request) => {
                const resolved = await remote.resolveCompletion(item, request.token);
                return this.safeItem(resolved, request) ? resolved : undefined;
            },
        );
    }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        return this.run(document, position, token, async (remote, request) => {
            const hover = await remote.hover(position, request.token);
            return !hover?.range || this.safeRange(hover.range, request) ? hover : undefined;
        });
    }

    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext,
    ): Promise<vscode.SignatureHelp | undefined> {
        return this.run(document, position, token, (remote, request) =>
            remote.signatureHelp(position, context, request.token),
        );
    }

    public dispose(): void {
        for (const auth of this.authorizations) this.revoke(auth);
        this.disposables.forEach((item) => item.dispose());
    }
}
