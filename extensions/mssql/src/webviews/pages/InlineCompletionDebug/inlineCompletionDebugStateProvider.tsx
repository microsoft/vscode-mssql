/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The ONE provider contract every Inline Completion Debug component consumes
 * (final plan WI-1.4): a state store (snapshot + subscribe, read through
 * useInlineCompletionDebugSelector) plus an actions context (dispatch + the
 * async section-lazy getEventDetail accessor). Two implementations exist:
 *
 * - InlineCompletionDebugStateProvider (this file): the standalone panel —
 *   full local state via the reducer-framework webview snapshot, actions via
 *   extensionRpc.action, detail resolved synchronously from local state.
 * - ConsoleCompletionsDebugStateProvider (DebugConsole/completionsDebug/):
 *   the Debug Console page — thin typed RPC transport, live rows + lazy
 *   detail, commands over dc/icDebugCommand.
 *
 * Components import ONLY from here and from the selector module, so there are
 * no forked component copies anywhere.
 */

import { createContext, ReactNode, useContext, useMemo } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    DcCompletionEventDetailResult,
    DcCompletionEventDetailSource,
    IcDetailSection,
} from "../../../sharedInterfaces/completionsDebugRpc";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReplayCartAddItem,
    InlineCompletionDebugReplayCartConfigMode,
    InlineCompletionDebugReplayConfig,
    InlineCompletionDebugReducers,
    InlineCompletionSchemaBudgetProfileId,
    InlineCompletionDebugWebviewState,
} from "../../../sharedInterfaces/inlineCompletionDebug";

// ---------------------------------------------------------------------------
// View-model marker for thin-transport hosts
// ---------------------------------------------------------------------------

/**
 * Per-content-family "exists host-side but not in this projection" flags. A
 * host that composes events from thin live rows stamps these on its view
 * models; components fetch the missing sections through getEventDetail and
 * the host clears the flags as content merges in. Events that carry full
 * bodies (the standalone panel, loaded session traces) never set this.
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
    queueReplayCart: (configMode?: InlineCompletionDebugReplayCartConfigMode) => void;
    runReplayMatrix: (
        profileIds: InlineCompletionDebugProfileId[],
        schemaBudgetProfileIds: InlineCompletionSchemaBudgetProfileId[],
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
     * so pendingDetail flags clear); the standalone host resolves
     * synchronously from local state.
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
 * Bridge both contexts for an implementation. Providers (standalone below,
 * console in DebugConsole/completionsDebug/consoleStateProvider.tsx) render
 * this around the shared component tree.
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

// ---------------------------------------------------------------------------
// Local (webview-side) section projection — the standalone detail accessor
// ---------------------------------------------------------------------------

/**
 * Mirror of the host's per-section slices for events already held in full in
 * this webview. Used by the standalone provider (whose events always carry
 * full bodies) so getEventDetail behaves identically across hosts.
 */
export function projectLocalEventDetailSections(
    event: InlineCompletionDebugEvent,
    sections: IcDetailSection[],
): Partial<Record<IcDetailSection, unknown>> {
    const result: Partial<Record<IcDetailSection, unknown>> = {};
    for (const section of new Set(sections)) {
        switch (section) {
            case "summary":
                result[section] = {
                    modelVendor: event.modelVendor,
                    modelId: event.modelId,
                    modelFamily: event.modelFamily,
                    explicitFromUser: event.explicitFromUser,
                    inferredSystemQuery: event.inferredSystemQuery,
                    usedSchemaContext: event.usedSchemaContext,
                    schemaObjectCount: event.schemaObjectCount,
                    schemaSystemObjectCount: event.schemaSystemObjectCount,
                    schemaForeignKeyCount: event.schemaForeignKeyCount,
                    link: event.link,
                    tags: event.tags,
                };
                break;
            case "prompt":
                result[section] = event.promptMessages;
                break;
            case "rawResponse":
                result[section] = event.rawResponse;
                break;
            case "sanitizedResponse":
                result[section] = {
                    sanitizedResponse: event.sanitizedResponse,
                    finalCompletionText: event.finalCompletionText,
                };
                break;
            case "schemaContext":
                result[section] = event.schemaContextFormatted;
                break;
            case "locals":
                result[section] = event.locals;
                break;
            case "telemetry":
                result[section] = {
                    latencyMs: event.latencyMs,
                    inputTokens: event.inputTokens,
                    outputTokens: event.outputTokens,
                };
                break;
            case "error":
                result[section] = event.error;
                break;
            case "overrides":
                result[section] = event.overridesApplied;
                break;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Standalone implementation (the legacy panel — unchanged behavior)
// ---------------------------------------------------------------------------

export const InlineCompletionDebugStateProvider = ({ children }: { children: ReactNode }) => {
    const ctx = useVscodeWebview<
        InlineCompletionDebugWebviewState,
        InlineCompletionDebugReducers
    >();
    const { extensionRpc } = ctx;

    const store = useMemo<IcDebugStateStore>(
        () => ({
            getSnapshot: () => ctx.getSnapshot() || ({} as InlineCompletionDebugWebviewState),
            subscribe: (listener) => ctx.subscribe(listener),
        }),
        [ctx],
    );

    const actions = useMemo<InlineCompletionDebugContextProps>(
        () => ({
            clearEvents: () => extensionRpc.action("clearEvents", {}),
            selectEvent: (eventId) => extensionRpc.action("selectEvent", { eventId }),
            updateOverrides: (overrides) => extensionRpc.action("updateOverrides", { overrides }),
            selectProfile: (profileId) => extensionRpc.action("selectProfile", { profileId }),
            setRecordWhenClosed: (enabled) =>
                extensionRpc.action("setRecordWhenClosed", { enabled }),
            openCustomPromptDialog: () => extensionRpc.action("openCustomPromptDialog", {}),
            closeCustomPromptDialog: () => extensionRpc.action("closeCustomPromptDialog", {}),
            saveCustomPrompt: (value) => extensionRpc.action("saveCustomPrompt", { value }),
            resetCustomPrompt: () => extensionRpc.action("resetCustomPrompt", {}),
            refreshSchemaContext: () => extensionRpc.action("refreshSchemaContext", {}),
            importSession: () => extensionRpc.action("importSession", {}),
            exportSession: () => extensionRpc.action("exportSession", {}),
            saveTraceNow: () => extensionRpc.action("saveTraceNow", {}),
            sessionsActivated: () => extensionRpc.action("sessionsActivated", {}),
            sessionsRefresh: () => extensionRpc.action("sessionsRefresh", {}),
            sessionsToggleTrace: (fileKey, included) =>
                extensionRpc.action("sessionsToggleTrace", { fileKey, included }),
            sessionsSetAllTraces: (included) =>
                extensionRpc.action("sessionsSetAllTraces", { included }),
            sessionsLoadIncluded: () => extensionRpc.action("sessionsLoadIncluded", {}),
            sessionsAddFile: () => extensionRpc.action("sessionsAddFile", {}),
            sessionsChangeFolder: () => extensionRpc.action("sessionsChangeFolder", {}),
            sessionsEnableTraceCollection: () =>
                extensionRpc.action("sessionsEnableTraceCollection", {}),
            sessionsSyncToDatabase: () => extensionRpc.action("sessionsSyncToDatabase", {}),
            replayEvent: (eventId) => extensionRpc.action("replayEvent", { eventId }),
            replaySessionEvent: (event) => extensionRpc.action("replaySessionEvent", { event }),
            openReplayBuilder: () => extensionRpc.action("openReplayBuilder", {}),
            closeReplayBuilder: (restoreCart) =>
                extensionRpc.action("closeReplayBuilder", { restoreCart }),
            addEventsToReplayCart: (items) =>
                extensionRpc.action("addEventsToReplayCart", { items }),
            addSessionToReplayCart: (fileKey) =>
                extensionRpc.action("addSessionToReplayCart", { fileKey }),
            replaySessionNow: (fileKey) => extensionRpc.action("replaySessionNow", { fileKey }),
            removeFromReplayCart: (snapshotId) =>
                extensionRpc.action("removeFromReplayCart", { snapshotId }),
            reorderReplayCart: (fromIndex, toIndex) =>
                extensionRpc.action("reorderReplayCart", { fromIndex, toIndex }),
            clearReplayCart: () => extensionRpc.action("clearReplayCart", {}),
            reverseReplayCart: () => extensionRpc.action("reverseReplayCart", {}),
            setReplayCartOverride: (snapshotId, override) =>
                extensionRpc.action("setReplayCartOverride", { snapshotId, override }),
            setReplayCartConfigMode: (snapshotId, configMode) =>
                extensionRpc.action("setReplayCartConfigMode", { snapshotId, configMode }),
            queueReplayCart: (configMode) =>
                extensionRpc.action("queueReplayCart", configMode ? { configMode } : {}),
            runReplayMatrix: (profileIds, schemaBudgetProfileIds) =>
                extensionRpc.action("runReplayMatrix", { profileIds, schemaBudgetProfileIds }),
            cancelReplayRun: (runId) => extensionRpc.action("cancelReplayRun", { runId }),
            copyEventPayload: (eventId, kind) =>
                extensionRpc.action("copyEventPayload", { eventId, kind }),
            // Full bodies are always local here: resolve synchronously from
            // the snapshot (live events, replay queue rows, loaded traces).
            getEventDetail: (source, eventId, sections) => {
                const state = store.getSnapshot();
                const event =
                    source.kind === "trace"
                        ? state.sessions?.loadedTraces
                              ?.find((loaded) => loaded.fileKey === source.fileKey)
                              ?.trace.events.find(
                                  (candidate) =>
                                      candidate.id === eventId ||
                                      candidate.link?.captureEventId === eventId,
                              )
                        : (state.events?.find(
                              (candidate) =>
                                  candidate.id === eventId ||
                                  candidate.link?.captureEventId === eventId,
                          ) ??
                          state.replay?.queueRows?.find((row) => row.event.id === eventId)?.event);
                if (!event) {
                    return Promise.resolve({ found: false, revision: 0, sections: {} });
                }
                return Promise.resolve({
                    found: true,
                    revision: 0,
                    sections: projectLocalEventDetailSections(event, sections),
                });
            },
        }),
        [extensionRpc, store],
    );

    return (
        <InlineCompletionDebugProviderBridge store={store} actions={actions}>
            {children}
        </InlineCompletionDebugProviderBridge>
    );
};
