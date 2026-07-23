/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash/debounce";
import { getErrorMessage } from "../../common/utils";
import {
    normalizeQuickQueries,
    QuickQuerySlot,
    SaveShortcutsConfigurationChangedSections,
    SaveShortcutsConfigurationPayload,
    ShortcutsConfigurationContextProps,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import { SaveState } from "./shortcutComponents";

function buildPayload(
    quickQueries: QuickQuerySlot[],
    webviewShortcuts: Record<string, string>,
    changedSections?: SaveShortcutsConfigurationChangedSections,
): SaveShortcutsConfigurationPayload {
    return {
        quickQueries,
        webviewShortcuts,
        changedSections,
    };
}

function getPayloadDataKey(payload: SaveShortcutsConfigurationPayload): string {
    const changedSections = payload.changedSections;
    return JSON.stringify({
        quickQueries:
            !changedSections || changedSections.quickQueries ? payload.quickQueries : undefined,
        webviewShortcuts:
            !changedSections || changedSections.webviewShortcuts
                ? payload.webviewShortcuts
                : undefined,
    });
}

export interface UseShortcutsConfigurationSaveParams {
    context: ShortcutsConfigurationContextProps | undefined;
}

export interface UseShortcutsConfigurationSaveResult {
    quickQueries: QuickQuerySlot[];
    webviewShortcuts: Record<string, string>;
    saveState: SaveState;
    errorMessage: string | undefined;
    updateQuickQuery: (index: number, value: QuickQuerySlot) => void;
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
}: UseShortcutsConfigurationSaveParams): UseShortcutsConfigurationSaveResult {
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [quickQueries, setQuickQueries] = useState<QuickQuerySlot[]>(() =>
        normalizeQuickQueries(undefined),
    );
    const [webviewShortcuts, setWebviewShortcuts] = useState<Record<string, string>>({});
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastSavedPayloadRef = useRef("");
    const pendingPayloadRef = useRef("");
    const pendingSaveVersionRef = useRef(0);
    const localChangeVersionRef = useRef(0);
    const scheduledPayloadRef = useRef<SaveShortcutsConfigurationPayload | undefined>(undefined);
    const activeSaveRef = useRef<Promise<void> | undefined>(undefined);
    const hasLocalChangesRef = useRef(false);

    useEffect(() => {
        if (!context) {
            return;
        }

        let isDisposed = false;
        void context
            .readConfiguration()
            .then((configuration) => {
                if (isDisposed || hasLocalChangesRef.current) {
                    return;
                }

                const normalizedQuickQueries = normalizeQuickQueries(configuration.quickQueries);
                const normalizedShortcuts = configuration.webviewShortcuts ?? {};
                setQuickQueries(normalizedQuickQueries);
                setWebviewShortcuts(normalizedShortcuts);
                setErrorMessage(undefined);
                lastSavedPayloadRef.current = getPayloadDataKey(
                    buildPayload(normalizedQuickQueries, normalizedShortcuts),
                );
            })
            .catch((error) => {
                if (!isDisposed) {
                    setErrorMessage(error instanceof Error ? error.message : String(error));
                }
            });

        return () => {
            isDisposed = true;
        };
    }, [context]);

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
            pendingSaveVersionRef.current = localChangeVersionRef.current;
            const savePromise = context
                .saveConfiguration(payload)
                .then((result) => {
                    if (result.errorMessage) {
                        setErrorMessage(result.errorMessage);
                        setSaveState("idle");
                        pendingPayloadRef.current = "";
                        return;
                    }

                    if (
                        pendingPayloadRef.current === payloadDataKey &&
                        pendingSaveVersionRef.current === localChangeVersionRef.current
                    ) {
                        hasLocalChangesRef.current = false;
                        pendingPayloadRef.current = "";
                        lastSavedPayloadRef.current = payloadDataKey;
                        setErrorMessage(undefined);
                        setSaveState("saved");
                        if (savedTimerRef.current) {
                            clearTimeout(savedTimerRef.current);
                        }
                        savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2500);
                    }
                })
                .catch((error) => {
                    setErrorMessage(getErrorMessage(error));
                    setSaveState("idle");
                    pendingPayloadRef.current = "";
                    throw error;
                });
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
        pendingSaveVersionRef.current = localChangeVersionRef.current;
        try {
            const result = await context.saveAndCloseConfiguration(payload);
            if (result.errorMessage) {
                setErrorMessage(result.errorMessage);
                setSaveState("idle");
            }
        } catch (error) {
            setErrorMessage(getErrorMessage(error));
            setSaveState("idle");
        }
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
            setErrorMessage(undefined);
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
            nextWebviewShortcuts = webviewShortcuts,
            changedSections?: SaveShortcutsConfigurationChangedSections,
        ) => {
            scheduleSave(buildPayload(nextQuickQueries, nextWebviewShortcuts, changedSections));
        },
        [quickQueries, scheduleSave, webviewShortcuts],
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
            saveWith(nextQuickQueries, webviewShortcuts, {
                quickQueries: true,
            });
        },
        [markLocalChange, quickQueries, saveWith, webviewShortcuts],
    );

    const clearQuickQueryValues = useCallback(
        (index: number, _commandId: string) => {
            const slot = quickQueries[index];
            if (slot.query.trim().length === 0) {
                return;
            }

            const nextQuickQueries = quickQueries.map((current, slotIndex) =>
                slotIndex === index
                    ? {
                          ...current,
                          query: "",
                      }
                    : current,
            );

            setQuickQueries(nextQuickQueries);
            markLocalChange();
            saveWith(nextQuickQueries, webviewShortcuts, {
                quickQueries: true,
            });
        },
        [markLocalChange, quickQueries, saveWith, webviewShortcuts],
    );

    const updateWebviewShortcut = useCallback(
        (action: WebviewAction, value: string) => {
            const nextShortcuts = {
                ...webviewShortcuts,
                [action]: value,
            };
            setWebviewShortcuts(nextShortcuts);
            markLocalChange();
            saveWith(quickQueries, nextShortcuts, {
                webviewShortcuts: true,
            });
        },
        [markLocalChange, quickQueries, saveWith, webviewShortcuts],
    );

    return {
        quickQueries,
        webviewShortcuts,
        saveState,
        errorMessage,
        updateQuickQuery,
        clearQuickQueryValues,
        updateWebviewShortcut,
        saveAndClose,
    };
}
