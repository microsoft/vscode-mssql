/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash/debounce";
import {
    normalizeQuickQueries,
    QuickQueryExecutionMode,
    QuickQuerySlot,
    SaveShortcutsConfigurationChangedSections,
    SaveShortcutsConfigurationPayload,
    ShortcutsConfigurationContextProps,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import { SaveState } from "./shortcutComponents";

function buildPayload(
    quickQueries: QuickQuerySlot[],
    quickQueryKeybindings: Record<string, string>,
    webviewShortcuts: Record<string, string>,
    changedSections?: SaveShortcutsConfigurationChangedSections,
): SaveShortcutsConfigurationPayload {
    return {
        quickQueries,
        quickQueryKeybindings,
        webviewShortcuts,
        changedSections,
    };
}

function getPayloadDataKey(payload: SaveShortcutsConfigurationPayload): string {
    const changedSections = payload.changedSections;
    return JSON.stringify({
        quickQueries:
            !changedSections || changedSections.quickQueries ? payload.quickQueries : undefined,
        quickQueryKeybindings:
            !changedSections || changedSections.quickQueryKeybindings
                ? payload.quickQueryKeybindings
                : undefined,
        webviewShortcuts:
            !changedSections || changedSections.webviewShortcuts
                ? payload.webviewShortcuts
                : undefined,
    });
}

export interface UseShortcutsConfigurationSaveParams {
    context: ShortcutsConfigurationContextProps | undefined;
    stateQuickQueries: QuickQuerySlot[];
    stateQuickQueryKeybindings: Record<string, string>;
    stateWebviewShortcuts: Record<string, string>;
    stateErrorMessage: string | undefined;
    stateIsSaving: boolean | undefined;
}

export interface UseShortcutsConfigurationSaveResult {
    quickQueries: QuickQuerySlot[];
    quickQueryKeybindings: Record<string, string>;
    webviewShortcuts: Record<string, string>;
    saveState: SaveState;
    updateQuickQuery: (index: number, value: QuickQuerySlot) => void;
    updateQuickQueryShortcut: (commandId: string, value: string) => void;
    clearQuickQueryValues: (index: number, commandId: string) => void;
    updateWebviewShortcut: (action: WebviewAction, value: string) => void;
    saveAndClose: () => Promise<void>;
}

/**
 * Owns the debounced, conflict-aware persistence of the shortcuts configuration: it mirrors the
 * incoming webview state locally, reconciles save responses with optimistic local edits, and
 * exposes high-level mutators that schedule debounced saves.
 */
export function useShortcutsConfigurationSave({
    context,
    stateQuickQueries,
    stateQuickQueryKeybindings,
    stateWebviewShortcuts,
    stateErrorMessage,
    stateIsSaving,
}: UseShortcutsConfigurationSaveParams): UseShortcutsConfigurationSaveResult {
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [quickQueries, setQuickQueries] = useState<QuickQuerySlot[]>(() =>
        normalizeQuickQueries(stateQuickQueries),
    );
    const [quickQueryKeybindings, setQuickQueryKeybindings] = useState<Record<string, string>>(
        stateQuickQueryKeybindings ?? {},
    );
    const [webviewShortcuts, setWebviewShortcuts] = useState<Record<string, string>>(
        stateWebviewShortcuts ?? {},
    );
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastSavedPayloadRef = useRef("");
    const pendingPayloadRef = useRef("");
    const pendingChangedSectionsRef = useRef<SaveShortcutsConfigurationChangedSections | undefined>(
        undefined,
    );
    const pendingSaveVersionRef = useRef(0);
    const localChangeVersionRef = useRef(0);
    const scheduledPayloadRef = useRef<SaveShortcutsConfigurationPayload | undefined>(undefined);
    const activeSaveRef = useRef<Promise<void> | undefined>(undefined);
    const hasLocalChangesRef = useRef(false);

    useEffect(() => {
        if (stateIsSaving) {
            return;
        }

        const normalizedQuickQueries = normalizeQuickQueries(stateQuickQueries);
        const normalizedKeybindings = stateQuickQueryKeybindings ?? {};
        const normalizedShortcuts = stateWebviewShortcuts ?? {};
        const statePayloadKey = getPayloadDataKey(
            buildPayload(
                normalizedQuickQueries,
                normalizedKeybindings,
                normalizedShortcuts,
                pendingChangedSectionsRef.current,
            ),
        );

        const isExpectedSaveResponse =
            pendingPayloadRef.current.length > 0 &&
            pendingPayloadRef.current === statePayloadKey &&
            pendingSaveVersionRef.current === localChangeVersionRef.current;

        if (!hasLocalChangesRef.current || isExpectedSaveResponse || stateErrorMessage) {
            setQuickQueries(normalizedQuickQueries);
            setQuickQueryKeybindings(normalizedKeybindings);
            setWebviewShortcuts(normalizedShortcuts);
        }

        if (stateErrorMessage) {
            setSaveState("idle");
            pendingPayloadRef.current = "";
            pendingChangedSectionsRef.current = undefined;
            return;
        }

        if (isExpectedSaveResponse) {
            hasLocalChangesRef.current = false;
            pendingPayloadRef.current = "";
            pendingChangedSectionsRef.current = undefined;
            lastSavedPayloadRef.current = statePayloadKey;
            setSaveState("saved");
            if (savedTimerRef.current) {
                clearTimeout(savedTimerRef.current);
            }
            savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2500);
        } else if (!hasLocalChangesRef.current) {
            lastSavedPayloadRef.current = statePayloadKey;
        }
    }, [
        stateErrorMessage,
        stateIsSaving,
        stateQuickQueries,
        stateQuickQueryKeybindings,
        stateWebviewShortcuts,
    ]);

    const dispatchSave = useCallback(
        async (payload: SaveShortcutsConfigurationPayload, payloadDataKey: string) => {
            if (!context) {
                return;
            }

            const previousSave = activeSaveRef.current;
            if (previousSave) {
                await previousSave.catch(() => undefined);
            }

            pendingPayloadRef.current = payloadDataKey;
            pendingChangedSectionsRef.current = payload.changedSections;
            pendingSaveVersionRef.current = localChangeVersionRef.current;
            const savePromise = context.saveConfiguration(payload);
            activeSaveRef.current = savePromise;
            try {
                await savePromise;
            } finally {
                if (activeSaveRef.current === savePromise) {
                    activeSaveRef.current = undefined;
                }
            }
        },
        [context],
    );

    const debouncedDispatchSave = useMemo(
        () =>
            debounce((payload: SaveShortcutsConfigurationPayload, payloadDataKey: string) => {
                scheduledPayloadRef.current = undefined;
                void dispatchSave(payload, payloadDataKey).catch(() => undefined);
            }, 700),
        [dispatchSave],
    );

    const flushPendingSave = useCallback(async () => {
        if (!scheduledPayloadRef.current || !context) {
            return;
        }

        const payload = scheduledPayloadRef.current;
        scheduledPayloadRef.current = undefined;
        debouncedDispatchSave.cancel();
        await dispatchSave(payload, getPayloadDataKey(payload));
    }, [context, debouncedDispatchSave, dispatchSave]);

    const saveAndClose = useCallback(async () => {
        debouncedDispatchSave.cancel();

        const payload = scheduledPayloadRef.current;
        if (!payload || !context) {
            await activeSaveRef.current?.catch(() => undefined);
            await context?.closeDialog();
            return;
        }

        await activeSaveRef.current?.catch(() => undefined);
        scheduledPayloadRef.current = undefined;
        const payloadDataKey = getPayloadDataKey(payload);
        pendingPayloadRef.current = payloadDataKey;
        pendingChangedSectionsRef.current = payload.changedSections;
        pendingSaveVersionRef.current = localChangeVersionRef.current;
        await context.saveAndCloseConfiguration(payload);
    }, [context, debouncedDispatchSave]);

    useEffect(
        () => () => {
            void flushPendingSave().catch(() => undefined);
            if (savedTimerRef.current) {
                clearTimeout(savedTimerRef.current);
            }
            debouncedDispatchSave.cancel();
        },
        [debouncedDispatchSave, flushPendingSave],
    );

    const scheduleSave = useCallback(
        (payload: SaveShortcutsConfigurationPayload) => {
            if (!context) {
                return;
            }

            const payloadDataKey = getPayloadDataKey(payload);
            if (payloadDataKey === lastSavedPayloadRef.current) {
                return;
            }

            setSaveState("saving");
            if (savedTimerRef.current) {
                clearTimeout(savedTimerRef.current);
            }
            scheduledPayloadRef.current = payload;
            debouncedDispatchSave(payload, payloadDataKey);
        },
        [context, debouncedDispatchSave],
    );

    const saveWith = useCallback(
        (
            nextQuickQueries = quickQueries,
            nextQuickQueryKeybindings = quickQueryKeybindings,
            nextWebviewShortcuts = webviewShortcuts,
            changedSections?: SaveShortcutsConfigurationChangedSections,
        ) => {
            scheduleSave(
                buildPayload(
                    nextQuickQueries,
                    nextQuickQueryKeybindings,
                    nextWebviewShortcuts,
                    changedSections,
                ),
            );
        },
        [quickQueries, quickQueryKeybindings, scheduleSave, webviewShortcuts],
    );

    const markLocalChange = useCallback(() => {
        localChangeVersionRef.current += 1;
        hasLocalChangesRef.current = true;
    }, []);

    const updateQuickQuery = useCallback(
        (index: number, value: QuickQuerySlot) => {
            const nextQuickQueries = quickQueries.map((slot, slotIndex) =>
                slotIndex === index ? value : slot,
            );
            setQuickQueries(nextQuickQueries);
            markLocalChange();
            saveWith(nextQuickQueries, quickQueryKeybindings, webviewShortcuts, {
                quickQueries: true,
            });
        },
        [markLocalChange, quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    const updateQuickQueryShortcut = useCallback(
        (commandId: string, value: string) => {
            const nextKeybindings = {
                ...quickQueryKeybindings,
                [commandId]: value,
            };
            setQuickQueryKeybindings(nextKeybindings);
            markLocalChange();
            saveWith(quickQueries, nextKeybindings, webviewShortcuts, {
                quickQueryKeybindings: true,
            });
        },
        [markLocalChange, quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    const clearQuickQueryValues = useCallback(
        (index: number, commandId: string) => {
            const slot = quickQueries[index];
            const shortcut = quickQueryKeybindings[commandId] ?? "";
            const hasValues =
                slot.query.trim().length > 0 ||
                shortcut.trim().length > 0 ||
                slot.executionMode !== QuickQueryExecutionMode.Open;
            if (!hasValues) {
                return;
            }

            const nextQuickQueries = quickQueries.map((current, slotIndex) =>
                slotIndex === index
                    ? {
                          ...current,
                          query: "",
                          executionMode: QuickQueryExecutionMode.Open,
                      }
                    : current,
            );
            const nextKeybindings = {
                ...quickQueryKeybindings,
                [commandId]: "",
            };

            setQuickQueries(nextQuickQueries);
            setQuickQueryKeybindings(nextKeybindings);
            markLocalChange();
            saveWith(nextQuickQueries, nextKeybindings, webviewShortcuts, {
                quickQueries: true,
                quickQueryKeybindings: true,
            });
        },
        [markLocalChange, quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    const updateWebviewShortcut = useCallback(
        (action: WebviewAction, value: string) => {
            const nextShortcuts = {
                ...webviewShortcuts,
                [action]: value,
            };
            setWebviewShortcuts(nextShortcuts);
            markLocalChange();
            saveWith(quickQueries, quickQueryKeybindings, nextShortcuts, {
                webviewShortcuts: true,
            });
        },
        [markLocalChange, quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    return {
        quickQueries,
        quickQueryKeybindings,
        webviewShortcuts,
        saveState,
        updateQuickQuery,
        updateQuickQueryShortcut,
        clearQuickQueryValues,
        updateWebviewShortcut,
        saveAndClose,
    };
}
