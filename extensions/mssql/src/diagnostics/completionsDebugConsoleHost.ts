/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Console-hosted Inline Completion Debug host — a THIN adapter over the
 * WI-1.1 domain services (copilot/inlineCompletionDebug/services/): state is
 * projected through the shared InlineCompletionDebugStateProjector and
 * actions dispatch through the shared InlineCompletionDebugCommandHandler.
 * The former fork of the standalone controller's createState/reducer bodies
 * is gone — both adapters call the exact same service implementations over
 * the SINGLETON inlineCompletionDebugStore.
 *
 * WI-1.4/1.5: the full command surface is enabled — the former Live-subset
 * allowlist (and its standalone-viewer stub message) is gone. Sessions,
 * replay, cart, and trace-file workflows all dispatch through the shared
 * command handler; dialogs run through the injected host services.
 */

import * as vscode from "vscode";
import {
    createInlineCompletionDebugServices,
    InlineCompletionDebugServiceSet,
} from "../copilot/inlineCompletionDebug/services/inlineCompletionDebugCommandHandler";
import {
    DEFAULT_CUSTOM_PROMPT,
    isRecord,
} from "../copilot/inlineCompletionDebug/services/inlineCompletionDebugConstants";
import { watchCompletionsDebugConfiguration } from "../copilot/inlineCompletionDebug/services/inlineCompletionCaptureService";
import {
    createDefaultInlineCompletionDebugHostServices,
    InlineCompletionDebugHostServices,
} from "../copilot/inlineCompletionDebug/services/inlineCompletionDebugHostServices";
import { createEmptySessionsState } from "../copilot/inlineCompletionDebug/services/inlineCompletionTraceRepository";
import { inlineCompletionDebugProfileOptions } from "../copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";
import {
    inlineCompletionDebugDefaultOverrides,
    inlineCompletionDebugStore,
} from "../copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import {
    automaticTriggerDebounceMs,
    continuationModeMaxTokens,
    intentModeMaxTokens,
} from "../copilot/sqlInlineCompletionProvider";
import { CompletionSchemaContextService } from "../copilot/completionSchemaContextService";
import { FeatureCaptureLease } from "./featureCapture/captureStore";
import {
    buildCompletionLiveRowsResult,
    resolveCompletionEventDetail,
} from "./completionsDebugRpcHost";
import {
    DcCompletionEventDetailParams,
    DcCompletionEventDetailResult,
    DcCompletionLiveRowsParams,
    DcCompletionLiveRowsResult,
    DcIcDebugCapabilitiesResult,
    DcIcDebugChanged2Params,
    DcIcDebugCommandParams,
    DcIcDebugCommandResult,
    IC_DEBUG_PROTOCOL_VERSION,
    IcDebugChangedDomain,
    icDebugChangedDomains,
    icDebugCommandNames,
    validateIcDebugCommand,
} from "../sharedInterfaces/completionsDebugRpc";
import {
    InlineCompletionDebugWebviewState,
    inlineCompletionCategories,
} from "../sharedInterfaces/inlineCompletionDebug";

const CHANGE_THROTTLE_MS = 250;

export interface CompletionsDebugConsoleHostDeps {
    extensionContext: vscode.ExtensionContext;
    /**
     * Mirrors what mainController hands the standalone controller. The Live
     * subset never replays (refreshSchemaContext rides the shared command),
     * but the replay service is wired with it so enabling replay here later
     * is purely an allowlist change.
     */
    schemaContextService?: CompletionSchemaContextService;
    /** Injectable for tests; defaults to the real vscode-backed host. */
    hostServices?: InlineCompletionDebugHostServices;
}

let hostDeps: CompletionsDebugConsoleHostDeps | undefined;

/** Called from mainController right after the schema context service exists. */
export function configureCompletionsDebugHost(deps: CompletionsDebugConsoleHostDeps): void {
    hostDeps = deps;
}

/** Undefined when the inline-completion module never initialized (no deps). */
export function createConsoleCompletionsDebugHost(): ConsoleCompletionsDebugHost | undefined {
    return hostDeps ? new ConsoleCompletionsDebugHost(hostDeps) : undefined;
}

/** Rejection message for typed commands while the feature gate is off. */
export const IC_DEBUG_GATE_OFF_MESSAGE =
    "Inline completion debug is unavailable — enable AI completions first.";

/**
 * Project a full-state pull result for the wire (WI-1.4). `omitEvents`
 * strips the live event bodies — the console provider reads live rows over
 * the thin dc/completionLiveRows transport instead, so its initial payload
 * carries no prompt/response content (addendum §14 budget). Loaded session
 * traces still ride the sessions slice once the USER loads them — the
 * standalone panel's semantics, interim until Phase-2 host-side aggregation.
 * Legacy callers (no params) get the unmodified full state.
 */
export function projectIcDebugStateResult(
    state: InlineCompletionDebugWebviewState,
    params: { omitEvents?: boolean } | undefined,
): InlineCompletionDebugWebviewState {
    if (!params?.omitEvents) {
        return state;
    }
    return { ...state, events: [] };
}

/**
 * WI-1.6 deep-link routing: where `mssql.openInlineCompletionDebug` lands.
 * Flag OFF (default) → the Debug Console AT the Completions page — even while
 * the feature gate is off, because that page hosts the enablement flow.
 * Flag ON → the legacy standalone panel (the rollback path), which keeps its
 * existing behavior of doing nothing while the feature gate is off.
 */
export type CompletionsDebugLaunchTarget =
    | { kind: "console"; page: "completions" }
    | { kind: "standalonePanel" }
    | { kind: "none" };

export function resolveCompletionsDebugLaunchTarget(options: {
    standalonePanelFlag: boolean;
    featureEnabled: boolean;
}): CompletionsDebugLaunchTarget {
    if (!options.standalonePanelFlag) {
        return { kind: "console", page: "completions" };
    }
    return options.featureEnabled ? { kind: "standalonePanel" } : { kind: "none" };
}

/** Gate-off capabilities: honest empties, featureGateOn:false (WI-1.2). */
export function createGateOffIcDebugCapabilities(): DcIcDebugCapabilitiesResult {
    return {
        protocolVersion: IC_DEBUG_PROTOCOL_VERSION,
        enabledCommands: [],
        featureGateOn: false,
    };
}

/** Gate-off live rows: an honest empty page at revision 0 (WI-1.3). */
export function createGateOffCompletionLiveRowsResult(): DcCompletionLiveRowsResult {
    return { rows: [], revision: 0, totalCount: 0, droppedFromRing: false };
}

/** Gate-off event detail: nothing is findable (WI-1.3). */
export function createGateOffCompletionEventDetailResult(): DcCompletionEventDetailResult {
    return { found: false, revision: 0, sections: {} };
}

/** Gate-off command result: rejected before any service, revision 0 (WI-1.2). */
export function createGateOffIcDebugCommandResult(): DcIcDebugCommandResult {
    return { revision: 0, validation: { ok: false, message: IC_DEBUG_GATE_OFF_MESSAGE } };
}

/**
 * Honest default state for when the feature gate is off (or deps are absent):
 * no events, no models, defaults from compile-time constants only.
 */
export function createEmptyConsoleCompletionsDebugState(): InlineCompletionDebugWebviewState {
    return {
        events: [],
        overrides: { ...inlineCompletionDebugDefaultOverrides },
        defaults: {
            useSchemaContext: false,
            includeSqlDiagnostics: true,
            debounceMs: automaticTriggerDebounceMs,
            continuationMaxTokens: continuationModeMaxTokens,
            intentMaxTokens: intentModeMaxTokens,
            enabledCategories: [...inlineCompletionCategories],
            allowAutomaticTriggers: true,
            schemaContext: null,
        },
        profiles: [...inlineCompletionDebugProfileOptions],
        availableModels: [],
        recordWhenClosed: false,
        customPrompt: {
            dialogOpen: false,
            savedValue: null,
            defaultValue: DEFAULT_CUSTOM_PROMPT,
        },
        sessions: createEmptySessionsState(""),
        replay: {
            cart: [],
            runs: [],
            queueRows: [],
            builderOpen: false,
        },
    };
}

export class ConsoleCompletionsDebugHost {
    private readonly _onDidChangeEmitter = new vscode.EventEmitter<void>();
    private readonly _onDidChange2Emitter = new vscode.EventEmitter<DcIcDebugChanged2Params>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _services: InlineCompletionDebugServiceSet;
    private readonly _hostServices: InlineCompletionDebugHostServices;
    private readonly _viewerLease: FeatureCaptureLease;
    private readonly _pendingChangedDomains = new Set<IcDebugChangedDomain>();
    private _throttleTimer: ReturnType<typeof setTimeout> | undefined;
    private _lastChangeFiredAt = 0;
    private _revision = 0;
    private _disposed = false;

    /** Throttled (≥250 ms) change signal; the webview re-pulls state on it. */
    public readonly onDidChange = this._onDidChangeEmitter.event;

    /**
     * Typed sibling of onDidChange on the same 250 ms throttle (≤4/sec,
     * addendum §14): revision plus the domains that changed since the last
     * flush, so the webview refetches only the affected thin resources.
     */
    public readonly onDidChange2 = this._onDidChange2Emitter.event;

    constructor(deps: CompletionsDebugConsoleHostDeps) {
        this._hostServices = deps.hostServices ?? createDefaultInlineCompletionDebugHostServices();
        this._services = createInlineCompletionDebugServices({
            ...deps,
            hostServices: this._hostServices,
        });

        // Named viewer lease: disposing the console never affects a
        // concurrently open standalone panel's lease (final plan WI-0.4).
        this._viewerLease = inlineCompletionDebugStore.acquireViewer("debugConsole.completions");

        this._disposables.push(
            // The store's one emitter covers both the event ring and the
            // session overrides, so its changes tag both domains (a superset
            // re-pull is honest; a missed domain would not be).
            inlineCompletionDebugStore.onDidChange(() => this.fireChanged(["live", "config"])),
            this._services.captureService.onDidChange(() => this.fireChanged(["config"])),
            this._services.traceRepository.onDidChange(() => this.fireChanged(["sessions"])),
            this._services.replayService.onDidChange(() => this.fireChanged(["replay"])),
            watchCompletionsDebugConfiguration({
                onStateAffectingChange: () => this.fireChanged(["config"]),
                onModelConfigurationChange: () =>
                    this._services.captureService.refreshEffectiveDefaultModel(),
                // No sessions surface here: reset the read model to the new
                // folder without scanning (the panel adapter rescans instead).
                onTraceFolderChange: () =>
                    this._services.traceRepository.handleTraceFolderConfigurationChange(),
            }),
        );
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        if (this._throttleTimer) {
            clearTimeout(this._throttleTimer);
            this._throttleTimer = undefined;
        }
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables.length = 0;
        this._services.dispose();
        this._viewerLease.dispose();
        this._onDidChangeEmitter.dispose();
        this._onDidChange2Emitter.dispose();
    }

    /** Monotonic state revision; bumps on every domain change event. */
    public get revision(): number {
        return this._revision;
    }

    public getState(): InlineCompletionDebugWebviewState {
        return this._services.projector.buildState(this._services.commandHandler.viewState);
    }

    /**
     * Live replay engine state for the Replay Lab RPCs (WI-3.5). HOST-SIDE
     * ONLY: queue rows carry full event bodies — the controller projects them
     * through replayLabRpcHost before anything crosses the webview boundary.
     */
    public getReplayState() {
        return this._services.replayService.getState();
    }

    /**
     * Dispatch a reducer-named action from the console webview (legacy
     * dc/icDebugAction path — kept for contract compatibility). Every command
     * rides the shared command handler; validation happens in-band so a bad
     * name/payload never reaches a service (never throw).
     */
    public async dispatchAction(
        name: string,
        payload: unknown,
    ): Promise<InlineCompletionDebugWebviewState> {
        const validation = validateIcDebugCommand({
            name,
            payload: isRecord(payload) ? payload : {},
        });
        if (validation.ok === false) {
            void this._hostServices.showInformationMessage(validation.message);
        } else {
            await this._services.commandHandler.handle(
                validation.command.name,
                validation.command.payload,
            );
        }

        return this.getState();
    }

    // --- Typed, versioned RPC surface (WI-1.2/WI-1.3) ----------------------

    /** Protocol handshake: version + the full enabled command surface. */
    public getCapabilities(): DcIcDebugCapabilitiesResult {
        return {
            protocolVersion: IC_DEBUG_PROTOCOL_VERSION,
            enabledCommands: [...icDebugCommandNames].sort(),
            featureGateOn: true,
        };
    }

    /** Thin, cursor-paged live rows — never prompt/response/schema/locals. */
    public getLiveRows(params: DcCompletionLiveRowsParams | undefined): DcCompletionLiveRowsResult {
        return buildCompletionLiveRowsResult({
            events: inlineCompletionDebugStore.getEvents(),
            availableModels: this._services.captureService.availableModels,
            params,
            revision: this._revision,
            droppedFromRing: inlineCompletionDebugStore.evictedEventCount > 0,
        });
    }

    /** Section-lazy detail for one live-ring or loaded-trace event. */
    public async getEventDetail(
        params: DcCompletionEventDetailParams,
    ): Promise<DcCompletionEventDetailResult> {
        return resolveCompletionEventDetail(params, {
            revision: this._revision,
            availableModels: this._services.captureService.availableModels,
            traceRepository: this._services.traceRepository,
        });
    }

    /**
     * Dispatch a typed command. Shape/enum validation rejects malformed
     * payloads BEFORE any service runs; well-formed commands all dispatch
     * through the shared command handler (WI-1.4/1.5: no allowlist).
     */
    public async dispatchCommand(
        params: DcIcDebugCommandParams | undefined,
    ): Promise<DcIcDebugCommandResult> {
        const validation = validateIcDebugCommand(params?.command);
        if (validation.ok === false) {
            return {
                revision: this._revision,
                validation: { ok: false, message: validation.message },
            };
        }
        const command = validation.command;

        await this._services.commandHandler.handle(command.name, command.payload);
        return { revision: this._revision, validation: { ok: true } };
    }

    private fireChanged(domains: readonly IcDebugChangedDomain[]): void {
        if (this._disposed) {
            return;
        }
        // Revision moves on every change event; the notification flush is
        // what the 250 ms throttle coalesces (≤4/sec, addendum §14).
        this._revision++;
        for (const domain of domains) {
            this._pendingChangedDomains.add(domain);
        }
        if (this._throttleTimer) {
            return;
        }
        const elapsed = Date.now() - this._lastChangeFiredAt;
        const delay = Math.max(0, CHANGE_THROTTLE_MS - elapsed);
        this._throttleTimer = setTimeout(() => {
            this._throttleTimer = undefined;
            if (this._disposed) {
                return;
            }
            this._lastChangeFiredAt = Date.now();
            const changed = icDebugChangedDomains.filter((domain) =>
                this._pendingChangedDomains.has(domain),
            );
            this._pendingChangedDomains.clear();
            this._onDidChangeEmitter.fire();
            this._onDidChange2Emitter.fire({ revision: this._revision, changed });
        }, delay);
    }
}
