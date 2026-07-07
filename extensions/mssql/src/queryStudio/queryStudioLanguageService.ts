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
 *
 * Diagnostics (B10/LS-2): when the router serves diagnostics natively, a
 * per-document sliced scheduler (300ms debounce, stale-version cancel) runs
 * whole-document passes and pushes through the diagnosticsChanged listeners;
 * bridge push-forwarding is gated off the native route (mutual exclusion).
 * mssql.sqlLanguage.diagnostics.enabled=false makes the native engine
 * publish nothing (markers clear); the bridge path is unaffected.
 *
 * Diagnostics freshness (CACHE-5, cache/drift addendum §7.3): before every
 * native pass this facade — the owner of the document→lease binding —
 * resolves ensureFresh(MetadataPolicies.diagnosticsBinder) on the metadata
 * lease and hands the verdict INTO the pure engine as data. The 250ms wait
 * budget is a race (addendum C-9), backstopped host-side so a misbehaving
 * lease can never block the pass: on miss the verdict is "notValidated" and
 * the engine suppresses binder claims (counted `metadataNotValidated`; T1
 * continues unchanged). Drift cancels mid-pass (metadata generation moved,
 * same document version) keep their silent restart and are now counted as
 * `metadataStale` on the next published pass.
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
    SqlMetadataFreshnessVerdict,
} from "../sqlLanguage/api";
import { MetadataPolicies } from "../services/metadata/cache/metadataFreshness";
import { diag } from "../diagnostics/diagnosticsCore";
import { Sts2BridgeEngine } from "../sqlLanguage/host/bridgeEngine";
import { NativeSqlLanguageEngine } from "../sqlLanguage/host/nativeEngine";
import {
    LanguageEnginePreference,
    LanguageFeatureRouter,
    RouterStatusEntry,
} from "../sqlLanguage/host/router";
import {
    DiagnosticsSchedulerState,
    SlicedDiagnosticsScheduler,
    isMetadataDriftCancel,
} from "../sqlLanguage/host/scheduler";
import {
    CatalogLanguageMetadataProvider,
    MetadataCatalogHandle,
} from "../sqlLanguage/provider/catalogProvider";
import { LanguageReadiness } from "../sqlLanguage/provider/types";
import { DocumentSessionBinding } from "./documentSessionBinding";

export const LANGUAGE_ENGINE_SETTING = "mssql.queryStudio.languageService.engine";
export const DIAGNOSTICS_ENABLED_SETTING = "mssql.sqlLanguage.diagnostics.enabled";

/**
 * A pass producing more errors than this is withheld entirely (published
 * empty, counted as tooManyDiagnostics). Documents this wrong are not being
 * written as SQL — prose or data rows pasted into a .sql buffer — and a
 * wall of squiggles helps nobody. Self-healing per pass, no latch.
 */
export const DIAGNOSTICS_BREAKER_MAX = 100;

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
    /**
     * Await the host mirror reaching the webview text hash (bounded).
     * Language requests race the edit coalescer; without convergence the
     * engine classifies one keystroke behind (sys.| binding as sys|.).
     * Resolves false on timeout — serve current text, never block.
     */
    awaitTextHash?(hash: string, timeoutMs: number): Promise<boolean>;
    backingDocument(): vscode.TextDocument | undefined;
    sessionBinding(): DocumentSessionBinding | undefined;
    /** Cached database names for USE completions; refreshed by the controller. */
    databases(): readonly string[] | undefined;
}

export interface LanguageServiceDiagnosticsStatus {
    readonly enabled: boolean;
    readonly scheduler: DiagnosticsSchedulerState;
    readonly lastPassVersion?: number;
    /** Suppression counts BY REASON from the last native pass — never text. */
    readonly suppressionCounts: Readonly<Record<string, number>>;
}

export interface LanguageServiceStatus {
    readonly preference: LanguageEnginePreference;
    readonly router: readonly RouterStatusEntry[];
    readonly readiness: LanguageReadiness;
    readonly metadataGeneration: number;
    readonly shadowConnectionState: "none" | "connected" | "invalidated";
    readonly diagnostics: LanguageServiceDiagnosticsStatus;
}

export class QueryStudioLanguageService implements vscode.Disposable {
    private readonly nativeEngine: NativeSqlLanguageEngine;
    private readonly provider: CatalogLanguageMetadataProvider;
    private readonly router: LanguageFeatureRouter;
    private bridge: Sts2BridgeEngine | undefined;

    private shadowState: "none" | "connected" | "invalidated" = "none";
    private shadowConnecting: Promise<boolean> | undefined;
    private shadowDatabase: string | undefined;

    private readonly diagnosticsScheduler: SlicedDiagnosticsScheduler;
    private diagnosticsSuppressionCounts: Readonly<Record<string, number>> = {};
    private lastDiagnosticsPassVersion: number | undefined;
    /** Drift cancels awaiting the next publish (merged as `metadataStale`). */
    private pendingMetadataStale = 0;

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
        // the pull path is bridge.diagnostics()). MUTUAL EXCLUSION: when the
        // router serves diagnostics natively, bridge/mssql-collection pushes
        // must not double-report — the forwarding is gated on the route.
        this.disposables.push(
            vscode.languages.onDidChangeDiagnostics((e) => {
                if (this.router.effectiveEngine("diagnostics") === "nativeTypeScript") {
                    return;
                }
                const uri = this.host.backingDocument()?.uri.toString();
                if (uri !== undefined && e.uris.some((u) => u.toString() === uri)) {
                    this.notifyDiagnosticsListeners();
                }
            }),
        );

        // Native diagnostics: ~300ms debounce, sliced whole-document pass,
        // stale-version cancel (design §11.3). The stamp carries the metadata
        // generation so mid-hydration changes abort and re-run the pass.
        this.diagnosticsScheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => {
                const document = this.host.backingDocument();
                if (document === undefined) {
                    return undefined;
                }
                return {
                    text: document.getText(),
                    version: document.version,
                    stamp: `${document.version}:${this.provider.generation}`,
                };
            },
            // CACHE-5 (§7.3): resolve the freshness verdict first (bounded —
            // see diagnosticsFreshnessVerdict), then build the pass with the
            // verdict as data. The scheduler re-checks staleness after the
            // await, so verdict resolution never races the stamp.
            createPass: async (text, version) =>
                this.nativeEngine.diagnosticsPass({
                    text,
                    version,
                    metadataFreshness: await this.diagnosticsFreshnessVerdict(),
                }),
            publish: (result, version) => {
                this.lastDiagnosticsPassVersion = version;
                const counts: Record<string, number> = { ...(result.suppressed ?? {}) };
                // Breaker: a document drowning in errors is almost never SQL
                // being written — it is prose/data opened as .sql. Squiggling
                // every line is noise, so the whole pass is withheld (counted,
                // and self-healing: the next pass under the cap publishes).
                if (result.diagnostics.length > DIAGNOSTICS_BREAKER_MAX) {
                    counts.tooManyDiagnostics = result.diagnostics.length;
                }
                // Drift cancels since the last publish ride the same counted
                // suppression surface (reason -> count, never identifiers).
                if (this.pendingMetadataStale > 0) {
                    counts.metadataStale = (counts.metadataStale ?? 0) + this.pendingMetadataStale;
                    this.pendingMetadataStale = 0;
                }
                this.diagnosticsSuppressionCounts = counts;
                this.notifyDiagnosticsListeners();
            },
            onStaleCancel: (started, current) => {
                // Keep the silent restart (the provider-change listener
                // already reschedules); just count the drift (§7.3).
                if (isMetadataDriftCancel(started, current)) {
                    this.pendingMetadataStale++;
                }
            },
        });
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                const document = this.host.backingDocument();
                if (
                    document !== undefined &&
                    e.document.uri.toString() === document.uri.toString()
                ) {
                    this.scheduleNativeDiagnostics();
                }
            }),
        );
        const providerUnsubscribe = this.provider.onDidChange(() =>
            this.scheduleNativeDiagnostics(),
        );
        this.disposables.push({ dispose: providerUnsubscribe });
    }

    private notifyDiagnosticsListeners(): void {
        for (const listener of [...this.diagnosticsListeners]) {
            listener();
        }
    }

    private diagnosticsEnabled(): boolean {
        return (
            vscode.workspace.getConfiguration().get<boolean>(DIAGNOSTICS_ENABLED_SETTING, true) &&
            this.intelliSense("enableErrorChecking")
        );
    }

    /**
     * The classic mssql.intelliSense.* switches apply to the native engine
     * too — they are editor-generic, not an STS implementation detail.
     * enableSuggestions covers completions AND signature help;
     * enableQuickInfo covers hover; enableErrorChecking gates diagnostics
     * alongside mssql.sqlLanguage.diagnostics.enabled.
     */
    private intelliSense(
        flag: "enableSuggestions" | "enableQuickInfo" | "enableErrorChecking",
    ): boolean {
        const config = vscode.workspace.getConfiguration("mssql.intelliSense");
        return config.get<boolean>("enableIntelliSense", true) && config.get<boolean>(flag, true);
    }

    /**
     * Converge the host mirror to the webview text a request was computed
     * against (bounded wait, never hard) — positional requests race the
     * edit coalescer exactly like completions. Only completion emits the
     * converge diag event; it owns that vocabulary and its volume.
     */
    private async converge(textHash: string | undefined, emitDiag: boolean): Promise<void> {
        if (textHash === undefined || this.host.awaitTextHash === undefined) {
            return;
        }
        const waitStart = Date.now();
        const converged = await this.host.awaitTextHash(textHash, 200);
        const waitedMs = Date.now() - waitStart;
        if (emitDiag && (waitedMs > 1 || !converged)) {
            diag.emit({
                feature: "sqlLanguage",
                kind: "event",
                type: "sqlLanguage.completion.converge",
                status: converged ? "ok" : "warning",
                fields: {
                    waitedMs: { raw: waitedMs, cls: "diagnostic.metadata" },
                    converged: { raw: converged, cls: "diagnostic.metadata" },
                },
            });
        }
    }

    /**
     * Resolve the diagnostics-binder freshness verdict for the current
     * document→lease binding (CACHE-5, addendum §7.3/§4). ensureFresh's
     * timeoutMs is already a wait budget (a race, C-9); the host-side
     * backstop timer below guarantees the pass can never block past the
     * budget even on a lease that never settles. Validation miss, timeout,
     * or failure all yield "notValidated" — diagnostics suppress, they do
     * not block. No lease bound means there is nothing to validate; the
     * provider readiness ladder (providerNotReady et al.) owns honesty then.
     */
    private async diagnosticsFreshnessVerdict(): Promise<SqlMetadataFreshnessVerdict> {
        const handle = this.metadataHandle();
        if (handle === undefined) {
            return "validated";
        }
        const policy = MetadataPolicies.diagnosticsBinder;
        const backstopMs = (policy.timeoutMs ?? 250) + 50;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([
                handle.ensureFresh(policy),
                new Promise<undefined>((resolve) => {
                    timer = setTimeout(() => resolve(undefined), backstopMs);
                }),
            ]);
            if (result === undefined) {
                return "notValidated"; // backstop won — lease overran the budget
            }
            return result.freshness === "validated" || result.freshness === "live"
                ? "validated"
                : "notValidated";
        } catch {
            return "notValidated";
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }

    /** Debounce a native pass — or clear when disabled / routed elsewhere. */
    private scheduleNativeDiagnostics(): void {
        if (this.router.effectiveEngine("diagnostics") !== "nativeTypeScript") {
            this.diagnosticsScheduler.cancel();
            return;
        }
        if (!this.diagnosticsEnabled()) {
            this.diagnosticsScheduler.cancel();
            this.notifyDiagnosticsListeners(); // pull yields [] -> markers clear
            return;
        }
        this.diagnosticsScheduler.notifyChange();
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
        // Route switch: the now-effective engine republishes (the pull path
        // returns its markers; the stale engine's markers are replaced).
        this.scheduleNativeDiagnostics();
        this.notifyDiagnosticsListeners();
    }

    /** mssql.sqlLanguage.diagnostics.enabled changed. */
    onDiagnosticsSettingChanged(): void {
        this.scheduleNativeDiagnostics();
        this.notifyDiagnosticsListeners();
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

    async completion(
        position: SqlLanguagePosition,
        trigger: "invoke" | "character",
        triggerCharacter?: string,
        textHash?: string,
    ): Promise<CompletionResult | undefined> {
        if (!this.intelliSense("enableSuggestions")) {
            return undefined;
        }
        // Converge the mirror to the webview text before classifying: the
        // request races the edit coalescer, and a one-keystroke-stale text
        // binds member access at the wrong place.
        await this.converge(textHash, true);
        // CACHE-4 safe-stale: the answer comes synchronously from the
        // pinned snapshot; this policy call is NEVER awaited on the hot
        // path — it schedules a background refresh when the snapshot has
        // aged past the preset and records the policy decision.
        void this.metadataHandle()
            ?.ensureFresh(MetadataPolicies.completion)
            .catch(() => undefined);
        const req = { ...this.request(position), trigger, triggerCharacter };
        return this.router.route("completion", (e) => e.completion(req));
    }

    async hover(
        position: SqlLanguagePosition,
        textHash?: string,
    ): Promise<HoverResult | undefined> {
        if (!this.intelliSense("enableQuickInfo")) {
            return undefined;
        }
        await this.converge(textHash, false);
        return this.router.route("hover", (e) => e.hover(this.request(position)));
    }

    async signatureHelp(
        position: SqlLanguagePosition,
        textHash?: string,
    ): Promise<SignatureHelpResult | undefined> {
        // Lumped with completions (enableSuggestions): "(" fires this the
        // instant it is typed, so convergence matters here most of all.
        if (!this.intelliSense("enableSuggestions")) {
            return undefined;
        }
        await this.converge(textHash, false);
        return this.router.route("signatureHelp", (e) => e.signatureHelp(this.request(position)));
    }

    async definition(
        position: SqlLanguagePosition,
        textHash?: string,
    ): Promise<DefinitionLocationResult | undefined> {
        await this.converge(textHash, false);
        return this.router.route("definition", (e) => e.definition(this.request(position)));
    }

    async diagnostics(): Promise<DiagnosticsResult | undefined> {
        // Disabled = the native engine publishes NOTHING (an empty result so
        // previously published markers clear). Bridge routing is unaffected.
        const native = this.router.effectiveEngine("diagnostics") === "nativeTypeScript";
        if (native && !this.diagnosticsEnabled()) {
            return { diagnostics: [] };
        }
        const req = this.request({ line: 0, character: 0 });
        // Native pulls carry the same freshness verdict as scheduled passes
        // (a pull right after a pass memo-hits: same version/generation/
        // verdict). The bridge path never sees the field.
        const metadataFreshness = native ? await this.diagnosticsFreshnessVerdict() : undefined;
        const result = await this.router.route("diagnostics", (e) =>
            e.diagnostics({
                text: req.text,
                version: req.version,
                ...(metadataFreshness !== undefined ? { metadataFreshness } : {}),
            }),
        );
        // Breaker (see the scheduler publish hook): withhold a pass that
        // exceeds the cap — an empty result also clears stale markers.
        if (native && result !== undefined && result.diagnostics.length > DIAGNOSTICS_BREAKER_MAX) {
            return { ...result, diagnostics: [] };
        }
        return result;
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
            diagnostics: {
                enabled: this.diagnosticsEnabled(),
                scheduler: this.diagnosticsScheduler.state,
                lastPassVersion: this.lastDiagnosticsPassVersion,
                suppressionCounts: this.diagnosticsSuppressionCounts,
            },
        };
    }

    dispose(): void {
        this.diagnosticsScheduler.dispose();
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
