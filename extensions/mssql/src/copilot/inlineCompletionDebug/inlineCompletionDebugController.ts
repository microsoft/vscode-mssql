/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standalone "Copilot Completion Debug" panel — a THIN adapter over the
 * WI-1.1 domain services (services/): every reducer delegates to the shared
 * InlineCompletionDebugCommandHandler and re-projects state through the
 * shared InlineCompletionDebugStateProjector. No business logic lives here;
 * the Debug Console's Completions page rides the exact same services
 * (diagnostics/completionsDebugConsoleHost.ts), so nothing is forked.
 *
 * This adapter owns only webview-panel lifecycle: the panel itself, the
 * "standalonePanel" viewer lease, the completions settings snapshot/watch,
 * the configuration-change wiring, and disposal of the per-panel service set
 * (trace-folder watcher, replay engine, model-catalog subscription).
 */

import * as vscode from "vscode";
import { WebviewPanelController } from "../../controllers/webviewPanelController";
import { FeatureCaptureLease } from "../../diagnostics/featureCapture/captureStore";
import {
    emitSettingsSnapshot,
    watchFeatureSettings,
} from "../../diagnostics/featureCapture/settingsSnapshot";
import {
    InlineCompletionDebugReducers,
    InlineCompletionDebugWebviewState,
} from "../../sharedInterfaces/inlineCompletionDebug";
import { CompletionSchemaContextService } from "../completionSchemaContextService";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import { COMPLETIONS_SETTINGS_SPEC } from "./services/inlineCompletionDebugConstants";
import { watchCompletionsDebugConfiguration } from "./services/inlineCompletionCaptureService";
import {
    createInlineCompletionDebugServices,
    InlineCompletionDebugServiceSet,
} from "./services/inlineCompletionDebugCommandHandler";

// Re-exported for compatibility: these constants historically lived here and
// now belong to the services layer (WI-1.1).
export {
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
} from "./services/inlineCompletionDebugConstants";

export class InlineCompletionDebugController extends WebviewPanelController<
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers
> {
    private readonly _services: InlineCompletionDebugServiceSet;
    private readonly _viewerLease: FeatureCaptureLease;

    constructor(
        extensionContext: vscode.ExtensionContext,
        schemaContextService?: CompletionSchemaContextService,
    ) {
        const services = createInlineCompletionDebugServices({
            extensionContext,
            schemaContextService,
        });
        super(
            extensionContext,
            "inlineCompletionDebug",
            "inlineCompletionDebug",
            services.projector.buildState(services.commandHandler.viewState),
            {
                title: "Copilot Completion Debug",
                viewColumn: vscode.ViewColumn.Active,
                showRestorePromptAfterClose: false,
            },
        );

        this._services = services;
        this._viewerLease = inlineCompletionDebugStore.acquireViewer("standalonePanel");
        emitSettingsSnapshot(COMPLETIONS_SETTINGS_SPEC, "panelOpened");
        this.registerDisposables();
        this.registerReducers();
    }

    public override dispose(): void {
        this._services.dispose();
        this._viewerLease.dispose();
        super.dispose();
    }

    private registerDisposables(): void {
        this.registerDisposable(watchFeatureSettings(COMPLETIONS_SETTINGS_SPEC));
        this.registerDisposable(inlineCompletionDebugStore.onDidChange(() => this.pushState()));
        this.registerDisposable(this._services.captureService.onDidChange(() => this.pushState()));
        this.registerDisposable(this._services.traceRepository.onDidChange(() => this.pushState()));
        this.registerDisposable(this._services.replayService.onDidChange(() => this.pushState()));
        this.registerDisposable(
            watchCompletionsDebugConfiguration({
                onStateAffectingChange: () => this.pushState(),
                onModelConfigurationChange: () =>
                    this._services.captureService.refreshEffectiveDefaultModel(),
                onTraceFolderChange: () => {
                    void this._services.traceRepository.refreshSessions({ resetFolder: true });
                },
            }),
        );
    }

    /** Every reducer is a thin dispatch into the shared command handler. */
    private registerReducers(): void {
        for (const name of this._services.commandHandler.commandNames) {
            this.registerCommandReducer(name);
        }
    }

    private registerCommandReducer<K extends keyof InlineCompletionDebugReducers>(name: K): void {
        this.registerReducer(name, async (_state, payload) => {
            await this._services.commandHandler.handle(name, payload);
            return this.projectState();
        });
    }

    private projectState(): InlineCompletionDebugWebviewState {
        return this._services.projector.buildState(this._services.commandHandler.viewState);
    }

    private pushState(): void {
        if (!this.isDisposed) {
            this.updateState(this.projectState());
        }
    }
}
