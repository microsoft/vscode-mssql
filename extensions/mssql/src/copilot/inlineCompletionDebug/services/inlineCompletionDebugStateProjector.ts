/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * State projector for Inline Completion Debug (final plan WI-1.1, addendum
 * §6.1): builds the full InlineCompletionDebugWebviewState from the domain
 * services plus the singleton store. This is the ONLY implementation of the
 * webview state assembly — the standalone panel and the Debug Console host
 * both project through it (the console's forked buildState is gone).
 *
 * Per-viewer UI state (selected event, custom-prompt dialog visibility) is
 * owned by each viewer's command handler and passed in per projection.
 */

import {
    automaticTriggerDebounceMs,
    continuationModeMaxTokens,
    intentModeMaxTokens,
} from "../../sqlInlineCompletionProvider";
import {
    getInlineCompletionDebugPresetProfile,
    inlineCompletionDebugProfileOptions,
} from "../inlineCompletionDebugProfiles";
import { getCompletionsJournalBinding } from "../completionsJournalBinding";
import { inlineCompletionDebugStore } from "../inlineCompletionDebugStore";
import { getTraceCaptureEnabledSetting } from "../tracePersistence";
import {
    InlineCompletionDebugModelOption,
    InlineCompletionDebugReplayState,
    InlineCompletionDebugSessionsState,
    InlineCompletionDebugWebviewState,
} from "../../../sharedInterfaces/inlineCompletionDebug";
import { DEFAULT_CUSTOM_PROMPT } from "./inlineCompletionDebugConstants";
import {
    getConfiguredContinuationModelSelector,
    getConfiguredEnabledCategories,
    getConfiguredIncludeSqlDiagnostics,
    getConfiguredInlineCompletionProfileId,
    getConfiguredModelSelector,
    getConfiguredSchemaContextSetting,
    getConfiguredUseSchemaContext,
    getRecordWhenClosedSetting,
    InlineCompletionCaptureService,
    mergeSchemaContextDefaults,
    pickConfiguredModelOption,
    pickDefaultModelOption,
} from "./inlineCompletionCaptureService";
import { InlineCompletionTraceRepository } from "./inlineCompletionTraceRepository";
import { InlineCompletionReplayService } from "./inlineCompletionReplayService";

/** Per-viewer UI state owned by each viewer's command handler. */
export interface InlineCompletionDebugViewerUiState {
    selectedEventId: string | undefined;
    customPromptDialogOpen: boolean;
}

export interface InlineCompletionDebugStateProjectorDeps {
    captureService: InlineCompletionCaptureService;
    traceRepository: InlineCompletionTraceRepository;
    replayService: InlineCompletionReplayService;
}

export class InlineCompletionDebugStateProjector {
    constructor(private readonly _deps: InlineCompletionDebugStateProjectorDeps) {}

    public buildState(view: InlineCompletionDebugViewerUiState): InlineCompletionDebugWebviewState {
        return createState({
            availableModels: this._deps.captureService.availableModels,
            effectiveDefaultModelOption: this._deps.captureService.effectiveDefaultModelOption,
            sessions: {
                ...this._deps.traceRepository.getSessionsState(),
                traceCaptureEnabled: getTraceCaptureEnabledSetting(),
            },
            replay: this._deps.replayService.getState(),
            selectedEventId: view.selectedEventId,
            customPromptDialogOpen: view.customPromptDialogOpen,
            customPromptValue: this._deps.captureService.savedCustomPromptValue,
            customPromptLastSavedAt: this._deps.captureService.customPromptLastSavedAt,
        });
    }
}

function createState(options: {
    availableModels: InlineCompletionDebugModelOption[];
    effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    sessions: InlineCompletionDebugSessionsState;
    replay: InlineCompletionDebugReplayState;
    selectedEventId: string | undefined;
    customPromptDialogOpen: boolean;
    customPromptValue: string | null;
    customPromptLastSavedAt: number | undefined;
}): InlineCompletionDebugWebviewState {
    const overrides = inlineCompletionDebugStore.getOverrides();
    const configuredProfileId = getConfiguredInlineCompletionProfileId();
    const effectiveProfileId = overrides.profileId ?? configuredProfileId;
    const profile = getInlineCompletionDebugPresetProfile(effectiveProfileId);
    const configuredModelSelector = getConfiguredModelSelector();
    const configuredContinuationModelSelector = getConfiguredContinuationModelSelector();
    const continuationModelPreference = profile?.continuationModelPreference;
    const effectiveOption =
        (profile ? undefined : options.effectiveDefaultModelOption) ??
        pickDefaultModelOption(
            options.availableModels,
            configuredModelSelector,
            profile?.modelPreference,
        );
    const effectiveContinuationOption = configuredContinuationModelSelector
        ? pickConfiguredModelOption(
              options.availableModels,
              configuredContinuationModelSelector,
              continuationModelPreference ?? profile?.modelPreference,
          )
        : continuationModelPreference
          ? pickDefaultModelOption(options.availableModels, undefined, continuationModelPreference)
          : undefined;
    const configuredSchemaContext = getConfiguredSchemaContextSetting();
    return {
        events: inlineCompletionDebugStore.getEvents(),
        liveEvictedCount: inlineCompletionDebugStore.evictedEventCount,
        overrides,
        defaults: {
            configuredModelSelector,
            configuredContinuationModelSelector,
            configuredProfileId,
            effectiveProfileId,
            effectiveModelSelector: effectiveOption?.selector,
            effectiveModelLabel: effectiveOption?.label,
            effectiveContinuationModelSelector: effectiveContinuationOption?.selector,
            effectiveContinuationModelLabel: effectiveContinuationOption?.label,
            useSchemaContext: profile?.useSchemaContext ?? getConfiguredUseSchemaContext(),
            includeSqlDiagnostics: getConfiguredIncludeSqlDiagnostics(),
            debounceMs: profile?.debounceMs ?? automaticTriggerDebounceMs,
            continuationMaxTokens: continuationModeMaxTokens,
            intentMaxTokens: intentModeMaxTokens,
            enabledCategories: profile
                ? [...profile.enabledCategories]
                : getConfiguredEnabledCategories(),
            allowAutomaticTriggers: true,
            schemaContext: mergeSchemaContextDefaults(
                configuredSchemaContext,
                profile?.schemaContext,
            ),
        },
        profiles: [...inlineCompletionDebugProfileOptions],
        availableModels: options.availableModels,
        selectedEventId: options.selectedEventId,
        recordWhenClosed: getRecordWhenClosedSetting(),
        sensitiveCaptureActive: isSensitiveCaptureActive(),
        customPrompt: {
            dialogOpen: options.customPromptDialogOpen,
            savedValue: options.customPromptValue,
            defaultValue: DEFAULT_CUSTOM_PROMPT,
            lastSavedAt: options.customPromptLastSavedAt,
        },
        sessions: options.sessions,
        replay: options.replay,
    };
}

/**
 * §9.4 sensitive-capture badge groundwork (WI-2.8): true while the capture
 * journal is actively persisting FULL-fidelity content (prompts, responses)
 * for the live stream. contentRedacted/digestOnly streams — and a journal
 * that is off — never claim it.
 */
function isSensitiveCaptureActive(): boolean {
    const binding = getCompletionsJournalBinding();
    return binding?.isActive === true && binding.activePolicy?.fidelity === "fullLocal";
}
