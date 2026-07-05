/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryStudioLanguageService (design 05 §9, B8/LS-0): per-document facade
 * owning the language-feature router, the native engine over the catalog
 * metadata provider, and the lazily-connected STS v1 bridge. The controller
 * maps webview RPC requests 1:1 onto the request methods here.
 *
 * Shadow STS v1 connection lifecycle (design §9.3): created lazily on the
 * FIRST bridge-routed request (never for native-only traffic), keyed to the
 * backing document URI so the classic LanguageClient serves it, invalidated
 * on Query Studio database changes (reconnected with the new database on the
 * next bridge request), torn down on dispose. connectionManager's
 * onDidCloseTextDocument disconnect is the safety net when the backing
 * document dies first.
 */

import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import {
    CompletionResult,
    DefinitionLocationResult,
    DiagnosticsResult,
    DocumentSymbolResult,
    FoldingRangeResult,
    HoverResult,
    SignatureHelpResult,
    SqlLanguagePosition,
} from "../sqlLanguage/api";
import { Sts2BridgeEngine } from "../sqlLanguage/host/bridgeEngine";
import { NativeSqlLanguageEngine } from "../sqlLanguage/host/nativeEngine";
import {
    LanguageEnginePreference,
    LanguageFeatureRouter,
    RouterStatusEntry,
} from "../sqlLanguage/host/router";
import {
    CatalogLanguageMetadataProvider,
    MetadataCatalogHandle,
} from "../sqlLanguage/provider/catalogProvider";
import { LanguageReadiness } from "../sqlLanguage/provider/types";
import { DocumentSessionBinding } from "./documentSessionBinding";

export const LANGUAGE_ENGINE_SETTING = "mssql.queryStudio.languageService.engine";

interface ConnectionManagerSeam {
    connect(
        fileUri: string,
        credentials: IConnectionInfo,
        options?: { shouldHandleErrors?: boolean; connectionSource?: string },
    ): Promise<boolean>;
    disconnect(fileUri: string): Promise<boolean>;
}

async function connectionManagerSeam(): Promise<ConnectionManagerSeam | undefined> {
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { connectionManager?: ConnectionManagerSeam }
        | undefined;
    return controller?.connectionManager;
}

export interface QueryStudioLanguageServiceHost {
    backingDocument(): vscode.TextDocument | undefined;
    sessionBinding(): DocumentSessionBinding | undefined;
    /** Cached database names for USE completions; refreshed by the controller. */
    databases(): readonly string[] | undefined;
}

export interface LanguageServiceStatus {
    readonly preference: LanguageEnginePreference;
    readonly router: readonly RouterStatusEntry[];
    readonly readiness: LanguageReadiness;
    readonly metadataGeneration: number;
    readonly shadowConnectionState: "none" | "connected" | "invalidated";
}

export class QueryStudioLanguageService implements vscode.Disposable {
    private readonly nativeEngine: NativeSqlLanguageEngine;
    private readonly provider: CatalogLanguageMetadataProvider;
    private readonly router: LanguageFeatureRouter;
    private bridge: Sts2BridgeEngine | undefined;

    private shadowState: "none" | "connected" | "invalidated" = "none";
    private shadowConnecting: Promise<boolean> | undefined;
    private shadowDatabase: string | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private readonly diagnosticsListeners = new Set<() => void>();

    constructor(private readonly host: QueryStudioLanguageServiceHost) {
        this.provider = new CatalogLanguageMetadataProvider({
            handle: () => this.metadataHandle(),
            serverVersion: () => this.binding()?.connectionState.serverVersion,
            currentDatabase: () => this.binding()?.connectionState.database,
            databases: () => this.host.databases(),
            subscribeStatus: (listener) => {
                const subscription = this.binding()?.onDidChange(listener);
                return () => subscription?.dispose();
            },
        });
        this.nativeEngine = new NativeSqlLanguageEngine(this.provider, () => {
            const config = vscode.workspace.getConfiguration();
            return {
                snippetsEnabled: config.get<boolean>(
                    "mssql.sqlLanguage.completions.snippets",
                    true,
                ),
                keywordCasing:
                    config.get<string>("mssql.sqlLanguage.keywordCasing", "upper") === "lower"
                        ? "lower"
                        : "upper",
            };
        });
        this.router = new LanguageFeatureRouter({
            native: this.nativeEngine,
            getBridge: () => this.ensureBridge(),
            getPreference: () => this.preference(),
        });

        // Database change invalidates the shadow connection target; the next
        // bridge request reconnects against the new database.
        const bindingSub = this.binding()?.onDidChange(() => {
            const database = this.binding()?.connectionState.database;
            if (this.shadowState === "connected" && database !== this.shadowDatabase) {
                this.shadowState = "invalidated";
            }
        });
        if (bindingSub !== undefined) {
            this.disposables.push(bindingSub);
        }

        // Forward STS v1 published diagnostics for the backing URI (push path;
        // the pull path is bridge.diagnostics()).
        this.disposables.push(
            vscode.languages.onDidChangeDiagnostics((e) => {
                const uri = this.host.backingDocument()?.uri.toString();
                if (uri !== undefined && e.uris.some((u) => u.toString() === uri)) {
                    for (const listener of [...this.diagnosticsListeners]) {
                        listener();
                    }
                }
            }),
        );
    }

    private binding(): DocumentSessionBinding | undefined {
        return this.host.sessionBinding();
    }

    private metadataHandle(): MetadataCatalogHandle | undefined {
        const binding = this.binding() as
            | (DocumentSessionBinding & {
                  metadataHandleForConsumers?: MetadataCatalogHandle;
              })
            | undefined;
        return binding?.metadataHandleForConsumers;
    }

    private preference(): LanguageEnginePreference {
        const value = vscode.workspace
            .getConfiguration()
            .get<string>(LANGUAGE_ENGINE_SETTING, "sqlToolsService");
        return value === "nativeTypeScript" ? "nativeTypeScript" : "sqlToolsService";
    }

    /** Circuit breakers reset when the user flips the engine preference. */
    onPreferenceChanged(): void {
        this.router.resetCircuits();
    }

    onDiagnosticsChanged(listener: () => void): vscode.Disposable {
        this.diagnosticsListeners.add(listener);
        return { dispose: () => this.diagnosticsListeners.delete(listener) };
    }

    private ensureBridge(): Sts2BridgeEngine | undefined {
        if (this.bridge === undefined) {
            this.bridge = new Sts2BridgeEngine({
                backingDocument: () => this.host.backingDocument(),
                ensureShadowConnection: () => this.ensureShadowConnection(),
            });
        }
        return this.bridge;
    }

    private async ensureShadowConnection(): Promise<boolean> {
        if (this.shadowState === "connected") {
            return true;
        }
        if (this.shadowConnecting !== undefined) {
            return this.shadowConnecting;
        }
        this.shadowConnecting = this.connectShadow().finally(() => {
            this.shadowConnecting = undefined;
        });
        return this.shadowConnecting;
    }

    private async connectShadow(): Promise<boolean> {
        const document = this.host.backingDocument();
        const profile = this.binding()?.shadowConnectionProfile;
        if (document === undefined || profile === undefined) {
            return false;
        }
        const manager = await connectionManagerSeam();
        if (manager === undefined) {
            return false;
        }
        const database = this.binding()?.connectionState.database;
        const credentials = {
            ...(profile as unknown as IConnectionInfo),
            ...(database !== undefined ? { database } : {}),
        };
        const uri = document.uri.toString();
        if (this.shadowState === "invalidated") {
            await manager.disconnect(uri).catch(() => undefined);
        }
        const ok = await manager
            .connect(uri, credentials, {
                shouldHandleErrors: false,
                connectionSource: "queryStudioLanguageBridge",
            })
            .catch(() => false);
        if (ok) {
            this.shadowState = "connected";
            this.shadowDatabase = database;
        }
        return ok;
    }

    // ---- request surface (controller maps RPC 1:1 onto these) -----------------

    private request(position: SqlLanguagePosition) {
        const document = this.host.backingDocument();
        return {
            text: document?.getText() ?? "",
            version: document?.version ?? 0,
            position,
        };
    }

    completion(
        position: SqlLanguagePosition,
        trigger: "invoke" | "character",
        triggerCharacter?: string,
    ): Promise<CompletionResult | undefined> {
        const req = { ...this.request(position), trigger, triggerCharacter };
        return this.router.route("completion", (e) => e.completion(req));
    }

    hover(position: SqlLanguagePosition): Promise<HoverResult | undefined> {
        return this.router.route("hover", (e) => e.hover(this.request(position)));
    }

    signatureHelp(position: SqlLanguagePosition): Promise<SignatureHelpResult | undefined> {
        return this.router.route("signatureHelp", (e) => e.signatureHelp(this.request(position)));
    }

    definition(position: SqlLanguagePosition): Promise<DefinitionLocationResult | undefined> {
        return this.router.route("definition", (e) => e.definition(this.request(position)));
    }

    diagnostics(): Promise<DiagnosticsResult | undefined> {
        const req = this.request({ line: 0, character: 0 });
        return this.router.route("diagnostics", (e) =>
            e.diagnostics({ text: req.text, version: req.version }),
        );
    }

    folding(): Promise<readonly FoldingRangeResult[] | undefined> {
        const req = this.request({ line: 0, character: 0 });
        return this.router.route("folding", (e) =>
            e.folding({ text: req.text, version: req.version }),
        );
    }

    documentSymbols(): Promise<readonly DocumentSymbolResult[] | undefined> {
        const req = this.request({ line: 0, character: 0 });
        return this.router.route("documentSymbols", (e) =>
            e.documentSymbols({ text: req.text, version: req.version }),
        );
    }

    status(): LanguageServiceStatus {
        return {
            preference: this.preference(),
            router: this.router.status(),
            readiness: this.provider.readiness(),
            metadataGeneration: this.provider.generation,
            shadowConnectionState: this.shadowState,
        };
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.diagnosticsListeners.clear();
        const document = this.host.backingDocument();
        if (this.shadowState !== "none" && document !== undefined) {
            const uri = document.uri.toString();
            void connectionManagerSeam().then((manager) =>
                manager?.disconnect(uri).catch(() => undefined),
            );
        }
        this.shadowState = "none";
    }
}
