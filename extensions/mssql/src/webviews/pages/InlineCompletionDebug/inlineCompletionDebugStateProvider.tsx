/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * State and actions consumed by the Inline Completion Debug components.
 * ConsoleCompletionsDebugStateProvider supplies live rows, lazy details, and
 * typed commands through the Debug Console transport.
 */

import { createContext, ReactNode, useContext } from "react";
import {
    DcCompletionEventDetailResult,
    DcCompletionEventDetailSource,
    IcDetailSection,
} from "../../../sharedInterfaces/completionsDebugRpc";
import {
    CompletionReplayMode,
    InlineCompletionDebugEvent,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReplayCartAddItem,
    InlineCompletionDebugReplayCartConfigMode,
    InlineCompletionDebugReplayConfig,
    InlineCompletionSchemaBudgetProfileId,
    InlineCompletionDebugWebviewState,
} from "../../../sharedInterfaces/inlineCompletionDebug";

/** WI-3.4: mode selection frozen into a queue/matrix run at queue time. */
export interface InlineCompletionReplayModeSelection {
    replayMode: CompletionReplayMode;
    schemaFallbackToCaptured?: boolean;
}

// ---------------------------------------------------------------------------
// View-model marker for thin-transport hosts
// ---------------------------------------------------------------------------

/**
 * Per-content-family "exists host-side but not in this projection" flags. A
 * host that composes events from thin live rows stamps these on its view
 * models; components fetch the missing sections through getEventDetail and
 * the host clears the flags as content merges in. Events that carry full
 * bodies (loaded session traces) never set this.
 */
export interface InlineCompletionDebugPendingDetail {
    summary: boolean;
    prompt: boolean;
    rawResponse: boolean;
    sanitizedResponse: boolean;
    schema: boolean;
    locals: boolean;
    error: boolean;
}

export type InlineCompletionDebugEventVm = InlineCompletionDebugEvent & {
    pendingDetail?: InlineCompletionDebugPendingDetail;
};

export function getPendingDetail(
    event: InlineCompletionDebugEvent | undefined,
): InlineCompletionDebugPendingDetail | undefined {
    return (event as InlineCompletionDebugEventVm | undefined)?.pendingDetail;
}

// ---------------------------------------------------------------------------
// State store contract (read via useInlineCompletionDebugSelector)
// ---------------------------------------------------------------------------

export interface IcDebugStateStore {
    getSnapshot: () => InlineCompletionDebugWebviewState;
    subscribe: (listener: () => void) => () => void;
}

const IcDebugStateStoreContext = createContext<IcDebugStateStore | undefined>(undefined);

export function useIcDebugStateStore(): IcDebugStateStore {
    const store = useContext(IcDebugStateStoreContext);
    if (!store) {
        throw new Error(
            "useIcDebugStateStore must be used within an Inline Completion Debug provider",
        );
    }
    return store;
}

// ---------------------------------------------------------------------------
// Actions context (dispatch + async detail accessor)
// ---------------------------------------------------------------------------

export interface InlineCompletionDebugContextProps {
    clearEvents: () => void;
    selectEvent: (eventId?: string) => void;
    updateOverrides: (overrides: Partial<InlineCompletionDebugWebviewState["overrides"]>) => void;
    selectProfile: (profileId: InlineCompletionDebugProfileId) => void;
    setRecordWhenClosed: (enabled: boolean) => void;
    openCustomPromptDialog: () => void;
    closeCustomPromptDialog: () => void;
    saveCustomPrompt: (value: string) => void;
    resetCustomPrompt: () => void;
    refreshSchemaContext: () => void;
    importSession: () => void;
    exportSession: () => void;
    saveTraceNow: () => void;
    sessionsActivated: () => void;
    sessionsRefresh: () => void;
    sessionsToggleTrace: (fileKey: string, included: boolean) => void;
    sessionsSetAllTraces: (included: boolean) => void;
    sessionsLoadIncluded: () => void;
    sessionsAddFile: () => void;
    sessionsChangeFolder: () => void;
    sessionsEnableTraceCollection: () => void;
    sessionsSyncToDatabase: () => void;
    replayEvent: (eventId: string) => void;
    replaySessionEvent: (event: InlineCompletionDebugEvent) => void;
    openReplayBuilder: () => void;
    closeReplayBuilder: (restoreCart: boolean) => void;
    addEventsToReplayCart: (items: InlineCompletionDebugReplayCartAddItem[]) => void;
    addSessionToReplayCart: (fileKey: string) => void;
    replaySessionNow: (fileKey: string) => void;
    removeFromReplayCart: (snapshotId: string) => void;
    reorderReplayCart: (fromIndex: number, toIndex: number) => void;
    clearReplayCart: () => void;
    reverseReplayCart: () => void;
    setReplayCartOverride: (
        snapshotId: string,
        override: Partial<InlineCompletionDebugReplayConfig> | null,
    ) => void;
    setReplayCartConfigMode: (
        snapshotId: string,
        configMode: InlineCompletionDebugReplayCartConfigMode,
    ) => void;
    queueReplayCart: (
        configMode?: InlineCompletionDebugReplayCartConfigMode,
        modeSelection?: InlineCompletionReplayModeSelection,
    ) => void;
    runReplayMatrix: (
        profileIds: InlineCompletionDebugProfileId[],
        schemaBudgetProfileIds: InlineCompletionSchemaBudgetProfileId[],
        modeSelection?: InlineCompletionReplayModeSelection,
    ) => void;
    cancelReplayRun: (runId?: string) => void;
    copyEventPayload: (
        eventId: string,
        kind:
            | "id"
            | "json"
            | "prompt"
            | "systemPrompt"
            | "userPrompt"
            | "rawResponse"
            | "sanitizedResponse",
    ) => void;
    /**
     * Section-lazy event detail. Thin-transport hosts fetch over
     * dc/completionEventDetail (and merge the content into their view models
     * so pendingDetail flags clear).
     */
    getEventDetail: (
        source: DcCompletionEventDetailSource,
        eventId: string,
        sections: IcDetailSection[],
    ) => Promise<DcCompletionEventDetailResult>;
}

const InlineCompletionDebugContext = createContext<InlineCompletionDebugContextProps | undefined>(
    undefined,
);

export function useInlineCompletionDebugContext(): InlineCompletionDebugContextProps {
    const context = useContext(InlineCompletionDebugContext);
    if (!context) {
        throw new Error(
            "useInlineCompletionDebugContext must be used within an Inline Completion Debug provider",
        );
    }
    return context;
}

/**
 * Bridge state and actions around the completion viewer component tree.
 */
export function InlineCompletionDebugProviderBridge({
    store,
    actions,
    children,
}: {
    store: IcDebugStateStore;
    actions: InlineCompletionDebugContextProps;
    children: ReactNode;
}) {
    return (
        <IcDebugStateStoreContext.Provider value={store}>
            <InlineCompletionDebugContext.Provider value={actions}>
                {children}
            </InlineCompletionDebugContext.Provider>
        </IcDebugStateStoreContext.Provider>
    );
}
