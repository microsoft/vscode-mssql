/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed command dispatch for Inline Completion Debug (final plan WI-1.1,
 * addendum §6.1): one handler per InlineCompletionDebugReducers key —
 * compile-time exhaustive via the mapped handler record — each delegating to
 * the domain services. Both adapters (standalone panel, Debug Console page)
 * dispatch through this exact implementation; no reducer business body lives
 * in an adapter.
 *
 * Design decision (WI-1.1): per-viewer UI state (selectedEventId,
 * customPromptDialogOpen) is owned by the command handler instance — one
 * handler per viewer host — rather than by each adapter. That keeps the
 * select/clear/import/save-prompt state transitions in exactly one place;
 * adapters only project state after a dispatch.
 */

import * as vscode from "vscode";
import * as Constants from "../../../constants/constants";
import { CompletionSchemaContextService } from "../../completionSchemaContextService";
import { inlineCompletionDebugStore } from "../inlineCompletionDebugStore";
import { InlineCompletionDebugReducers } from "../../../sharedInterfaces/inlineCompletionDebug";
import { InlineCompletionCaptureService } from "./inlineCompletionCaptureService";
import { InlineCompletionTraceRepository } from "./inlineCompletionTraceRepository";
import { InlineCompletionReplayService } from "./inlineCompletionReplayService";
import {
    InlineCompletionDebugStateProjector,
    InlineCompletionDebugViewerUiState,
} from "./inlineCompletionDebugStateProjector";
import {
    createDefaultInlineCompletionDebugHostServices,
    InlineCompletionDebugHostServices,
} from "./inlineCompletionDebugHostServices";

export interface InlineCompletionDebugCommandHandlerDeps {
    captureService: InlineCompletionCaptureService;
    traceRepository: InlineCompletionTraceRepository;
    replayService: InlineCompletionReplayService;
    hostServices: InlineCompletionDebugHostServices;
}

type InlineCompletionDebugCommandHandlers = {
    [K in keyof InlineCompletionDebugReducers]: (
        payload: InlineCompletionDebugReducers[K],
    ) => void | Promise<void>;
};

export class InlineCompletionDebugCommandHandler {
    private _selectedEventId: string | undefined;
    private _customPromptDialogOpen = false;

    private readonly _handlers: InlineCompletionDebugCommandHandlers = {
        clearEvents: () => {
            inlineCompletionDebugStore.clearEvents();
            this._selectedEventId = undefined;
        },
        selectEvent: (payload) => {
            this._selectedEventId = payload?.eventId;
        },
        updateOverrides: (payload) => {
            inlineCompletionDebugStore.updateOverrides(
                this._deps.captureService.prepareUserOverrideUpdate(payload.overrides ?? {}),
            );
        },
        selectProfile: (payload) => {
            inlineCompletionDebugStore.updateOverrides(
                this._deps.captureService.createProfileUpdate(payload.profileId),
            );
        },
        setRecordWhenClosed: async (payload) => {
            await this._deps.captureService.setRecordWhenClosed(payload.enabled);
        },
        openCustomPromptDialog: () => {
            this._customPromptDialogOpen = true;
        },
        closeCustomPromptDialog: () => {
            this._customPromptDialogOpen = false;
        },
        saveCustomPrompt: async (payload) => {
            await this._deps.captureService.saveCustomPrompt(payload.value);
            this._customPromptDialogOpen = false;
        },
        resetCustomPrompt: async () => {
            await this._deps.captureService.resetCustomPrompt();
        },
        refreshSchemaContext: async () => {
            await vscode.commands.executeCommand(
                Constants.cmdCopilotInlineCompletionRefreshSchemaContext,
            );
        },
        importSession: async () => {
            const parsed = await this._deps.traceRepository.importSession();
            if (parsed) {
                await this._deps.captureService.persistCustomPrompt(
                    parsed.overrides?.customSystemPrompt ?? null,
                    parsed.customPromptLastSavedAt,
                    false,
                );
            }
            this._selectedEventId = undefined;
        },
        exportSession: async () => {
            await this._deps.traceRepository.exportSession(
                this._deps.captureService.customPromptLastSavedAt,
            );
        },
        saveTraceNow: async () => {
            await this._deps.traceRepository.saveTraceNow();
        },
        sessionsActivated: async () => {
            await this._deps.traceRepository.refreshSessions();
        },
        sessionsRefresh: async () => {
            await this._deps.traceRepository.refreshSessions();
        },
        sessionsToggleTrace: async (payload) => {
            await this._deps.traceRepository.toggleTraceIncluded(payload.fileKey, payload.included);
        },
        sessionsSetAllTraces: async (payload) => {
            await this._deps.traceRepository.setAllTracesIncluded(payload.included);
        },
        sessionsLoadIncluded: async () => {
            await this._deps.traceRepository.loadIncludedSessionTraces();
        },
        sessionsAddFile: async () => {
            await this._deps.traceRepository.addSessionTraceFile();
        },
        sessionsChangeFolder: async () => {
            await this._deps.traceRepository.changeTraceFolder();
        },
        sessionsEnableTraceCollection: async () => {
            await this._deps.traceRepository.enableTraceCollection();
        },
        sessionsSyncToDatabase: async () => {
            await this._deps.traceRepository.showSyncToDatabaseNotImplemented();
        },
        copyEventPayload: async (payload) => {
            await this.copyEventPayload(payload.eventId, payload.kind);
        },
        replayEvent: async (payload) => {
            await this._deps.replayService.replayEvent(payload.eventId);
        },
        replaySessionEvent: async (payload) => {
            await this._deps.replayService.replaySourceEvent(payload.event, {
                showPendingInLive: true,
            });
        },
        openReplayBuilder: () => {
            this._deps.replayService.openBuilder();
        },
        closeReplayBuilder: (payload) => {
            this._deps.replayService.closeBuilder(payload.restoreCart);
        },
        addEventsToReplayCart: (payload) => {
            this._deps.replayService.addEventsToCart(payload.items);
        },
        addSessionToReplayCart: async (payload) => {
            const loaded = await this._deps.traceRepository.getLoadedTrace(payload.fileKey);
            if (loaded) {
                this._deps.replayService.addTraceToCart(loaded.trace, loaded.fileKey);
            }
        },
        replaySessionNow: async (payload) => {
            const loaded = await this._deps.traceRepository.getLoadedTrace(payload.fileKey);
            if (loaded) {
                this._deps.replayService.queueTrace(loaded.trace, loaded.fileKey);
            }
        },
        removeFromReplayCart: (payload) => {
            this._deps.replayService.removeFromCart(payload.snapshotId);
        },
        reorderReplayCart: (payload) => {
            this._deps.replayService.moveCartItem(payload.fromIndex, payload.toIndex);
        },
        clearReplayCart: () => {
            this._deps.replayService.clearCart();
        },
        reverseReplayCart: () => {
            this._deps.replayService.reverseCart();
        },
        setReplayCartOverride: (payload) => {
            this._deps.replayService.setCartOverride(payload.snapshotId, payload.override);
        },
        setReplayCartConfigMode: (payload) => {
            this._deps.replayService.setCartConfigMode(payload.snapshotId, payload.configMode);
        },
        queueReplayCart: (payload) => {
            this._deps.replayService.queueCart(payload.configMode);
        },
        runReplayMatrix: (payload) => {
            this._deps.replayService.runMatrix(payload.profileIds, payload.schemaBudgetProfileIds);
        },
        cancelReplayRun: (payload) => {
            this._deps.replayService.cancelRun(payload.runId);
        },
    };

    constructor(private readonly _deps: InlineCompletionDebugCommandHandlerDeps) {}

    /** Per-viewer UI state for the projector. */
    public get viewState(): InlineCompletionDebugViewerUiState {
        return {
            selectedEventId: this._selectedEventId,
            customPromptDialogOpen: this._customPromptDialogOpen,
        };
    }

    /** Every reducer command name — the record type keeps this exhaustive. */
    public get commandNames(): ReadonlyArray<keyof InlineCompletionDebugReducers> {
        return Object.keys(this._handlers) as Array<keyof InlineCompletionDebugReducers>;
    }

    public async handle<K extends keyof InlineCompletionDebugReducers>(
        name: K,
        payload: InlineCompletionDebugReducers[K],
    ): Promise<void> {
        const handler = this._handlers[name] as (
            payload: InlineCompletionDebugReducers[K],
        ) => void | Promise<void>;
        await handler(payload);
    }

    private async copyEventPayload(
        eventId: string,
        kind: InlineCompletionDebugReducers["copyEventPayload"]["kind"],
    ): Promise<void> {
        const event = inlineCompletionDebugStore.getEvent(eventId);
        if (!event) {
            return;
        }

        let text = "";
        switch (kind) {
            case "id":
                text = event.id;
                break;
            case "json":
                text = JSON.stringify(event, undefined, 2);
                break;
            case "prompt":
                text = event.promptMessages
                    .map((message, index) => `#${index + 1} ${message.role}\n${message.content}`)
                    .join("\n\n");
                break;
            case "systemPrompt":
                text = event.promptMessages[0]?.content ?? "";
                break;
            case "userPrompt":
                text = event.promptMessages[1]?.content ?? "";
                break;
            case "rawResponse":
                text = event.rawResponse;
                break;
            case "sanitizedResponse":
                text = event.sanitizedResponse ?? event.finalCompletionText ?? "";
                break;
        }

        await this._deps.hostServices.writeClipboardText(text);
    }
}

// --- Service set factory -----------------------------------------------------

export interface InlineCompletionDebugServiceSetDeps {
    extensionContext: vscode.ExtensionContext;
    schemaContextService?: CompletionSchemaContextService;
    /** Injectable for tests; defaults to the real vscode-backed host. */
    hostServices?: InlineCompletionDebugHostServices;
}

/** One per-viewer-host bundle of the WI-1.1 domain services. */
export interface InlineCompletionDebugServiceSet {
    captureService: InlineCompletionCaptureService;
    traceRepository: InlineCompletionTraceRepository;
    replayService: InlineCompletionReplayService;
    projector: InlineCompletionDebugStateProjector;
    commandHandler: InlineCompletionDebugCommandHandler;
    dispose(): void;
}

/**
 * Wire the domain services for one viewer host (standalone panel or Debug
 * Console page). Service instances are per host — matching the pre-extraction
 * lifecycles (fresh sessions/replay state per panel) — while the singleton
 * inlineCompletionDebugStore keeps live events and overrides shared across
 * viewers.
 */
export function createInlineCompletionDebugServices(
    deps: InlineCompletionDebugServiceSetDeps,
): InlineCompletionDebugServiceSet {
    const hostServices = deps.hostServices ?? createDefaultInlineCompletionDebugHostServices();
    const captureService = new InlineCompletionCaptureService({
        extensionContext: deps.extensionContext,
        hostServices,
    });
    const traceRepository = new InlineCompletionTraceRepository({
        extensionContext: deps.extensionContext,
        hostServices,
    });
    const replayService = new InlineCompletionReplayService({
        extensionContext: deps.extensionContext,
        schemaContextService: deps.schemaContextService,
        captureService,
    });
    const projector = new InlineCompletionDebugStateProjector({
        captureService,
        traceRepository,
        replayService,
    });
    const commandHandler = new InlineCompletionDebugCommandHandler({
        captureService,
        traceRepository,
        replayService,
        hostServices,
    });
    return {
        captureService,
        traceRepository,
        replayService,
        projector,
        commandHandler,
        dispose: () => {
            replayService.dispose();
            traceRepository.dispose();
            captureService.dispose();
        },
    };
}
