/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    Select,
    Switch,
    Tab,
    TabList,
} from "@fluentui/react-components";
import {
    Checkmark12Regular,
    ChevronDown12Regular,
    ChevronRight12Regular,
    Keyboard24Regular,
    Settings24Regular,
} from "@fluentui/react-icons";
import { DialogPageShell } from "../../common/dialogPageShell";
import { locConstants } from "../../common/locConstants";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ColorThemeKind, WebviewAction } from "../../../sharedInterfaces/webview";
import {
    getQuickQueryCommandId,
    MssqlSettingDefinition,
    normalizeQuickQueries,
    QuickQueryConnectionMode,
    QuickQueryExecutionMode,
    QuickQuerySlot,
    quickQueryCount,
    SaveMssqlConfigurationPayload,
} from "../../../sharedInterfaces/mssqlConfiguration";
import { MssqlConfigurationContext } from "./mssqlConfigurationStateProvider";
import { useMssqlConfigurationSelector } from "./mssqlConfigurationSelector";

type ConfigurationTab = "queries" | "settings" | "shortcuts";
type SaveState = "idle" | "saving" | "saved";

const executionOptions = [
    { value: QuickQueryExecutionMode.OpenAndRun, label: "Open and run" },
    { value: QuickQueryExecutionMode.Open, label: "Open only" },
];

const connectionOptions = [
    { value: QuickQueryConnectionMode.Prompt, label: "Prompt" },
    { value: QuickQueryConnectionMode.ActiveOrPrompt, label: "Active" },
];

interface ShortcutItem {
    action: WebviewAction;
    label: string;
    description: string;
}

interface ShortcutGroup {
    id: string;
    label: string;
    description: string;
    items: ShortcutItem[];
}

const shortcutGroups: ShortcutGroup[] = [
    {
        id: "navigation",
        label: "Navigation",
        description: "Switch between result panes and tabs",
        items: [
            {
                action: WebviewAction.QueryResultSwitchToResultsTab,
                label: "Switch to Results tab",
                description: "Focus the Results tab in the query results panel",
            },
            {
                action: WebviewAction.QueryResultSwitchToMessagesTab,
                label: "Switch to Messages tab",
                description: "Focus the Messages tab",
            },
            {
                action: WebviewAction.QueryResultSwitchToQueryPlanTab,
                label: "Switch to Query Plan tab",
                description: "Focus the Query Plan tab",
            },
            {
                action: WebviewAction.QueryResultPrevGrid,
                label: "Previous result grid",
                description: "Move focus to the previous result set grid",
            },
            {
                action: WebviewAction.QueryResultNextGrid,
                label: "Next result grid",
                description: "Move focus to the next result set grid",
            },
        ],
    },
    {
        id: "results",
        label: "Results",
        description: "Control the results grid display",
        items: [
            {
                action: WebviewAction.QueryResultSwitchToTextView,
                label: "Switch results view",
                description: "Toggle between grid and text view",
            },
            {
                action: WebviewAction.QueryResultMaximizeGrid,
                label: "Maximize results grid",
                description: "Expand the active grid to fill the panel",
            },
            {
                action: WebviewAction.ResultGridSelectAll,
                label: "Select all",
                description: "Select all cells in the active grid",
            },
            {
                action: WebviewAction.ResultGridSelectRow,
                label: "Select row",
                description: "Select the entire current row",
            },
            {
                action: WebviewAction.ResultGridSelectColumn,
                label: "Select column",
                description: "Select the entire current column",
            },
            {
                action: WebviewAction.ResultGridToggleSort,
                label: "Toggle sort",
                description: "Toggle sorting for the active column",
            },
            {
                action: WebviewAction.ResultGridChangeColumnWidth,
                label: "Change column width",
                description: "Resize the active result grid column",
            },
            {
                action: WebviewAction.ResultGridOpenColumnMenu,
                label: "Open column menu",
                description: "Open the active column menu",
            },
            {
                action: WebviewAction.ResultGridOpenFilterMenu,
                label: "Open filter menu",
                description: "Open the active column filter menu",
            },
        ],
    },
    {
        id: "selection",
        label: "Selection",
        description: "Move and expand the active grid selection",
        items: [
            {
                action: WebviewAction.ResultGridExpandSelectionLeft,
                label: "Expand selection left",
                description: "Extend the current selection one cell left",
            },
            {
                action: WebviewAction.ResultGridExpandSelectionRight,
                label: "Expand selection right",
                description: "Extend the current selection one cell right",
            },
            {
                action: WebviewAction.ResultGridExpandSelectionUp,
                label: "Expand selection up",
                description: "Extend the current selection one cell up",
            },
            {
                action: WebviewAction.ResultGridExpandSelectionDown,
                label: "Expand selection down",
                description: "Extend the current selection one cell down",
            },
            {
                action: WebviewAction.ResultGridMoveToRowStart,
                label: "Move to row start",
                description: "Move selection to the first cell in the row",
            },
            {
                action: WebviewAction.ResultGridMoveToRowEnd,
                label: "Move to row end",
                description: "Move selection to the last cell in the row",
            },
        ],
    },
    {
        id: "copy",
        label: "Copy & Export",
        description: "Copy data and save results to files",
        items: [
            {
                action: WebviewAction.ResultGridCopySelection,
                label: "Copy selection",
                description: "Copy selected cells to the clipboard",
            },
            {
                action: WebviewAction.ResultGridCopyWithHeaders,
                label: "Copy with headers",
                description: "Copy selected cells including column headers",
            },
            {
                action: WebviewAction.ResultGridCopyAllHeaders,
                label: "Copy all with headers",
                description: "Copy all cells including column headers",
            },
            {
                action: WebviewAction.ResultGridCopyAsCsv,
                label: "Copy as CSV",
                description: "Copy selection formatted as comma-separated values",
            },
            {
                action: WebviewAction.ResultGridCopyAsJson,
                label: "Copy as JSON",
                description: "Copy selection formatted as JSON",
            },
            {
                action: WebviewAction.ResultGridCopyAsInsert,
                label: "Copy as INSERT",
                description: "Copy selection formatted as INSERT statements",
            },
            {
                action: WebviewAction.ResultGridCopyAsInClause,
                label: "Copy as IN clause",
                description: "Copy selection formatted as a SQL IN clause",
            },
            {
                action: WebviewAction.QueryResultSaveAsJson,
                label: "Save results as JSON",
                description: "Export all results to a JSON file",
            },
            {
                action: WebviewAction.QueryResultSaveAsCsv,
                label: "Save results as CSV",
                description: "Export all results to a CSV file",
            },
            {
                action: WebviewAction.QueryResultSaveAsExcel,
                label: "Save results as Excel",
                description: "Export all results to an Excel file",
            },
            {
                action: WebviewAction.QueryResultSaveAsInsert,
                label: "Save results as INSERT",
                description: "Export all results as INSERT statements",
            },
        ],
    },
];

const modifierKeys = new Set(["Control", "Alt", "Shift", "Meta", "CapsLock", "Tab", "Escape"]);

function normalizeRecordedKey(key: string): string {
    const specialKeyMap: Record<string, string> = {
        " ": "space",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Escape: "escape",
        Enter: "enter",
        Tab: "tab",
        Backspace: "backspace",
        Delete: "delete",
        PageUp: "pageup",
        PageDown: "pagedown",
    };

    return specialKeyMap[key] ?? key.toLowerCase();
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
    if (modifierKeys.has(event.key)) {
        return undefined;
    }

    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) {
        parts.push("ctrl");
    }
    if (event.altKey) {
        parts.push("alt");
    }
    if (event.shiftKey) {
        parts.push("shift");
    }
    parts.push(normalizeRecordedKey(event.key));
    return parts.join("+");
}

function formatShortcut(value: string | undefined): string {
    if (!value?.trim()) {
        return "";
    }

    return value
        .split("+")
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .map((token) => {
            const lower = token.toLowerCase();
            const tokenMap: Record<string, string> = {
                ctrl: "Ctrl",
                control: "Ctrl",
                ctrlcmd: "Ctrl",
                cmd: "Cmd",
                command: "Cmd",
                meta: "Meta",
                alt: "Alt",
                option: "Alt",
                shift: "Shift",
                up: "Up",
                down: "Down",
                left: "Left",
                right: "Right",
                pageup: "PageUp",
                pagedown: "PageDown",
                space: "Space",
                escape: "Esc",
            };
            return tokenMap[lower] ?? (lower.length === 1 ? lower.toUpperCase() : token);
        })
        .join("+");
}

function buildPayload(
    quickQueries: QuickQuerySlot[],
    quickQueryKeybindings: Record<string, string>,
    webviewShortcuts: Record<string, string>,
    mssqlSettings: Record<string, unknown>,
): SaveMssqlConfigurationPayload {
    return {
        quickQueries,
        quickQueryKeybindings,
        webviewShortcuts,
        mssqlSettings,
    };
}

function getJsonSettingText(value: unknown): string {
    if (value === undefined) {
        return "";
    }
    return JSON.stringify(value, undefined, 4);
}

function parseJsonSettingText(value: string): unknown {
    return value.trim().length === 0 ? undefined : JSON.parse(value);
}

const SaveIndicator = ({ state }: { state: SaveState }) => {
    if (state === "idle") {
        return null;
    }

    return (
        <div className="mssql-config-save-indicator">
            {state === "saving" ? (
                <>
                    <span className="mssql-config-spinner" />
                    <span>Saving...</span>
                </>
            ) : (
                <>
                    <Checkmark12Regular />
                    <span>Saved</span>
                </>
            )}
        </div>
    );
};

const ShortcutRecorder = ({
    current,
    onSave,
    onClose,
}: {
    current: string;
    onSave: (value: string) => void;
    onClose: () => void;
}) => {
    const [recording, setRecording] = useState(true);
    const [preview, setPreview] = useState("");

    useEffect(() => {
        if (!recording) {
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Escape") {
                setRecording(false);
                setPreview(current);
                return;
            }

            const shortcut = shortcutFromKeyboardEvent(event);
            if (shortcut) {
                setPreview(shortcut);
                setRecording(false);
            }
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [current, recording]);

    const hasPreview = preview.trim().length > 0;

    return (
        <Dialog open modalType="modal">
            <DialogSurface className="mssql-config-recorder">
                <DialogBody>
                    <DialogTitle>Record Shortcut</DialogTitle>
                    <DialogContent>
                        <div className="mssql-config-recorder-subtitle">
                            Press any key combination to record
                        </div>
                        <div className="mssql-config-recorder-body">
                            <div
                                className={`mssql-config-key-display ${
                                    recording
                                        ? "mssql-config-key-display-recording"
                                        : hasPreview
                                          ? "mssql-config-key-display-done"
                                          : ""
                                }`}>
                                {recording ? (
                                    <div className="mssql-config-recording-copy">
                                        <span className="mssql-config-pulse" />
                                        <span>Press keys... (Esc to cancel)</span>
                                    </div>
                                ) : hasPreview ? (
                                    <span className="mssql-config-shortcut-preview">
                                        {formatShortcut(preview)}
                                    </span>
                                ) : (
                                    <span className="mssql-config-empty">No shortcut</span>
                                )}
                            </div>
                            {hasPreview && !recording && (
                                <Button
                                    appearance="transparent"
                                    className="mssql-config-link-button"
                                    onClick={() => {
                                        setPreview("");
                                        setRecording(true);
                                    }}>
                                    Re-record
                                </Button>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        {hasPreview ? (
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    onSave(preview);
                                    onClose();
                                }}>
                                Save
                            </Button>
                        ) : (
                            <Button
                                appearance="secondary"
                                onClick={() => {
                                    onSave("");
                                    onClose();
                                }}>
                                Clear shortcut
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const ShortcutChip = ({ value, onRecord }: { value: string; onRecord: () => void }) => (
    <div className="mssql-config-shortcut-chip-row">
        <div className={`mssql-config-shortcut-chip ${value ? "" : "mssql-config-empty"}`}>
            {formatShortcut(value) || "No shortcut"}
        </div>
        <Button
            className="mssql-config-icon-button"
            appearance="secondary"
            icon={<Keyboard24Regular />}
            title="Record shortcut"
            aria-label="Record shortcut"
            onClick={(event) => {
                event.stopPropagation();
                onRecord();
            }}
        />
    </div>
);

const QuickQueryRow = ({
    slot,
    shortcut,
    expanded,
    onToggle,
    onChange,
    onRecord,
    themeKind,
}: {
    slot: QuickQuerySlot;
    shortcut: string;
    expanded: boolean;
    onToggle: () => void;
    onChange: (value: QuickQuerySlot) => void;
    onRecord: () => void;
    themeKind: ColorThemeKind;
}) => {
    const query = slot.query.trim();
    const isConfigured = shortcut.trim().length > 0 || query.length > 0;
    const preview = query.length > 50 ? `${query.slice(0, 50)}...` : query;

    return (
        <div className={`mssql-config-query-row ${expanded ? "mssql-config-row-expanded" : ""}`}>
            <Button
                appearance="transparent"
                className="mssql-config-query-summary"
                onClick={onToggle}>
                <span className="mssql-config-chevron">
                    {expanded ? <ChevronDown12Regular /> : <ChevronRight12Regular />}
                </span>
                <span className="mssql-config-query-title">
                    <span className={isConfigured ? "" : "mssql-config-muted"}>{slot.name}</span>
                    {preview ? (
                        <span className="mssql-config-query-preview">{preview}</span>
                    ) : (
                        <span className="mssql-config-query-empty">No query set</span>
                    )}
                </span>
                {isConfigured ? (
                    <span className="mssql-config-status-chip">
                        {formatShortcut(shortcut) || "No shortcut"}
                    </span>
                ) : (
                    <span className="mssql-config-unconfigured-chip">Not configured</span>
                )}
            </Button>
            {expanded && (
                <div className="mssql-config-query-editor">
                    <div className="mssql-config-controls-row">
                        <Field
                            className="mssql-config-field mssql-config-shortcut-field"
                            label="Shortcut">
                            <ShortcutChip value={shortcut} onRecord={onRecord} />
                        </Field>
                        <Field className="mssql-config-field" label="Execution">
                            <Select
                                value={slot.executionMode}
                                onChange={(event) =>
                                    onChange({
                                        ...slot,
                                        executionMode: event.target
                                            .value as QuickQueryExecutionMode,
                                    })
                                }>
                                {executionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field className="mssql-config-field" label="Connection">
                            <Select
                                value={slot.connectionMode}
                                onChange={(event) =>
                                    onChange({
                                        ...slot,
                                        connectionMode: event.target
                                            .value as QuickQueryConnectionMode,
                                    })
                                }>
                                {connectionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    </div>
                    <Field className="mssql-config-field" label="SQL Query">
                        <div className="mssql-config-monaco-shell">
                            <VscodeEditor
                                height="100%"
                                width="100%"
                                language="sql"
                                themeKind={themeKind}
                                value={slot.query}
                                options={{
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    wordWrap: "on",
                                    lineNumbers: "on",
                                    glyphMargin: false,
                                    folding: false,
                                    lineDecorationsWidth: 8,
                                    overviewRulerLanes: 0,
                                    renderLineHighlight: "line",
                                    automaticLayout: true,
                                }}
                                onChange={(value) => onChange({ ...slot, query: value ?? "" })}
                            />
                        </div>
                    </Field>
                </div>
            )}
        </div>
    );
};

const WebviewShortcutRow = ({
    item,
    value,
    onRecord,
}: {
    item: ShortcutItem;
    value: string;
    onRecord: () => void;
}) => (
    <div className="mssql-config-webview-shortcut-row">
        <div>
            <div className="mssql-config-row-label">{item.label}</div>
            <div className="mssql-config-row-description">{item.description}</div>
        </div>
        <ShortcutChip value={value} onRecord={onRecord} />
    </div>
);

const SettingControl = ({
    definition,
    value,
    onChange,
    themeKind,
}: {
    definition: MssqlSettingDefinition;
    value: unknown;
    onChange: (value: unknown) => void;
    themeKind: ColorThemeKind;
}) => {
    if (definition.enumValues?.length) {
        return (
            <Select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
                {definition.enumValues.map((enumValue, index) => (
                    <option key={enumValue} value={enumValue}>
                        {definition.enumDescriptions?.[index] ?? enumValue}
                    </option>
                ))}
            </Select>
        );
    }

    if (definition.inputType === "boolean") {
        return (
            <Switch
                checked={Boolean(value)}
                label={Boolean(value) ? "Enabled" : "Disabled"}
                onChange={(_event, data) => onChange(data.checked)}
            />
        );
    }

    if (definition.inputType === "nullableBoolean") {
        return (
            <Select
                value={value === null || value === undefined ? "default" : String(Boolean(value))}
                onChange={(event) => {
                    const nextValue = event.target.value;
                    onChange(nextValue === "default" ? null : nextValue === "true");
                }}>
                <option value="default">Default</option>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
            </Select>
        );
    }

    if (definition.inputType === "number") {
        return (
            <Input
                type="number"
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(_event, data) =>
                    onChange(data.value.trim().length === 0 ? null : Number(data.value))
                }
            />
        );
    }

    if (definition.inputType === "string") {
        return (
            <Input
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(_event, data) => onChange(data.value)}
            />
        );
    }

    return (
        <div className="mssql-config-json-editor">
            <VscodeEditor
                height="100%"
                width="100%"
                language="json"
                themeKind={themeKind}
                value={getJsonSettingText(value)}
                options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    lineNumbers: "off",
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 8,
                    overviewRulerLanes: 0,
                    automaticLayout: true,
                }}
                onChange={(editorValue) => {
                    try {
                        onChange(parseJsonSettingText(editorValue ?? ""));
                    } catch {
                        // Keep the editor responsive while the user is midway through JSON edits.
                    }
                }}
            />
        </div>
    );
};

export const MssqlConfigurationPage = () => {
    const loc = locConstants.mssqlConfiguration;
    const common = locConstants.common;
    const context = useContext(MssqlConfigurationContext);
    const { themeKind } = useVscodeWebview();
    const state = useMssqlConfigurationSelector((s) => s);
    const [activeTab, setActiveTab] = useState<ConfigurationTab>("queries");
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [quickQueries, setQuickQueries] = useState<QuickQuerySlot[]>(() =>
        normalizeQuickQueries(state.quickQueries),
    );
    const [quickQueryKeybindings, setQuickQueryKeybindings] = useState<Record<string, string>>(
        state.quickQueryKeybindings ?? {},
    );
    const [webviewShortcuts, setWebviewShortcuts] = useState<Record<string, string>>(
        state.webviewShortcuts ?? {},
    );
    const [mssqlSettings, setMssqlSettings] = useState<Record<string, unknown>>(
        state.mssqlSettings ?? {},
    );
    const [expandedQueries, setExpandedQueries] = useState<Record<number, boolean>>({});
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [recording, setRecording] = useState<
        { kind: "quickQuery"; commandId: string } | { kind: "webview"; action: WebviewAction }
    >();
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastSavedPayloadRef = useRef("");

    useEffect(() => {
        const normalizedQuickQueries = normalizeQuickQueries(state.quickQueries);
        const normalizedKeybindings = state.quickQueryKeybindings ?? {};
        const normalizedShortcuts = state.webviewShortcuts ?? {};
        const normalizedSettings = state.mssqlSettings ?? {};
        setQuickQueries(normalizedQuickQueries);
        setQuickQueryKeybindings(normalizedKeybindings);
        setWebviewShortcuts(normalizedShortcuts);
        setMssqlSettings(normalizedSettings);
        lastSavedPayloadRef.current = JSON.stringify(
            buildPayload(
                normalizedQuickQueries,
                normalizedKeybindings,
                normalizedShortcuts,
                normalizedSettings,
            ),
        );
    }, [
        state.quickQueries,
        state.quickQueryKeybindings,
        state.webviewShortcuts,
        state.mssqlSettings,
    ]);

    useEffect(() => {
        const focusedQuickQuerySlot = state.focusedQuickQuerySlot;
        if (
            focusedQuickQuerySlot &&
            focusedQuickQuerySlot >= 1 &&
            focusedQuickQuerySlot <= quickQueryCount
        ) {
            setActiveTab("queries");
            setExpandedQueries((current) => ({
                ...current,
                [focusedQuickQuerySlot - 1]: true,
            }));
        }
    }, [state.focusedQuickQuerySlot]);

    useEffect(
        () => () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            if (savedTimerRef.current) {
                clearTimeout(savedTimerRef.current);
            }
        },
        [],
    );

    const scheduleSave = useCallback(
        (payload: SaveMssqlConfigurationPayload) => {
            if (!context) {
                return;
            }

            const payloadKey = JSON.stringify(payload);
            if (payloadKey === lastSavedPayloadRef.current) {
                return;
            }

            setSaveState("saving");
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            if (savedTimerRef.current) {
                clearTimeout(savedTimerRef.current);
            }

            saveTimerRef.current = setTimeout(() => {
                context.saveConfiguration(payload);
                lastSavedPayloadRef.current = payloadKey;
                setSaveState("saved");
                savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2500);
            }, 700);
        },
        [context],
    );

    const saveWith = useCallback(
        (
            nextQuickQueries = quickQueries,
            nextQuickQueryKeybindings = quickQueryKeybindings,
            nextWebviewShortcuts = webviewShortcuts,
            nextMssqlSettings = mssqlSettings,
        ) => {
            scheduleSave(
                buildPayload(
                    nextQuickQueries,
                    nextQuickQueryKeybindings,
                    nextWebviewShortcuts,
                    nextMssqlSettings,
                ),
            );
        },
        [mssqlSettings, quickQueries, quickQueryKeybindings, scheduleSave, webviewShortcuts],
    );

    if (!context) {
        return undefined;
    }

    const updateQuickQuery = (index: number, value: QuickQuerySlot) => {
        const nextQuickQueries = quickQueries.map((slot, slotIndex) =>
            slotIndex === index ? value : slot,
        );
        setQuickQueries(nextQuickQueries);
        saveWith(nextQuickQueries);
    };

    const updateQuickQueryShortcut = (commandId: string, value: string) => {
        const nextKeybindings = {
            ...quickQueryKeybindings,
            [commandId]: value,
        };
        setQuickQueryKeybindings(nextKeybindings);
        saveWith(quickQueries, nextKeybindings);
    };

    const updateWebviewShortcut = (action: WebviewAction, value: string) => {
        const nextShortcuts = {
            ...webviewShortcuts,
            [action]: value,
        };
        setWebviewShortcuts(nextShortcuts);
        saveWith(quickQueries, quickQueryKeybindings, nextShortcuts);
    };

    const updateMssqlSetting = (key: string, value: unknown) => {
        const nextSettings = {
            ...mssqlSettings,
            [key]: value,
        };
        setMssqlSettings(nextSettings);
        saveWith(quickQueries, quickQueryKeybindings, webviewShortcuts, nextSettings);
    };

    const renderQueries = () => (
        <>
            <div className="mssql-config-help-text">
                Click a slot to configure its SQL query, keyboard shortcut, and execution behavior.
            </div>
            <div className="mssql-config-card">
                {quickQueries.map((slot, index) => {
                    const commandId = getQuickQueryCommandId(index + 1);
                    return (
                        <QuickQueryRow
                            key={commandId}
                            slot={slot}
                            shortcut={quickQueryKeybindings[commandId] ?? ""}
                            expanded={!!expandedQueries[index]}
                            onToggle={() =>
                                setExpandedQueries((current) => ({
                                    ...current,
                                    [index]: !current[index],
                                }))
                            }
                            onChange={(value) => updateQuickQuery(index, value)}
                            onRecord={() => setRecording({ kind: "quickQuery", commandId })}
                            themeKind={themeKind}
                        />
                    );
                })}
            </div>
        </>
    );

    const renderShortcuts = () => (
        <>
            <div className="mssql-config-help-text">
                Keyboard shortcuts for MSSQL webviews. Click the keyboard icon on any row to record
                a new shortcut.
            </div>
            <div className="mssql-config-shortcut-groups">
                {shortcutGroups.map((group) => {
                    const isCollapsed = !!collapsedGroups[group.id];
                    const configuredCount = group.items.filter(
                        (item) => !!webviewShortcuts[item.action],
                    ).length;

                    return (
                        <div key={group.id} className="mssql-config-card">
                            <Button
                                appearance="transparent"
                                className="mssql-config-group-header"
                                onClick={() =>
                                    setCollapsedGroups((current) => ({
                                        ...current,
                                        [group.id]: !current[group.id],
                                    }))
                                }>
                                <span>
                                    {isCollapsed ? (
                                        <ChevronRight12Regular />
                                    ) : (
                                        <ChevronDown12Regular />
                                    )}
                                </span>
                                <span className="mssql-config-group-title">
                                    <span>{group.label}</span>
                                    <span>{group.description}</span>
                                </span>
                                <span className="mssql-config-count-chip">
                                    {configuredCount}/{group.items.length}
                                </span>
                            </Button>
                            {!isCollapsed && (
                                <div className="mssql-config-webview-shortcuts">
                                    {group.items.map((item) => (
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
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );

    const renderSettings = () => {
        const groupedSettings = state.mssqlSettingDefinitions.reduce(
            (groups, definition) => {
                groups[definition.group] ??= [];
                groups[definition.group].push(definition);
                return groups;
            },
            {} as Record<string, MssqlSettingDefinition[]>,
        );

        return (
            <>
                <div className="mssql-config-help-text">
                    Configure MSSQL extension settings. Changes are saved to your user settings.
                </div>
                <div className="mssql-config-shortcut-groups">
                    {Object.entries(groupedSettings).map(([group, definitions]) => {
                        const groupId = `settings:${group}`;
                        const isCollapsed = !!collapsedGroups[groupId];

                        return (
                            <div key={group} className="mssql-config-card">
                                <Button
                                    appearance="transparent"
                                    className="mssql-config-group-header"
                                    onClick={() =>
                                        setCollapsedGroups((current) => ({
                                            ...current,
                                            [groupId]: !current[groupId],
                                        }))
                                    }>
                                    <span>
                                        {isCollapsed ? (
                                            <ChevronRight12Regular />
                                        ) : (
                                            <ChevronDown12Regular />
                                        )}
                                    </span>
                                    <span className="mssql-config-group-title">
                                        <span>{group}</span>
                                        <span>{definitions.length} settings</span>
                                    </span>
                                </Button>
                                {!isCollapsed && (
                                    <div className="mssql-config-settings-list">
                                        {definitions.map((definition) => (
                                            <Field
                                                key={definition.key}
                                                className="mssql-config-setting-field"
                                                label={definition.label}
                                                hint={
                                                    <span>
                                                        <span>{definition.description}</span>
                                                        <span className="mssql-config-setting-key">
                                                            {definition.key}
                                                        </span>
                                                    </span>
                                                }>
                                                <SettingControl
                                                    definition={definition}
                                                    value={mssqlSettings[definition.key]}
                                                    themeKind={themeKind}
                                                    onChange={(value) =>
                                                        updateMssqlSetting(definition.key, value)
                                                    }
                                                />
                                            </Field>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

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
            errorMessage={state.errorMessage}
            maxContentWidth="wide"
            iconSize={40}
            headerEnd={<SaveIndicator state={saveState} />}
            footerEnd={
                <Button appearance="secondary" onClick={context.closeDialog}>
                    {common.close}
                </Button>
            }>
            <style>{styles}</style>
            <div className="mssql-config-page" aria-label={loc.title}>
                <TabList
                    className="mssql-config-tabs"
                    selectedValue={activeTab}
                    onTabSelect={(_event, data) => setActiveTab(data.value as ConfigurationTab)}
                    aria-label="Configuration sections">
                    <Tab value="queries">{loc.quickQueries}</Tab>
                    <Tab value="settings">Settings</Tab>
                    <Tab value="shortcuts">{loc.webviewShortcuts}</Tab>
                </TabList>
                {activeTab === "queries"
                    ? renderQueries()
                    : activeTab === "settings"
                      ? renderSettings()
                      : renderShortcuts()}
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
    --mssql-config-bg: #1a1a1b;
    --mssql-config-surface: #222224;
    --mssql-config-raised: #2a2a2d;
    --mssql-config-input: #323235;
    --mssql-config-border: rgba(255,255,255,0.06);
    --mssql-config-border-md: rgba(255,255,255,0.10);
    --mssql-config-border-hi: rgba(255,255,255,0.18);
    --mssql-config-fg: #e2e2e5;
    --mssql-config-muted: #7f7f8c;
    --mssql-config-dim: #42424a;
    --mssql-config-hover: rgba(255,255,255,0.04);
    --mssql-config-accent: #0078d4;
    --mssql-config-accent-hover: #1a8fe0;
    --mssql-config-accent-dim: rgba(0,120,212,0.14);
    --mssql-config-accent-text: #4dabf7;
    --mssql-config-success: #3ec9a7;
    --mssql-config-danger: #e05c5c;
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

.mssql-config-spinner {
    animation: mssql-config-spin 0.7s linear infinite;
    border: 1.3px solid rgba(255,255,255,0.16);
    border-radius: 50%;
    border-top-color: var(--mssql-config-accent-text);
    height: 12px;
    width: 12px;
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

.mssql-config-tabs .mssql-config-tab-active {
    border-bottom-color: var(--mssql-config-accent);
    color: var(--mssql-config-fg);
    font-weight: 600;
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
    border-bottom: 1px solid var(--mssql-config-border);
}

.mssql-config-query-row:last-child {
    border-bottom: none;
}

.mssql-config-row-expanded {
    background: rgba(0,120,212,0.04);
}

.mssql-config-query-summary,
.mssql-config-group-header {
    align-items: center;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    display: flex;
    font-family: var(--mssql-config-font);
    gap: 12px;
    padding: 10px 16px;
    text-align: left;
    width: 100%;
}

.mssql-config-query-summary:hover,
.mssql-config-group-header:hover {
    background: var(--mssql-config-hover);
}

.mssql-config-chevron {
    color: var(--mssql-config-dim);
    display: flex;
    flex-shrink: 0;
}

.mssql-config-row-expanded .mssql-config-chevron {
    color: var(--mssql-config-accent-text);
}

.mssql-config-query-title,
.mssql-config-group-title {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
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

.mssql-config-status-chip,
.mssql-config-unconfigured-chip,
.mssql-config-count-chip {
    border-radius: 4px;
    flex-shrink: 0;
    font-size: 11.5px;
    padding: 2px 8px;
}

.mssql-config-status-chip {
    background: var(--mssql-config-accent-dim);
    border: 1px solid rgba(0,120,212,0.25);
    color: var(--mssql-config-accent-text);
    font-family: var(--mssql-config-mono);
}

.mssql-config-unconfigured-chip {
    background: rgba(255,255,255,0.03);
    border: 1px dashed var(--mssql-config-border);
    color: var(--mssql-config-dim);
}

.mssql-config-query-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 16px 16px 52px;
}

.mssql-config-controls-row {
    align-items: end;
    display: grid;
    gap: 12px;
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
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

.mssql-config-field select {
    background: var(--mssql-config-input);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 5px;
    box-sizing: border-box;
    color: var(--mssql-config-fg);
    font-family: var(--mssql-config-font);
    font-size: 12.5px;
    outline: none;
    width: 100%;
}

.mssql-config-field select {
    cursor: pointer;
    min-height: 30px;
    padding: 5px 10px;
}

.mssql-config-field select:focus {
    border-color: var(--mssql-config-accent);
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
}

.mssql-config-shortcut-chip {
    background: var(--mssql-config-input);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 5px;
    color: var(--mssql-config-fg);
    font-family: var(--mssql-config-mono);
    font-size: 12px;
    min-width: 140px;
    padding: 5px 10px;
    user-select: none;
}

.mssql-config-empty,
.mssql-config-muted {
    color: var(--mssql-config-dim) !important;
}

.mssql-config-icon-button {
    align-items: center;
    background: var(--mssql-config-raised);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 5px;
    color: var(--mssql-config-muted);
    cursor: pointer;
    display: flex;
    flex-shrink: 0;
    height: 28px;
    justify-content: center;
    width: 30px;
}

.mssql-config-icon-button svg {
    height: 16px;
    width: 16px;
}

.mssql-config-icon-button:hover {
    background: var(--mssql-config-accent-dim);
    border-color: var(--mssql-config-accent);
    color: var(--mssql-config-accent-text);
}

.mssql-config-shortcut-groups {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mssql-config-group-header {
    background: var(--mssql-config-raised);
    gap: 10px;
    padding: 11px 16px;
}

.mssql-config-group-title > span:last-child,
.mssql-config-row-description {
    color: var(--mssql-config-muted);
    font-size: 11.5px;
    line-height: 1.5;
}

.mssql-config-count-chip {
    background: rgba(255,255,255,0.05);
    color: var(--mssql-config-dim);
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

.mssql-config-settings-list {
    padding: 0 16px 4px;
}

.mssql-config-setting-field {
    border-bottom: 1px solid var(--mssql-config-border);
    padding: 12px 0;
}

.mssql-config-setting-field:last-child {
    border-bottom: none;
}

.mssql-config-setting-field label {
    color: var(--mssql-config-fg);
    font-size: 13px;
    font-weight: 500;
}

.mssql-config-setting-field [role="note"] {
    color: var(--mssql-config-muted);
    display: flex;
    flex-direction: column;
    font-size: 11.5px;
    gap: 4px;
    line-height: 1.5;
}

.mssql-config-setting-key {
    color: var(--mssql-config-dim);
    display: block;
    font-family: var(--mssql-config-mono);
    font-size: 11px;
}

.mssql-config-setting-field input,
.mssql-config-setting-field select {
    max-width: 520px;
}

.mssql-config-json-editor {
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 6px;
    height: 160px;
    max-width: 640px;
    overflow: hidden;
}

.mssql-config-json-editor:focus-within {
    border-color: var(--mssql-config-accent);
}

.mssql-config-recorder {
    background: var(--mssql-config-surface);
    border: 1px solid var(--mssql-config-border-md);
    border-radius: 12px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.7);
    overflow: hidden;
    width: 360px;
}

.mssql-config-recorder-header {
    border-bottom: 1px solid var(--mssql-config-border);
    padding: 18px 20px 14px;
}

.mssql-config-recorder-title {
    color: var(--mssql-config-fg);
    font-size: 14px;
    font-weight: 700;
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

.mssql-config-recorder-footer {
    border-top: 1px solid var(--mssql-config-border);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 12px 20px;
}

@keyframes mssql-config-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

@keyframes mssql-config-spin {
    to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
    .mssql-config-controls-row,
    .mssql-config-webview-shortcut-row {
        grid-template-columns: 1fr;
    }

    .mssql-config-query-summary {
        align-items: flex-start;
    }

    .mssql-config-status-chip,
    .mssql-config-unconfigured-chip {
        display: none;
    }

    .mssql-config-query-editor {
        padding-left: 16px;
    }
}
`;
