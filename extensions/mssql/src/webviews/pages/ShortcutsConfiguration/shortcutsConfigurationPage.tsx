/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash/debounce";
import { Button, Input, Tab, TabList } from "@fluentui/react-components";
import { Search16Regular, Settings24Regular } from "@fluentui/react-icons";
import { CollapsibleSection } from "../../common/collapsibleSection";
import { DialogPageShell } from "../../common/dialogPageShell";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import {
    getQuickQueryCommandId,
    normalizeQuickQueries,
    QuickQuerySlot,
    quickQueryCount,
    SaveShortcutsConfigurationChangedSections,
    SaveShortcutsConfigurationPayload,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { ShortcutsConfigurationContext } from "./shortcutsConfigurationStateProvider";
import { useShortcutsConfigurationSelector } from "./shortcutsConfigurationSelector";
import {
    getShortcutGroupDescription,
    getShortcutGroupLabel,
    shortcutGroups,
} from "./shortcutDefinitions";
import {
    QuickQueryRow,
    SaveIndicator,
    SaveState,
    ShortcutRecorder,
    WebviewShortcutRow,
} from "./shortcutComponents";
import { HighlightedText, textMatchesSearch } from "./shortcutKeyboardUtils";

type ConfigurationTab = "queries" | "shortcuts";

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

export const ShortcutsConfigurationPage = () => {
    const loc = locConstants.shortcutsConfiguration;
    const common = locConstants.common;
    const context = useContext(ShortcutsConfigurationContext);
    const { themeKind } = useVscodeWebview();
    const stateQuickQueries = useShortcutsConfigurationSelector((s) => s.quickQueries);
    const stateQuickQueryKeybindings = useShortcutsConfigurationSelector(
        (s) => s.quickQueryKeybindings,
    );
    const stateWebviewShortcuts = useShortcutsConfigurationSelector((s) => s.webviewShortcuts);
    const stateFocusedQuickQuerySlot = useShortcutsConfigurationSelector(
        (s) => s.focusedQuickQuerySlot,
    );
    const stateFocusNonce = useShortcutsConfigurationSelector((s) => s.focusNonce);
    const stateErrorMessage = useShortcutsConfigurationSelector((s) => s.errorMessage);
    const stateIsSaving = useShortcutsConfigurationSelector((s) => s.isSaving);
    const [activeTab, setActiveTab] = useState<ConfigurationTab>("queries");
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
    const [openQueryItems, setOpenQueryItems] = useState<number[]>([]);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [shortcutSearch, setShortcutSearch] = useState("");
    const [recording, setRecording] = useState<
        { kind: "quickQuery"; commandId: string } | { kind: "webview"; action: WebviewAction }
    >();
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
    const pendingQuickQueryEditsRef = useRef<Map<number, QuickQuerySlot>>(new Map());
    const quickQueriesRef = useRef(quickQueries);
    const quickQueryKeybindingsRef = useRef(quickQueryKeybindings);
    const webviewShortcutsRef = useRef(webviewShortcuts);
    const hasLocalChangesRef = useRef(false);

    useEffect(() => {
        quickQueriesRef.current = quickQueries;
    }, [quickQueries]);

    useEffect(() => {
        quickQueryKeybindingsRef.current = quickQueryKeybindings;
    }, [quickQueryKeybindings]);

    useEffect(() => {
        webviewShortcutsRef.current = webviewShortcuts;
    }, [webviewShortcuts]);

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

    useEffect(() => {
        const focusedQuickQuerySlot = stateFocusedQuickQuerySlot;
        if (
            focusedQuickQuerySlot &&
            focusedQuickQuerySlot >= 1 &&
            focusedQuickQuerySlot <= quickQueryCount
        ) {
            setActiveTab("queries");
            if (quickQueries[focusedQuickQuerySlot - 1]) {
                setOpenQueryItems((current) =>
                    current.includes(focusedQuickQuerySlot)
                        ? current
                        : [...current, focusedQuickQuerySlot],
                );
            }
        }
    }, [quickQueries, stateFocusedQuickQuerySlot, stateFocusNonce]);

    const dispatchSave = useCallback(
        async (payload: SaveShortcutsConfigurationPayload, payloadDataKey: string) => {
            if (!context) {
                return;
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
                void dispatchSave(payload, payloadDataKey);
            }, 700),
        [dispatchSave],
    );

    const flushUnsavedQueryEdits = useCallback(() => {
        if (pendingQuickQueryEditsRef.current.size === 0) {
            return;
        }

        const nextQuickQueries = quickQueriesRef.current.map(
            (slot, index) => pendingQuickQueryEditsRef.current.get(index) ?? slot,
        );
        pendingQuickQueryEditsRef.current.clear();
        quickQueriesRef.current = nextQuickQueries;
        setQuickQueries(nextQuickQueries);
        scheduledPayloadRef.current = buildPayload(
            nextQuickQueries,
            quickQueryKeybindingsRef.current,
            webviewShortcutsRef.current,
            {
                quickQueries: true,
            },
        );
    }, []);

    const flushPendingSave = useCallback(async () => {
        flushUnsavedQueryEdits();
        if (!scheduledPayloadRef.current || !context) {
            return;
        }

        const payload = scheduledPayloadRef.current;
        scheduledPayloadRef.current = undefined;
        debouncedDispatchSave.cancel();
        await dispatchSave(payload, getPayloadDataKey(payload));
    }, [context, debouncedDispatchSave, dispatchSave, flushUnsavedQueryEdits]);

    const saveAndClose = useCallback(async () => {
        flushUnsavedQueryEdits();
        debouncedDispatchSave.cancel();

        const payload = scheduledPayloadRef.current;
        if (!payload || !context) {
            await activeSaveRef.current;
            await context?.closeDialog();
            return;
        }

        scheduledPayloadRef.current = undefined;
        const payloadDataKey = getPayloadDataKey(payload);
        pendingPayloadRef.current = payloadDataKey;
        pendingChangedSectionsRef.current = payload.changedSections;
        pendingSaveVersionRef.current = localChangeVersionRef.current;
        await context.saveAndCloseConfiguration(payload);
    }, [context, debouncedDispatchSave, flushUnsavedQueryEdits]);

    useEffect(
        () => () => {
            void flushPendingSave();
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

    if (!context) {
        return undefined;
    }

    const updateQuickQuery = (index: number, value: QuickQuerySlot, shouldSave = true) => {
        const nextQuickQueries = quickQueries.map((slot, slotIndex) =>
            slotIndex === index ? value : slot,
        );
        setQuickQueries(nextQuickQueries);
        quickQueriesRef.current = nextQuickQueries;
        localChangeVersionRef.current += 1;
        hasLocalChangesRef.current = true;
        if (shouldSave) {
            pendingQuickQueryEditsRef.current.delete(index);
            saveWith(nextQuickQueries, quickQueryKeybindings, webviewShortcuts, {
                quickQueries: true,
            });
        } else {
            pendingQuickQueryEditsRef.current.set(index, value);
        }
    };

    const updateQuickQueryShortcut = (commandId: string, value: string) => {
        const nextKeybindings = {
            ...quickQueryKeybindings,
            [commandId]: value,
        };
        setQuickQueryKeybindings(nextKeybindings);
        quickQueryKeybindingsRef.current = nextKeybindings;
        localChangeVersionRef.current += 1;
        hasLocalChangesRef.current = true;
        saveWith(quickQueries, nextKeybindings, webviewShortcuts, {
            quickQueryKeybindings: true,
        });
    };

    const updateWebviewShortcut = (action: WebviewAction, value: string) => {
        const nextShortcuts = {
            ...webviewShortcuts,
            [action]: value,
        };
        setWebviewShortcuts(nextShortcuts);
        webviewShortcutsRef.current = nextShortcuts;
        localChangeVersionRef.current += 1;
        hasLocalChangesRef.current = true;
        saveWith(quickQueries, quickQueryKeybindings, nextShortcuts, {
            webviewShortcuts: true,
        });
    };

    const renderQueries = () => (
        <>
            <div className="mssql-config-help-text">{loc.quickQueriesDescription}</div>
            <div className="mssql-config-card">
                {quickQueries.map((slot, index) => {
                    const commandId = getQuickQueryCommandId(index + 1);
                    const slotNumber = index + 1;
                    const expanded = openQueryItems.includes(slotNumber);
                    return (
                        <QuickQueryRow
                            key={commandId}
                            slot={slot}
                            shortcut={quickQueryKeybindings[commandId] ?? ""}
                            expanded={expanded}
                            onToggle={() =>
                                setOpenQueryItems((current) =>
                                    expanded
                                        ? current.filter((item) => item !== slotNumber)
                                        : [...current, slotNumber],
                                )
                            }
                            onChange={(value, shouldSave) =>
                                updateQuickQuery(index, value, shouldSave)
                            }
                            onRecord={() => setRecording({ kind: "quickQuery", commandId })}
                            themeKind={themeKind}
                            loc={loc}
                        />
                    );
                })}
            </div>
        </>
    );

    const renderShortcuts = () => (
        <>
            <div className="mssql-config-help-text">{loc.webviewShortcutsDescription}</div>
            <Input
                className="mssql-config-search-input"
                contentBefore={<Search16Regular />}
                value={shortcutSearch}
                placeholder={loc.searchWebviewShortcuts}
                aria-label={loc.searchWebviewShortcuts}
                onChange={(_event, data) => setShortcutSearch(data.value)}
            />
            <div className="mssql-config-shortcut-groups">
                {shortcutGroups.map((group) => {
                    const searchTerm = shortcutSearch.trim();
                    const groupLabel = getShortcutGroupLabel(group.id, loc);
                    const groupDescription = getShortcutGroupDescription(group.id, loc);
                    const groupMatches =
                        !!searchTerm &&
                        (textMatchesSearch(groupLabel, searchTerm) ||
                            textMatchesSearch(groupDescription, searchTerm));
                    const visibleItems = group.items.filter((item) => {
                        if (!searchTerm || groupMatches) {
                            return true;
                        }

                        return (
                            textMatchesSearch(loc.webviewShortcutLabels[item.action], searchTerm) ||
                            textMatchesSearch(
                                loc.webviewShortcutDescriptions[item.action],
                                searchTerm,
                            )
                        );
                    });

                    if (searchTerm && visibleItems.length === 0) {
                        return null;
                    }

                    return (
                        <CollapsibleSection
                            key={group.id}
                            className="mssql-config-card mssql-config-shortcut-group"
                            buttonClassName="mssql-config-group-header"
                            panelClassName="mssql-config-webview-shortcuts"
                            open={searchTerm ? true : !collapsedGroups[group.id]}
                            onOpenChange={(open) =>
                                setCollapsedGroups((current) => ({
                                    ...current,
                                    [group.id]: !open,
                                }))
                            }
                            title={
                                <span className="mssql-config-group-title">
                                    <span>
                                        <HighlightedText
                                            text={groupLabel}
                                            searchTerm={searchTerm}
                                        />
                                    </span>
                                    <span>
                                        <HighlightedText
                                            text={groupDescription}
                                            searchTerm={searchTerm}
                                        />
                                    </span>
                                </span>
                            }>
                            {visibleItems.map((item) => (
                                <WebviewShortcutRow
                                    key={item.action}
                                    item={item}
                                    value={webviewShortcuts[item.action] ?? ""}
                                    onRecord={() =>
                                        setRecording({
                                            kind: "webview",
                                            action: item.action,
                                        })
                                    }
                                    loc={loc}
                                    searchTerm={searchTerm}
                                />
                            ))}
                        </CollapsibleSection>
                    );
                })}
            </div>
        </>
    );

    const recorderValue =
        recording?.kind === "quickQuery"
            ? (quickQueryKeybindings[recording.commandId] ?? "")
            : recording?.kind === "webview"
              ? (webviewShortcuts[recording.action] ?? "")
              : "";

    return (
        <DialogPageShell
            icon={<Settings24Regular aria-label={loc.title} />}
            title={loc.title}
            subtitle={loc.subtitle}
            errorMessage={stateErrorMessage}
            maxContentWidth={1040}
            iconSize={40}
            headerEnd={<SaveIndicator state={saveState} />}
            footerEnd={
                <Button
                    appearance="secondary"
                    onClick={() => {
                        void saveAndClose();
                    }}>
                    {common.close}
                </Button>
            }>
            <style>{styles}</style>
            <div className="mssql-config-page" aria-label={loc.pageAriaLabel}>
                <TabList
                    className="mssql-config-tabs"
                    selectedValue={activeTab}
                    onTabSelect={(_event, data) => setActiveTab(data.value as ConfigurationTab)}
                    aria-label={loc.configurationSections}>
                    <Tab value="queries">{loc.quickQueries}</Tab>
                    <Tab value="shortcuts">{loc.webviewShortcuts}</Tab>
                </TabList>
                {activeTab === "queries" ? renderQueries() : renderShortcuts()}
            </div>
            {recording && (
                <ShortcutRecorder
                    current={recorderValue}
                    onClose={() => setRecording(undefined)}
                    onSave={(value) => {
                        if (recording.kind === "quickQuery") {
                            updateQuickQueryShortcut(recording.commandId, value);
                        } else {
                            updateWebviewShortcut(recording.action, value);
                        }
                    }}
                />
            )}
        </DialogPageShell>
    );
};

const styles = `
:root {
    --mssql-config-control-height: 30px;
    --mssql-config-surface: var(--vscode-editor-background);
    --mssql-config-raised: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
    --mssql-config-input: var(--vscode-input-background);
    --mssql-config-border: var(--vscode-editorGroup-border);
    --mssql-config-border-md: var(--vscode-input-border, var(--vscode-editorGroup-border));
    --mssql-config-border-hi: var(--vscode-focusBorder);
    --mssql-config-fg: var(--vscode-foreground);
    --mssql-config-muted: var(--vscode-descriptionForeground);
    --mssql-config-dim: var(--vscode-disabledForeground);
    --mssql-config-hover: var(--vscode-list-hoverBackground);
    --mssql-config-accent: var(--vscode-focusBorder);
    --mssql-config-accent-dim: var(--vscode-list-activeSelectionBackground);
    --mssql-config-accent-text: var(--vscode-textLink-foreground);
    --mssql-config-success: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
    --mssql-config-danger: var(--vscode-errorForeground);
    --mssql-config-font: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
    --mssql-config-mono: 'Cascadia Code', 'Fira Code', monospace;
}

.mssql-config-page {
    color: var(--mssql-config-fg);
    display: flex;
    flex-direction: column;
    font-family: var(--mssql-config-font);
    gap: 16px;
    min-width: 0;
}

.mssql-config-save-indicator {
    align-items: center;
    color: var(--mssql-config-muted);
    display: flex;
    font-size: 12px;
    gap: 6px;
}

.mssql-config-save-indicator:has(svg) {
    color: var(--mssql-config-success);
}

.mssql-config-link-button {
    background: none;
    border: none;
    color: var(--mssql-config-accent-text);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-decoration: underline;
}

.mssql-config-tabs {
    display: flex;
    gap: 0;
}

.mssql-config-tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--mssql-config-muted);
    cursor: pointer;
    font-family: var(--mssql-config-font);
    font-size: 13px;
    padding: 7px 18px;
}

.mssql-config-tabs button:hover {
    color: var(--mssql-config-fg);
}

.mssql-config-help-text {
    color: var(--mssql-config-muted);
    font-size: 12px;
    line-height: 1.6;
}

.mssql-config-card {
    background: var(--mssql-config-surface);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 8px;
    overflow: hidden;
}

.mssql-config-query-row {
    border: none;
    border-radius: 0;
    border-bottom: 1px solid var(--mssql-config-border);
}

.mssql-config-query-row:last-child {
    border-bottom: none;
}

.mssql-config-query-summary,
.mssql-config-group-header {
    align-items: center;
    background: transparent;
    border: none;
    color: inherit;
    display: grid;
    font-family: var(--mssql-config-font);
    gap: 12px;
    grid-template-columns: auto minmax(0, 1fr);
    padding: 12px 16px;
    text-align: left;
    width: 100%;
}

.mssql-config-shortcut-group {
    border-radius: 8px;
}

.mssql-config-query-summary {
    box-sizing: border-box;
    cursor: pointer;
    min-height: 68px;
}

.mssql-config-query-summary > span:last-child {
    min-width: 0;
    width: 100%;
}

.mssql-config-group-header > span:last-child {
    min-width: 0;
    width: 100%;
}

.mssql-config-query-summary-content {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    width: 100%;
}

.mssql-config-query-summary:focus-visible {
    outline: 1px solid var(--mssql-config-accent);
    outline-offset: -2px;
}

.mssql-config-query-summary:hover,
.mssql-config-group-header:hover {
    background: var(--mssql-config-hover);
}

.mssql-config-query-title,
.mssql-config-group-title {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.mssql-config-chevron {
    align-items: center;
    color: var(--mssql-config-muted);
    display: flex;
    height: 16px;
    justify-content: center;
    width: 16px;
}

.mssql-config-query-title > span:first-child,
.mssql-config-group-title > span:first-child,
.mssql-config-row-label {
    color: var(--mssql-config-fg);
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mssql-config-query-preview {
    color: var(--mssql-config-muted);
    font-family: var(--mssql-config-mono);
    font-size: 11.5px;
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.mssql-config-query-empty {
    color: var(--mssql-config-dim);
    font-size: 11.5px;
    font-style: italic;
    margin-top: 1px;
}

.mssql-config-query-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 16px 16px 40px;
}

.mssql-config-controls-row {
    align-items: end;
    display: grid;
    column-gap: 24px;
    grid-template-columns: max-content max-content max-content;
    row-gap: 12px;
}

.mssql-config-controls-row .mssql-config-field {
    width: max-content;
}

.mssql-config-field {
    color: var(--mssql-config-muted);
    display: flex;
    flex-direction: column;
    font-size: 11px;
    font-weight: 500;
    gap: 5px;
    min-width: 0;
}

.mssql-config-shortcut-field {
    min-width: 176px;
}

.mssql-config-segmented-control {
    min-height: var(--mssql-config-control-height);
    width: fit-content;
}

.mssql-config-segmented-control button {
    height: var(--mssql-config-control-height);
    min-height: var(--mssql-config-control-height);
    min-width: 82px;
}

.mssql-config-monaco-shell {
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 6px;
    height: 140px;
    overflow: hidden;
}

.mssql-config-monaco-shell:focus-within {
    border-color: var(--mssql-config-accent);
}

.mssql-config-shortcut-chip-row {
    align-items: center;
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    min-width: 0;
}

.mssql-config-shortcut-chip-row button {
    height: var(--mssql-config-control-height);
    min-height: var(--mssql-config-control-height);
    min-width: var(--mssql-config-control-height);
}

.mssql-config-shortcut-display {
    align-items: center;
    background: var(--mssql-config-input);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 5px;
    box-sizing: border-box;
    color: var(--mssql-config-fg);
    display: flex;
    font-family: var(--mssql-config-mono);
    font-size: 12px;
    height: var(--mssql-config-control-height);
    min-width: 140px;
    overflow: hidden;
    padding: 5px 10px;
    text-align: left;
    text-overflow: ellipsis;
    user-select: none;
    white-space: nowrap;
}

.mssql-config-empty,
.mssql-config-muted {
    color: var(--mssql-config-dim) !important;
}

.mssql-config-shortcut-groups {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mssql-config-search-input {
    max-width: 360px;
    width: 100%;
}

.mssql-config-search-match {
    background: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 196, 0, 0.35));
    border-radius: 2px;
    color: inherit;
    padding: 0 1px;
}

.mssql-config-group-header {
    background: var(--mssql-config-raised);
    gap: 10px;
    grid-template-columns: auto minmax(0, 1fr);
    padding: 11px 16px;
}

.mssql-config-group-title > span:last-child,
.mssql-config-row-description {
    color: var(--mssql-config-muted);
    font-size: 11.5px;
    line-height: 1.5;
}

.mssql-config-webview-shortcuts {
    padding: 0 16px;
}

.mssql-config-webview-shortcut-row {
    align-items: center;
    border-bottom: 1px solid var(--mssql-config-border);
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 10px 0;
}

.mssql-config-webview-shortcut-row:last-child {
    border-bottom: none;
}

.mssql-config-recorder {
    background: var(--mssql-config-surface);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 12px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.7);
    overflow: hidden;
    width: 360px;
}

.mssql-config-recorder-subtitle {
    color: var(--mssql-config-muted);
    font-size: 12px;
    margin-top: 3px;
}

.mssql-config-recorder-body {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 28px 20px;
}

.mssql-config-key-display {
    align-items: center;
    background: var(--mssql-config-raised);
    border: 2px solid var(--mssql-config-border-md);
    border-radius: 8px;
    display: flex;
    height: 64px;
    justify-content: center;
    transition: border-color 0.2s;
    width: 100%;
}

.mssql-config-key-display-recording {
    border-color: var(--mssql-config-accent);
}

.mssql-config-key-display-done {
    border-color: var(--mssql-config-success);
}

.mssql-config-recording-copy {
    align-items: center;
    color: var(--mssql-config-accent-text);
    display: flex;
    font-size: 13px;
    gap: 8px;
}

.mssql-config-pulse {
    animation: mssql-config-pulse 1s ease-in-out infinite;
    background: var(--mssql-config-accent);
    border-radius: 50%;
    height: 8px;
    width: 8px;
}

.mssql-config-shortcut-preview {
    color: var(--mssql-config-fg);
    font-family: var(--mssql-config-mono);
    font-size: 20px;
    font-weight: 700;
}

@keyframes mssql-config-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

@media (max-width: 640px) {
    .mssql-config-controls-row,
    .mssql-config-webview-shortcut-row {
        grid-template-columns: 1fr;
    }

    .mssql-config-query-summary {
        align-items: flex-start;
        grid-template-columns: auto minmax(0, 1fr);
    }

    .mssql-config-query-summary-content {
        grid-template-columns: 1fr;
    }

    .mssql-config-query-editor {
        padding-left: 16px;
    }
}
`;
