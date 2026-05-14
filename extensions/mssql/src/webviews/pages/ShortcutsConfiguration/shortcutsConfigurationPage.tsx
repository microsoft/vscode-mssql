/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash/debounce";
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
    Spinner,
    Tab,
    TabList,
    Tooltip,
} from "@fluentui/react-components";
import {
    Checkmark12Regular,
    Keyboard24Regular,
    Search16Regular,
    Settings24Regular,
} from "@fluentui/react-icons";
import { CollapsibleSection } from "../../common/collapsibleSection";
import { DialogPageShell } from "../../common/dialogPageShell";
import { locConstants } from "../../common/locConstants";
import { SegmentedControl } from "../../common/segmentedControl";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { isMac } from "../../common/utils";
import { ColorThemeKind, WebviewAction } from "../../../sharedInterfaces/webview";
import {
    getQuickQueryCommandId,
    normalizeQuickQueries,
    QuickQueryConnectionMode,
    QuickQueryExecutionMode,
    QuickQuerySlot,
    quickQueryCount,
    SaveShortcutsConfigurationChangedSections,
    SaveShortcutsConfigurationPayload,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { ShortcutsConfigurationContext } from "./shortcutsConfigurationStateProvider";
import { useShortcutsConfigurationSelector } from "./shortcutsConfigurationSelector";

type ConfigurationTab = "queries" | "shortcuts";
type SaveState = "idle" | "saving" | "saved";

const executionOptions = [
    { value: QuickQueryExecutionMode.Open, labelKey: "openOnly" },
    { value: QuickQueryExecutionMode.OpenAndRun, labelKey: "openAndRun" },
] as const;

const connectionOptions = [
    { value: QuickQueryConnectionMode.Prompt, labelKey: "prompt" },
    { value: QuickQueryConnectionMode.ActiveOrPrompt, labelKey: "activeOrPrompt" },
] as const;

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
const keysAllowedWithoutModifier = new Set([
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
]);

function normalizeRecordedKey(event: KeyboardEvent): string {
    const codeMap: Record<string, string> = {
        Comma: "comma",
        Period: "period",
        Slash: "slash",
        Backslash: "backslash",
        Minus: "minus",
        Equal: "equal",
        Semicolon: "semicolon",
        Quote: "quote",
        Backquote: "backquote",
        BracketLeft: "bracketleft",
        BracketRight: "bracketright",
    };
    if (/^Key[A-Z]$/.test(event.code)) {
        return event.code.slice(3).toLowerCase();
    }
    if (/^Digit[0-9]$/.test(event.code)) {
        return event.code.slice(5);
    }
    if (codeMap[event.code]) {
        return codeMap[event.code];
    }

    const specialKeyMap: Record<string, string> = {
        " ": "space",
        ",": "comma",
        ".": "period",
        "/": "slash",
        "\\": "backslash",
        "-": "minus",
        "=": "equal",
        ";": "semicolon",
        "'": "quote",
        "`": "backquote",
        "[": "bracketleft",
        "]": "bracketright",
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

    return specialKeyMap[event.key] ?? event.key.toLowerCase();
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
    if (modifierKeys.has(event.key)) {
        return undefined;
    }

    const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    if (!hasModifier && !keysAllowedWithoutModifier.has(event.key)) {
        return undefined;
    }

    const parts: string[] = [];
    if (event.ctrlKey) {
        parts.push("ctrl");
    }
    if (event.metaKey) {
        parts.push("cmd");
    }
    if (event.altKey) {
        parts.push("alt");
    }
    if (event.shiftKey) {
        parts.push("shift");
    }
    parts.push(normalizeRecordedKey(event));
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
                ctrlcmd: isMac() ? "Cmd" : "Ctrl",
                cmd: "Cmd",
                command: "Cmd",
                meta: isMac() ? "Cmd" : "Meta",
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
                comma: ",",
                period: ".",
                dot: ".",
                slash: "/",
                forwardslash: "/",
                backslash: "\\",
                minus: "-",
                hyphen: "-",
                equal: "=",
                equals: "=",
                semicolon: ";",
                quote: "'",
                apostrophe: "'",
                backquote: "`",
                backtick: "`",
                bracketleft: "[",
                leftbracket: "[",
                bracketright: "]",
                rightbracket: "]",
            };
            return tokenMap[lower] ?? (lower.length === 1 ? lower.toUpperCase() : token);
        })
        .join("+");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMatchesSearch(text: string, searchTerm: string): boolean {
    return text.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase());
}

const HighlightedText = ({ text, searchTerm }: { text: string; searchTerm: string }) => {
    const term = searchTerm.trim();
    if (!term) {
        return <>{text}</>;
    }

    const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, "gi"));
    return (
        <>
            {parts.map((part, index) =>
                part.toLocaleLowerCase() === term.toLocaleLowerCase() ? (
                    <mark key={`${part}-${index}`} className="mssql-config-search-match">
                        {part}
                    </mark>
                ) : (
                    <span key={`${part}-${index}`}>{part}</span>
                ),
            )}
        </>
    );
};

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

const SaveIndicator = ({ state }: { state: SaveState }) => {
    if (state === "idle") {
        return null;
    }

    return (
        <div className="mssql-config-save-indicator">
            {state === "saving" ? (
                <>
                    <Spinner size="tiny" />
                    <span>{locConstants.shortcutsConfiguration.saving}</span>
                </>
            ) : (
                <>
                    <Checkmark12Regular />
                    <span>{locConstants.shortcutsConfiguration.saved}</span>
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
                    <DialogTitle>{locConstants.shortcutsConfiguration.recordShortcut}</DialogTitle>
                    <DialogContent>
                        <div className="mssql-config-recorder-subtitle">
                            {locConstants.shortcutsConfiguration.recordShortcutDescription}
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
                                        <span>
                                            {locConstants.shortcutsConfiguration.recordingShortcut}
                                        </span>
                                    </div>
                                ) : hasPreview ? (
                                    <span className="mssql-config-shortcut-preview">
                                        {formatShortcut(preview)}
                                    </span>
                                ) : (
                                    <span className="mssql-config-empty">
                                        {locConstants.shortcutsConfiguration.noShortcut}
                                    </span>
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
                                    {locConstants.shortcutsConfiguration.rerecord}
                                </Button>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {locConstants.common.cancel}
                        </Button>
                        {hasPreview ? (
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    onSave(preview);
                                    onClose();
                                }}>
                                {locConstants.common.save}
                            </Button>
                        ) : (
                            <Button
                                appearance="secondary"
                                onClick={() => {
                                    onSave("");
                                    onClose();
                                }}>
                                {locConstants.shortcutsConfiguration.clearShortcut}
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const ShortcutDisplay = ({ value }: { value: string }) => (
    <div className={`mssql-config-shortcut-display ${value ? "" : "mssql-config-empty"}`}>
        {formatShortcut(value) || locConstants.shortcutsConfiguration.noShortcut}
    </div>
);

const ShortcutChip = ({
    value,
    onRecord,
    recordLabel,
}: {
    value: string;
    onRecord: () => void;
    recordLabel: string;
}) => (
    <div className="mssql-config-shortcut-chip-row">
        <ShortcutDisplay value={value} />
        <Tooltip content={recordLabel} relationship="label">
            <Button
                appearance="secondary"
                icon={<Keyboard24Regular />}
                aria-label={recordLabel}
                onClick={onRecord}
            />
        </Tooltip>
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
    loc,
}: {
    slot: QuickQuerySlot;
    shortcut: string;
    expanded: boolean;
    onToggle: () => void;
    onChange: (value: QuickQuerySlot, shouldSave?: boolean) => void;
    onRecord: () => void;
    themeKind: ColorThemeKind;
    loc: typeof locConstants.shortcutsConfiguration;
}) => {
    const slotRef = useRef(slot);
    const onChangeRef = useRef(onChange);
    slotRef.current = slot;
    onChangeRef.current = onChange;

    const query = slot.query.trim();
    const preview = query.length > 60 ? `${query.slice(0, 60)}...` : query;

    return (
        <CollapsibleSection
            className="mssql-config-query-row"
            buttonClassName="mssql-config-query-summary"
            panelClassName="mssql-config-query-editor"
            open={expanded}
            onOpenChange={onToggle}
            title={
                <span className="mssql-config-query-summary-content">
                    <span className="mssql-config-query-title">
                        <span>{slot.name}</span>
                        {preview ? (
                            <span className="mssql-config-query-preview">{preview}</span>
                        ) : (
                            <span className="mssql-config-query-empty">{loc.noQuerySet}</span>
                        )}
                    </span>
                    <ShortcutDisplay value={shortcut} />
                </span>
            }>
            <Field className="mssql-config-field mssql-config-name-field" label={loc.name}>
                <Input
                    value={slot.name}
                    onChange={(_event, data) =>
                        onChange({
                            ...slot,
                            name: data.value,
                        })
                    }
                />
            </Field>
            <div className="mssql-config-controls-row">
                <Field
                    className="mssql-config-field mssql-config-shortcut-field"
                    label={loc.shortcut}>
                    <ShortcutChip
                        value={shortcut}
                        onRecord={onRecord}
                        recordLabel={`${loc.recordShortcut}: ${slot.name}`}
                    />
                </Field>
                <Field className="mssql-config-field" label={loc.execution}>
                    <SegmentedControl<QuickQueryExecutionMode>
                        className="mssql-config-segmented-control"
                        value={slot.executionMode}
                        ariaLabel={loc.execution}
                        options={executionOptions.map((option) => ({
                            value: option.value,
                            label: loc[option.labelKey],
                        }))}
                        onValueChange={(value) =>
                            onChange({
                                ...slot,
                                executionMode: value,
                            })
                        }
                    />
                </Field>
                <Field className="mssql-config-field" label={loc.connection}>
                    <SegmentedControl<QuickQueryConnectionMode>
                        className="mssql-config-segmented-control"
                        value={slot.connectionMode}
                        ariaLabel={loc.connection}
                        options={connectionOptions.map((option) => ({
                            value: option.value,
                            label: loc[option.labelKey],
                        }))}
                        onValueChange={(value) =>
                            onChange({
                                ...slot,
                                connectionMode: value,
                            })
                        }
                    />
                </Field>
            </div>
            <Field className="mssql-config-field" label={loc.query}>
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
                        onChange={(value) => onChange({ ...slot, query: value ?? "" }, false)}
                        onMount={(editor) => {
                            const disposable = editor.onDidBlurEditorWidget(() => {
                                onChangeRef.current(
                                    {
                                        ...slotRef.current,
                                        query: editor.getValue(),
                                    },
                                    true,
                                );
                            });
                            editor.onDidDispose(() => disposable.dispose());
                        }}
                    />
                </div>
            </Field>
        </CollapsibleSection>
    );
};

const WebviewShortcutRow = ({
    item,
    value,
    onRecord,
    loc,
    searchTerm,
}: {
    item: ShortcutItem;
    value: string;
    onRecord: () => void;
    loc: typeof locConstants.shortcutsConfiguration;
    searchTerm: string;
}) => (
    <div className="mssql-config-webview-shortcut-row">
        <div>
            <div className="mssql-config-row-label">
                <HighlightedText
                    text={loc.webviewShortcutLabels[item.action] ?? item.label}
                    searchTerm={searchTerm}
                />
            </div>
            <div className="mssql-config-row-description">
                <HighlightedText
                    text={loc.webviewShortcutDescriptions[item.action] ?? item.description}
                    searchTerm={searchTerm}
                />
            </div>
        </div>
        <ShortcutChip
            value={value}
            onRecord={onRecord}
            recordLabel={`${loc.recordShortcut}: ${loc.webviewShortcutLabels[item.action] ?? item.label}`}
        />
    </div>
);

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
        (payload: SaveShortcutsConfigurationPayload, payloadDataKey: string) => {
            if (!context) {
                return;
            }

            context.saveConfiguration(payload);
            pendingPayloadRef.current = payloadDataKey;
            pendingChangedSectionsRef.current = payload.changedSections;
            pendingSaveVersionRef.current = localChangeVersionRef.current;
        },
        [context],
    );

    const debouncedDispatchSave = useMemo(
        () =>
            debounce((payload: SaveShortcutsConfigurationPayload, payloadDataKey: string) => {
                scheduledPayloadRef.current = undefined;
                dispatchSave(payload, payloadDataKey);
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

    const flushPendingSave = useCallback(() => {
        flushUnsavedQueryEdits();
        if (!scheduledPayloadRef.current || !context) {
            return;
        }

        const payload = scheduledPayloadRef.current;
        scheduledPayloadRef.current = undefined;
        debouncedDispatchSave.cancel();
        dispatchSave(payload, getPayloadDataKey(payload));
    }, [context, debouncedDispatchSave, dispatchSave, flushUnsavedQueryEdits]);

    useEffect(
        () => () => {
            flushPendingSave();
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
                    const groupLabel =
                        group.id === "navigation"
                            ? loc.shortcutGroupNavigation
                            : group.id === "results"
                              ? loc.shortcutGroupResults
                              : group.id === "selection"
                                ? loc.shortcutGroupSelection
                                : loc.shortcutGroupCopyExport;
                    const groupDescription =
                        group.id === "navigation"
                            ? loc.shortcutGroupNavigationDescription
                            : group.id === "results"
                              ? loc.shortcutGroupResultsDescription
                              : group.id === "selection"
                                ? loc.shortcutGroupSelectionDescription
                                : loc.shortcutGroupCopyExportDescription;
                    const groupMatches =
                        !!searchTerm &&
                        (textMatchesSearch(groupLabel, searchTerm) ||
                            textMatchesSearch(groupDescription, searchTerm));
                    const visibleItems = group.items.filter((item) => {
                        if (!searchTerm || groupMatches) {
                            return true;
                        }

                        return (
                            textMatchesSearch(
                                loc.webviewShortcutLabels[item.action] ?? item.label,
                                searchTerm,
                            ) ||
                            textMatchesSearch(
                                loc.webviewShortcutDescriptions[item.action] ?? item.description,
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
                        flushPendingSave();
                        context.closeDialog();
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

.mssql-config-count-chip {
    border-radius: 4px;
    flex-shrink: 0;
    font-size: 11.5px;
    padding: 2px 8px;
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
