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
 * The console's behavior surface is unchanged for this work item: only the
 * Live-experience command subset is enabled (a thin allowlist below);
 * replay/sessions commands still surface the standalone-viewer info message.
 * State fields those commands would populate stay honest empty defaults
 * because nothing drives this host's sessions/replay services.
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
    InlineCompletionDebugReducers,
    InlineCompletionDebugWebviewState,
    inlineCompletionCategories,
} from "../sharedInterfaces/inlineCompletionDebug";

const CHANGE_THROTTLE_MS = 250;

export const REPLAY_SESSIONS_STUB_MESSAGE =
    "Replay & sessions run in the standalone viewer for now — MSSQL: Open Inline Completion Debug.";

/**
 * Live-experience command subset enabled in the console for this work item.
 * Everything else (sessions, replay, cart, trace-file workflows) surfaces the
 * standalone-viewer stub message — an allowlist, not forked logic; the shared
 * command handler implements every command.
 */
const CONSOLE_ENABLED_COMMANDS: ReadonlySet<keyof InlineCompletionDebugReducers> = new Set<
    keyof InlineCompletionDebugReducers
>([
    "clearEvents",
    "selectEvent",
    "updateOverrides",
    "selectProfile",
    "setRecordWhenClosed",
    "openCustomPromptDialog",
    "closeCustomPromptDialog",
    "saveCustomPrompt",
    "resetCustomPrompt",
    "refreshSchemaContext",
    "exportSession",
    "copyEventPayload",
]);

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
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _services: InlineCompletionDebugServiceSet;
    private readonly _hostServices: InlineCompletionDebugHostServices;
    private readonly _viewerLease: FeatureCaptureLease;
    private _throttleTimer: ReturnType<typeof setTimeout> | undefined;
    private _lastChangeFiredAt = 0;
    private _disposed = false;

    /** Throttled (≥250 ms) change signal; the webview re-pulls state on it. */
    public readonly onDidChange = this._onDidChangeEmitter.event;

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
            inlineCompletionDebugStore.onDidChange(() => this.fireChanged()),
            this._services.captureService.onDidChange(() => this.fireChanged()),
            this._services.traceRepository.onDidChange(() => this.fireChanged()),
            this._services.replayService.onDidChange(() => this.fireChanged()),
            watchCompletionsDebugConfiguration({
                onStateAffectingChange: () => this.fireChanged(),
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
    }

    public getState(): InlineCompletionDebugWebviewState {
        return this._services.projector.buildState(this._services.commandHandler.viewState);
    }

    /**
     * Dispatch a reducer-named action from the console webview. Allowlisted
     * commands ride the shared command handler; everything else surfaces the
     * stub info message and returns the current state unchanged (never throw).
     */
    public async dispatchAction(
        name: string,
        payload: unknown,
    ): Promise<InlineCompletionDebugWebviewState> {
        const command = name as keyof InlineCompletionDebugReducers;
        if (CONSOLE_ENABLED_COMMANDS.has(command)) {
            await this._services.commandHandler.handle(
                command,
                (isRecord(payload) ? payload : {}) as InlineCompletionDebugReducers[typeof command],
            );
        } else {
            void this._hostServices.showInformationMessage(REPLAY_SESSIONS_STUB_MESSAGE);
        }

        return this.getState();
    }

    private fireChanged(): void {
        if (this._disposed || this._throttleTimer) {
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
            this._onDidChangeEmitter.fire();
        }, delay);
    }
}
