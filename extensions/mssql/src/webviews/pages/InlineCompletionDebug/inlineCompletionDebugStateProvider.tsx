/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, ReactNode, useCallback, useContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    InlineCompletionDebugReducers,
    InlineCompletionDebugWebviewState,
} from "../../../sharedInterfaces/inlineCompletionDebug";

export interface InlineCompletionDebugContextProps {
    clearEvents: () => void;
    selectEvent: (eventId?: string) => void;
    updateOverrides: (overrides: Partial<InlineCompletionDebugWebviewState["overrides"]>) => void;
    setRecordWhenClosed: (enabled: boolean) => void;
    openCustomPromptDialog: () => void;
    closeCustomPromptDialog: () => void;
    saveCustomPrompt: (value: string) => void;
    resetCustomPrompt: () => void;
    importSession: () => void;
    exportSession: () => void;
    replayEvent: (eventId: string) => void;
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

const InlineCompletionDebugContext = createContext<InlineCompletionDebugContextProps | undefined>(
    undefined,
);

export const InlineCompletionDebugStateProvider = ({ children }: { children: ReactNode }) => {
    const { extensionRpc } = useVscodeWebview<
        InlineCompletionDebugWebviewState,
        InlineCompletionDebugReducers
    >();

    const clearEvents = useCallback(() => {
        extensionRpc.action("clearEvents", {});
    }, [extensionRpc]);

    const selectEvent = useCallback(
        (eventId?: string) => {
            extensionRpc.action("selectEvent", { eventId });
        },
        [extensionRpc],
    );

    const updateOverrides = useCallback(
        (overrides: Partial<InlineCompletionDebugWebviewState["overrides"]>) => {
            extensionRpc.action("updateOverrides", { overrides });
        },
        [extensionRpc],
    );

    const setRecordWhenClosed = useCallback(
        (enabled: boolean) => {
            extensionRpc.action("setRecordWhenClosed", { enabled });
        },
        [extensionRpc],
    );

    const openCustomPromptDialog = useCallback(() => {
        extensionRpc.action("openCustomPromptDialog", {});
    }, [extensionRpc]);

    const closeCustomPromptDialog = useCallback(() => {
        extensionRpc.action("closeCustomPromptDialog", {});
    }, [extensionRpc]);

    const saveCustomPrompt = useCallback(
        (value: string) => {
            extensionRpc.action("saveCustomPrompt", { value });
        },
        [extensionRpc],
    );

    const resetCustomPrompt = useCallback(() => {
        extensionRpc.action("resetCustomPrompt", {});
    }, [extensionRpc]);

    const importSession = useCallback(() => {
        extensionRpc.action("importSession", {});
    }, [extensionRpc]);

    const exportSession = useCallback(() => {
        extensionRpc.action("exportSession", {});
    }, [extensionRpc]);

    const replayEvent = useCallback(
        (eventId: string) => {
            extensionRpc.action("replayEvent", { eventId });
        },
        [extensionRpc],
    );

    const copyEventPayload = useCallback(
        (
            eventId: string,
            kind:
                | "id"
                | "json"
                | "prompt"
                | "systemPrompt"
                | "userPrompt"
                | "rawResponse"
                | "sanitizedResponse",
        ) => {
            extensionRpc.action("copyEventPayload", { eventId, kind });
        },
        [extensionRpc],
    );

    return (
        <InlineCompletionDebugContext.Provider
            value={{
                clearEvents,
                selectEvent,
                updateOverrides,
                setRecordWhenClosed,
                openCustomPromptDialog,
                closeCustomPromptDialog,
                saveCustomPrompt,
                resetCustomPrompt,
                importSession,
                exportSession,
                replayEvent,
                copyEventPayload,
            }}>
            {children}
        </InlineCompletionDebugContext.Provider>
    );
};

export function useInlineCompletionDebugContext(): InlineCompletionDebugContextProps {
    const context = useContext(InlineCompletionDebugContext);
    if (!context) {
        throw new Error(
            "useInlineCompletionDebugContext must be used within InlineCompletionDebugStateProvider",
        );
    }
    return context;
}
