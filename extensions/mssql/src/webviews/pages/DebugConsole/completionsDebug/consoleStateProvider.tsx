/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FORKED from webviews/pages/InlineCompletionDebug/inlineCompletionDebugStateProvider.tsx —
// console-hosted copy; the standalone panel remains the reference until replay parity is
// confirmed, then it gets deleted.
//
// Same context contract (hook name + shape) as the standalone provider so the forked
// components only change their import path. Instead of the reducer framework, actions ride
// the Debug Console's request channel (dc/icDebugAction) and state is pulled on demand
// (dc/icDebugState), re-pulled whenever the host pokes us with dc/icDebugChanged.

import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
} from "react";
import {
    DcIcDebugActionRequest,
    DcIcDebugChangedNotification,
    DcIcDebugStateRequest,
} from "../../../../sharedInterfaces/debugConsole";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReplayCartAddItem,
    InlineCompletionDebugReplayCartConfigMode,
    InlineCompletionDebugReplayConfig,
    InlineCompletionSchemaBudgetProfileId,
    InlineCompletionDebugWebviewState,
} from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useDc } from "../state";

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
}

/** Snapshot/subscribe store for the pulled state — the forked selector reads this. */
export interface ConsoleIcDebugStateStore {
    getSnapshot: () => InlineCompletionDebugWebviewState;
    subscribe: (listener: () => void) => () => void;
}

const InlineCompletionDebugContext = createContext<InlineCompletionDebugContextProps | undefined>(
    undefined,
);

const ConsoleIcDebugStateStoreContext = createContext<ConsoleIcDebugStateStore | undefined>(
    undefined,
);

/** Rendered until the first dc/icDebugState pull resolves. */
function createInitialClientState(): InlineCompletionDebugWebviewState {
    return {
        events: [],
        overrides: {
            profileId: null,
            modelSelector: null,
            continuationModelSelector: null,
            useSchemaContext: null,
            includeSqlDiagnostics: null,
            debounceMs: null,
            maxTokens: null,
            enabledCategories: null,
            forceIntentMode: null,
            customSystemPrompt: null,
            allowAutomaticTriggers: null,
            schemaContext: null,
        },
        defaults: {
            useSchemaContext: false,
            includeSqlDiagnostics: true,
            debounceMs: 0,
            continuationMaxTokens: 0,
            intentMaxTokens: 0,
            enabledCategories: [],
            allowAutomaticTriggers: true,
            schemaContext: null,
        },
        profiles: [],
        availableModels: [],
        recordWhenClosed: false,
        customPrompt: {
            dialogOpen: false,
            savedValue: null,
            defaultValue: "",
        },
        sessions: {
            traceFolder: "",
            traceCaptureEnabled: false,
            traceIndex: [],
            loadedTraces: [],
            loading: false,
        },
        replay: {
            cart: [],
            runs: [],
            queueRows: [],
            builderOpen: false,
        },
    };
}

export const ConsoleCompletionsDebugStateProvider = ({ children }: { children: ReactNode }) => {
    const { rpc } = useDc();
    const stateRef = useRef<InlineCompletionDebugWebviewState>(createInitialClientState());
    const listenersRef = useRef(new Set<() => void>());
    const mountedRef = useRef(true);

    const applyState = useCallback((next: InlineCompletionDebugWebviewState) => {
        if (!mountedRef.current) {
            return;
        }
        stateRef.current = next;
        listenersRef.current.forEach((listener) => listener());
    }, []);

    const refresh = useCallback(async () => {
        const next = await rpc.sendRequest(DcIcDebugStateRequest.type, undefined);
        applyState(next);
    }, [rpc, applyState]);

    const send = useCallback(
        (name: string, payload?: unknown) => {
            void rpc
                .sendRequest(DcIcDebugActionRequest.type, { name, payload })
                .then((next) => applyState(next));
        },
        [rpc, applyState],
    );

    useEffect(() => {
        mountedRef.current = true;
        // Re-registering on remount replaces the previous (guarded) handler on
        // the shared connection — same pattern DcProvider uses for its own
        // notifications.
        rpc.onNotification(DcIcDebugChangedNotification.type, () => {
            if (mountedRef.current) {
                void refresh();
            }
        });
        void refresh();
        return () => {
            mountedRef.current = false;
        };
    }, [rpc, refresh]);

    const store = useMemo<ConsoleIcDebugStateStore>(
        () => ({
            getSnapshot: () => stateRef.current,
            subscribe: (listener: () => void) => {
                listenersRef.current.add(listener);
                return () => {
                    listenersRef.current.delete(listener);
                };
            },
        }),
        [],
    );

    const actions = useMemo<InlineCompletionDebugContextProps>(
        () => ({
            clearEvents: () => send("clearEvents", {}),
            selectEvent: (eventId?: string) => send("selectEvent", { eventId }),
            updateOverrides: (overrides) => send("updateOverrides", { overrides }),
            selectProfile: (profileId) => send("selectProfile", { profileId }),
            setRecordWhenClosed: (enabled) => send("setRecordWhenClosed", { enabled }),
            openCustomPromptDialog: () => send("openCustomPromptDialog", {}),
            closeCustomPromptDialog: () => send("closeCustomPromptDialog", {}),
            saveCustomPrompt: (value) => send("saveCustomPrompt", { value }),
            resetCustomPrompt: () => send("resetCustomPrompt", {}),
            refreshSchemaContext: () => send("refreshSchemaContext", {}),
            importSession: () => send("importSession", {}),
            exportSession: () => send("exportSession", {}),
            saveTraceNow: () => send("saveTraceNow", {}),
            sessionsActivated: () => send("sessionsActivated", {}),
            sessionsRefresh: () => send("sessionsRefresh", {}),
            sessionsToggleTrace: (fileKey, included) =>
                send("sessionsToggleTrace", { fileKey, included }),
            sessionsSetAllTraces: (included) => send("sessionsSetAllTraces", { included }),
            sessionsLoadIncluded: () => send("sessionsLoadIncluded", {}),
            sessionsAddFile: () => send("sessionsAddFile", {}),
            sessionsChangeFolder: () => send("sessionsChangeFolder", {}),
            sessionsEnableTraceCollection: () => send("sessionsEnableTraceCollection", {}),
            sessionsSyncToDatabase: () => send("sessionsSyncToDatabase", {}),
            replayEvent: (eventId) => send("replayEvent", { eventId }),
            replaySessionEvent: (event) => send("replaySessionEvent", { event }),
            openReplayBuilder: () => send("openReplayBuilder", {}),
            closeReplayBuilder: (restoreCart) => send("closeReplayBuilder", { restoreCart }),
            addEventsToReplayCart: (items) => send("addEventsToReplayCart", { items }),
            addSessionToReplayCart: (fileKey) => send("addSessionToReplayCart", { fileKey }),
            replaySessionNow: (fileKey) => send("replaySessionNow", { fileKey }),
            removeFromReplayCart: (snapshotId) => send("removeFromReplayCart", { snapshotId }),
            reorderReplayCart: (fromIndex, toIndex) =>
                send("reorderReplayCart", { fromIndex, toIndex }),
            clearReplayCart: () => send("clearReplayCart", {}),
            reverseReplayCart: () => send("reverseReplayCart", {}),
            setReplayCartOverride: (snapshotId, override) =>
                send("setReplayCartOverride", { snapshotId, override }),
            setReplayCartConfigMode: (snapshotId, configMode) =>
                send("setReplayCartConfigMode", { snapshotId, configMode }),
            queueReplayCart: (configMode) =>
                send("queueReplayCart", configMode ? { configMode } : {}),
            runReplayMatrix: (profileIds, schemaBudgetProfileIds) =>
                send("runReplayMatrix", { profileIds, schemaBudgetProfileIds }),
            cancelReplayRun: (runId) => send("cancelReplayRun", { runId }),
            copyEventPayload: (eventId, kind) => send("copyEventPayload", { eventId, kind }),
        }),
        [send],
    );

    return (
        <ConsoleIcDebugStateStoreContext.Provider value={store}>
            <InlineCompletionDebugContext.Provider value={actions}>
                {children}
            </InlineCompletionDebugContext.Provider>
        </ConsoleIcDebugStateStoreContext.Provider>
    );
};

export function useInlineCompletionDebugContext(): InlineCompletionDebugContextProps {
    const context = useContext(InlineCompletionDebugContext);
    if (!context) {
        throw new Error(
            "useInlineCompletionDebugContext must be used within ConsoleCompletionsDebugStateProvider",
        );
    }
    return context;
}

export function useConsoleIcDebugStateStore(): ConsoleIcDebugStateStore {
    const store = useContext(ConsoleIcDebugStateStoreContext);
    if (!store) {
        throw new Error(
            "useConsoleIcDebugStateStore must be used within ConsoleCompletionsDebugStateProvider",
        );
    }
    return store;
}
