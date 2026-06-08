/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import debounce from "lodash/debounce";
import {
    Button,
    Input,
    makeStyles,
    mergeClasses,
    Tab,
    TabList,
    tokens,
} from "@fluentui/react-components";
import { Keyboard16Regular, Search16Regular, Settings24Regular } from "@fluentui/react-icons";
import {
    type Editor,
    type EditorArguments,
    type EditorValidationResult,
} from "@slickgrid-universal/common";
import { type Column, type GridOption, type SlickgridReactInstance } from "slickgrid-react";
import { CollapsibleSection } from "../../common/collapsibleSection";
import { DialogPageShell } from "../../common/dialogPageShell";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    FluentSlickGrid,
} from "../../common/FluentSlickGrid/FluentSlickGrid";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import {
    getQuickQueryCommandId,
    getQuickQuerySlotName,
    normalizeQuickQueries,
    QuickQueryExecutionMode,
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
    QuickQueryEditorDialog,
    SaveIndicator,
    SaveState,
    ShortcutRecorder,
    WebviewShortcutRow,
} from "./shortcutComponents";
import { formatShortcut, HighlightedText, textMatchesSearch } from "./shortcutKeyboardUtils";

type ConfigurationTab = "queries" | "shortcuts";
const quickQueryGridContainerId = "shortcutsQuickQueriesGridContainer";
const quickQueryGridId = "shortcutsQuickQueriesGrid";
const shortcutKeyboardIconMarkup = renderToStaticMarkup(<Keyboard16Regular aria-hidden />);

interface QuickQueryGridRow {
    id: number;
    index: number;
    commandId: string;
    slot: QuickQuerySlot;
    name: string;
    query: string;
    shortcut: string;
    autoExecute: boolean;
}

function createDialogEditor(openDialog: (row: QuickQueryGridRow) => void) {
    return class DialogEditor implements Editor {
        static suppressClearOnEdit = true;
        dataContext?: QuickQueryGridRow;
        private animationFrame: number | undefined;

        constructor(private readonly args: EditorArguments) {
            this.dataContext = args.item as QuickQueryGridRow;
            this.init();
        }

        init(): void {
            this.animationFrame = window.requestAnimationFrame(() => {
                this.animationFrame = undefined;
                this.args.cancelChanges();
                openDialog(this.dataContext!);
            });
        }

        destroy(): void {
            if (this.animationFrame !== undefined) {
                window.cancelAnimationFrame(this.animationFrame);
                this.animationFrame = undefined;
            }
        }

        focus(): void {}

        loadValue(): void {}

        applyValue(): void {}

        serializeValue(): string {
            return "";
        }

        isValueChanged(): boolean {
            return false;
        }

        validate(): EditorValidationResult {
            return { valid: true, msg: null };
        }
    };
}

const useStyles = makeStyles({
    page: {
        color: "var(--vscode-foreground)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
        gap: "16px",
        minWidth: 0,
    },
    tabs: {
        display: "flex",
    },
    helpText: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
    },
    card: {
        backgroundColor: "var(--vscode-editor-background)",
        border: "1px solid var(--vscode-input-border, var(--vscode-editorGroup-border))",
        borderRadius: "8px",
        overflow: "hidden",
    },
    quickQueryGridCard: {
        borderRadius: 0,
        height: "calc(100vh - 260px)",
        minHeight: "360px",
        width: "100%",
    },
    quickQueryGridScroller: {
        height: "100%",
        overflowX: "auto",
    },
    quickQueryGridContainer: {
        "--slick-border-color": "var(--vscode-editorWidget-border)",
        "--slick-canvas-bg-color": "var(--vscode-editor-background)",
        "--slick-cell-border-bottom": "1px solid var(--vscode-editorWidget-border)",
        "--slick-cell-border-left": "0",
        "--slick-cell-border-right": "1px solid var(--vscode-editorWidget-border)",
        "--slick-cell-border-top": "1px solid var(--vscode-editorWidget-border)",
        "--slick-cell-box-shadow": "none",
        "--slick-cell-even-background-color": "var(--vscode-editor-background)",
        "--slick-cell-odd-background-color": "var(--vscode-editor-background)",
        "--slick-cell-selected-color": "var(--vscode-list-activeSelectionBackground)",
        "--slick-cell-text-color": "var(--vscode-foreground)",
        "--slick-container-border-bottom": "1px solid var(--vscode-editorWidget-border)",
        "--slick-container-border-top": "1px solid var(--vscode-editorWidget-border)",
        "--slick-grid-border-color": "var(--vscode-editorWidget-border)",
        "--slick-grid-header-background": "var(--vscode-keybindingTable-headerBackground)",
        "--slick-header-background-color": "var(--vscode-keybindingTable-headerBackground)",
        "--slick-header-column-background-active": "var(--vscode-keybindingTable-headerBackground)",
        "--slick-header-column-height": "28px",
        "--slick-header-font-size": "12px",
        "--slick-header-row-count": "1",
        "--slick-header-text-color": "var(--vscode-editor-foreground)",
        "--slick-row-mouse-hover-color": "var(--vscode-list-hoverBackground)",
        "--slick-row-selected-color": "var(--vscode-list-activeSelectionBackground)",
        "--slick-scrollbar-color":
            "var(--vscode-scrollbarSlider-background) var(--vscode-editor-background)",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
        height: "100%",
        minWidth: "760px",
        width: "100%",
        "& .grid-pane, & .slickgrid-container, & .slick-viewport, & .slick-pane, & .slick-pane-top, & .slick-pane-bottom, & .slick-pane-left, & .slick-pane-right, & .slick-canvas":
            {
                backgroundColor: "var(--vscode-editor-background)",
                borderRadius: 0,
                color: "var(--vscode-foreground)",
            },
        "& .slick-header, & .slick-header-columns, & .slick-header-column": {
            backgroundColor: "var(--vscode-keybindingTable-headerBackground) !important",
            borderBottomColor: "var(--vscode-editorWidget-border) !important",
            borderLeftColor: "var(--vscode-editorWidget-border) !important",
            borderRightColor: "var(--vscode-editorWidget-border) !important",
            borderRadius: "0 !important",
            borderTopColor: "var(--vscode-editorWidget-border) !important",
            color: "var(--vscode-editor-foreground) !important",
        },
        "& .slick-header-columns": {
            height: "28px !important",
        },
        "& .slick-header-column, & .slick-header-column.ui-state-default, & .slick-header-column.slick-state-default":
            {
                boxSizing: "border-box",
                float: "left",
                height: "28px !important",
                lineHeight: "16px !important",
                margin: 0,
                overflow: "hidden",
                padding: "4px !important",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            },
        "& .slick-header-column .slick-column-name": {
            lineHeight: "16px",
            margin: 0,
        },
        "& .slick-row, & .slick-cell": {
            backgroundColor: "var(--vscode-editor-background)",
            color: "var(--vscode-foreground)",
        },
        "& .slick-row.odd .slick-cell, & .slick-row.even .slick-cell": {
            backgroundColor: "var(--vscode-editor-background)",
        },
        "& .slick-row:hover .slick-cell": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "& .slick-row.active .slick-cell, & .slick-row.selected .slick-cell": {
            backgroundColor: "var(--vscode-list-activeSelectionBackground)",
            color: "var(--vscode-list-activeSelectionForeground)",
        },
        "& .slick-cell": {
            alignItems: "center",
            display: "flex",
            paddingBottom: "4px",
            paddingLeft: "8px",
            paddingRight: "8px",
            paddingTop: "4px",
        },
        "& .slick-cell.editable": {
            paddingBottom: "4px",
            paddingLeft: "8px",
            paddingRight: "8px",
            paddingTop: "4px",
        },
        "& .editor-text": {
            backgroundColor:
                "var(--vscode-settings-textInputBackground, var(--vscode-input-background))",
            border: "1px solid var(--vscode-settings-textInputBorder, var(--vscode-input-border, transparent))",
            borderRadius: "2px",
            boxSizing: "border-box",
            color: "var(--vscode-settings-textInputForeground, var(--vscode-input-foreground))",
            font: "inherit",
            height: "26px",
            minWidth: 0,
            padding: "2px 6px",
            width: "100%",
        },
        "& .editor-text:focus": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "-1px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
        "& .editor-checkbox:focus": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "2px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
    },
    quickQueryCell: {
        alignItems: "center",
        display: "flex",
        height: "100%",
        minWidth: 0,
        width: "100%",
    },
    quickQueryCenteredCell: {
        justifyContent: "center",
    },
    quickQueryTextDisplay: {
        boxSizing: "border-box",
        color: "var(--vscode-foreground)",
        display: "block",
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: "18px",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        userSelect: "none",
        whiteSpace: "nowrap",
        width: "100%",
    },
    quickQueryCheckboxInput: {
        cursor: "pointer",
        height: "16px",
        margin: 0,
        width: "16px",
    },
    quickQueryShortcutCell: {
        alignItems: "center",
        cursor: "pointer",
        display: "flex",
        minWidth: 0,
        width: "100%",
        ":focus": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "-2px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
    },
    quickQueryShortcutDisplay: {
        alignItems: "center",
        color: "var(--vscode-descriptionForeground)",
        display: "flex",
        gap: "6px",
        fontFamily: "var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace)",
        fontSize: "11.5px",
        justifyContent: "space-between",
        minWidth: 0,
        overflow: "hidden",
        userSelect: "none",
        whiteSpace: "nowrap",
        width: "100%",
    },
    quickQueryShortcutIcon: {
        color: "inherit",
        display: "inline-flex",
        flex: "0 0 auto",
        height: "16px",
        width: "16px",
    },
    quickQueryShortcutText: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    quickQueryEmpty: {
        color: "var(--vscode-disabledForeground)",
    },
    quickQueryQueryCell: {
        alignItems: "center",
        cursor: "pointer",
        display: "flex",
        gap: "10px",
        minWidth: 0,
        width: "100%",
        ":focus": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "-2px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
    },
    quickQueryPreview: {
        color: "var(--vscode-descriptionForeground)",
        fontFamily: "var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace)",
        fontSize: "11.5px",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    quickQueryNoQuery: {
        color: "var(--vscode-disabledForeground)",
        fontSize: "11.5px",
        fontStyle: "italic",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    shortcutGroups: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    shortcutGroup: {
        borderRadius: "8px",
    },
    searchInput: {
        maxWidth: "360px",
        width: "100%",
    },
    groupHeader: {
        alignItems: "center",
        backgroundColor:
            "var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background))",
        border: "none",
        color: "inherit",
        display: "grid",
        fontFamily: "inherit",
        gap: "10px",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        padding: "11px 16px",
        textAlign: "left",
        width: "100%",
        ":focus-visible": {
            outline: "1px solid var(--vscode-focusBorder)",
            outlineOffset: "-2px",
        },
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "& > span:last-child": {
            minWidth: 0,
            width: "100%",
        },
    },
    groupTitle: {
        display: "flex",
        flex: 1,
        flexDirection: "column",
        minWidth: 0,
    },
    groupTitleLabel: {
        color: "var(--vscode-foreground)",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    groupTitleDescription: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
    },
    webviewShortcuts: {
        padding: "0 16px",
    },
});

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
    const classes = useStyles();
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
    const [editingQueryIndex, setEditingQueryIndex] = useState<number | undefined>(undefined);
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
    const quickQueryGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const quickQueryRowsRef = useRef<QuickQueryGridRow[]>([]);
    const hasLocalChangesRef = useRef(false);
    const handledFocusNonceRef = useRef<number | undefined>(undefined);

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
        if (stateFocusNonce !== undefined && handledFocusNonceRef.current === stateFocusNonce) {
            return;
        }

        if (
            focusedQuickQuerySlot &&
            focusedQuickQuerySlot >= 1 &&
            focusedQuickQuerySlot <= quickQueryCount
        ) {
            handledFocusNonceRef.current = stateFocusNonce;
            setActiveTab("queries");
            setEditingQueryIndex(focusedQuickQuerySlot - 1);
        }
    }, [stateFocusedQuickQuerySlot, stateFocusNonce]);

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
    }, [context, debouncedDispatchSave]);

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

    const updateQuickQuery = useCallback(
        (index: number, value: QuickQuerySlot) => {
            const nextQuickQueries = quickQueries.map((slot, slotIndex) =>
                slotIndex === index ? value : slot,
            );
            setQuickQueries(nextQuickQueries);
            localChangeVersionRef.current += 1;
            hasLocalChangesRef.current = true;
            saveWith(nextQuickQueries, quickQueryKeybindings, webviewShortcuts, {
                quickQueries: true,
            });
        },
        [quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    const updateQuickQueryShortcut = useCallback(
        (commandId: string, value: string) => {
            const nextKeybindings = {
                ...quickQueryKeybindings,
                [commandId]: value,
            };
            setQuickQueryKeybindings(nextKeybindings);
            localChangeVersionRef.current += 1;
            hasLocalChangesRef.current = true;
            saveWith(quickQueries, nextKeybindings, webviewShortcuts, {
                quickQueryKeybindings: true,
            });
        },
        [quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    const updateWebviewShortcut = useCallback(
        (action: WebviewAction, value: string) => {
            const nextShortcuts = {
                ...webviewShortcuts,
                [action]: value,
            };
            setWebviewShortcuts(nextShortcuts);
            localChangeVersionRef.current += 1;
            hasLocalChangesRef.current = true;
            saveWith(quickQueries, quickQueryKeybindings, nextShortcuts, {
                webviewShortcuts: true,
            });
        },
        [quickQueries, quickQueryKeybindings, saveWith, webviewShortcuts],
    );

    const quickQueryRows = useMemo<QuickQueryGridRow[]>(
        () =>
            quickQueries.map((slot, index) => {
                const commandId = getQuickQueryCommandId(index + 1);
                return {
                    id: index + 1,
                    index,
                    commandId,
                    slot,
                    name: getQuickQuerySlotName(index + 1),
                    query: slot.query,
                    shortcut: quickQueryKeybindings[commandId] ?? "",
                    autoExecute: slot.executionMode === QuickQueryExecutionMode.OpenAndRun,
                };
            }),
        [quickQueries, quickQueryKeybindings],
    );
    const syncQuickQueryGridRows = useCallback((rows: QuickQueryGridRow[]) => {
        const reactGrid = quickQueryGridRef.current;
        if (!reactGrid?.dataView || !reactGrid.slickGrid) {
            return;
        }

        reactGrid.dataView.setItems(rows);
        reactGrid.slickGrid.invalidateAllRows();
        reactGrid.slickGrid.render();
    }, []);

    useEffect(() => {
        quickQueryRowsRef.current = quickQueryRows;
        syncQuickQueryGridRows(quickQueryRows);
    }, [quickQueryRows, syncQuickQueryGridRows]);

    const handleQuickQueryGridCreated = useCallback(
        (event: CustomEvent<SlickgridReactInstance>) => {
            quickQueryGridRef.current = event.detail;
            syncQuickQueryGridRows(quickQueryRowsRef.current);
        },
        [syncQuickQueryGridRows],
    );

    const quickQueryGridOptions = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            autoCommitEdit: true,
            autoResize: createFluentAutoResizeOptions(`#${quickQueryGridContainerId}`),
            autoEdit: true,
            autoEditByKeypress: true,
            editable: true,
            enableCellNavigation: true,
            enableColumnReorder: false,
            enableExcelCopyBuffer: false,
            enableTextSelectionOnCells: false,
            forceFitColumns: true,
            rowHeight: 40,
        }),
        [],
    );

    const quickQueryColumns = useMemo<Column<QuickQueryGridRow>[]>(() => {
        const ShortcutDialogEditor = createDialogEditor((row) =>
            setRecording({
                kind: "quickQuery",
                commandId: row.commandId,
            }),
        );
        const QueryDialogEditor = createDialogEditor((row) => setEditingQueryIndex(row.index));

        const createCell = (className?: string) => {
            const cell = document.createElement("div");
            cell.className = mergeClasses(classes.quickQueryCell, className);
            return cell;
        };

        return [
            {
                id: "name",
                name: loc.name,
                field: "name",
                minWidth: 140,
                width: 170,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell();
                    const display = document.createElement("span");
                    display.className = classes.quickQueryTextDisplay;
                    display.textContent = row.name;
                    display.title = row.name;
                    cell.append(display);
                    return cell;
                },
            },
            {
                id: "autoExecute",
                name: loc.autoExecute,
                field: "autoExecute",
                cssClass: classes.quickQueryCenteredCell,
                maxWidth: 115,
                minWidth: 105,
                width: 110,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryCenteredCell);
                    const setAutoExecute = (autoExecute: boolean) => {
                        const executionMode = autoExecute
                            ? QuickQueryExecutionMode.OpenAndRun
                            : QuickQueryExecutionMode.Open;
                        if (executionMode !== row.slot.executionMode) {
                            updateQuickQuery(row.index, {
                                ...row.slot,
                                executionMode,
                            });
                        }
                    };
                    cell.addEventListener("mousedown", (event) => event.stopPropagation());
                    cell.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setAutoExecute(!row.autoExecute);
                    });
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = row.autoExecute;
                    checkbox.className = classes.quickQueryCheckboxInput;
                    checkbox.setAttribute("aria-label", `${loc.autoExecute}: ${row.name}`);
                    checkbox.tabIndex = -1;
                    checkbox.addEventListener("mousedown", (event) => event.stopPropagation());
                    checkbox.addEventListener("click", (event) => {
                        event.stopPropagation();
                        setAutoExecute((event.currentTarget as HTMLInputElement).checked);
                    });
                    cell.append(checkbox);
                    return cell;
                },
            },
            {
                id: "shortcut",
                name: loc.shortcut,
                field: "shortcut",
                editor: {
                    model: ShortcutDialogEditor,
                    ariaLabel: loc.recordShortcut,
                },
                minWidth: 205,
                width: 230,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryShortcutCell);
                    const displayValue = formatShortcut(row.shortcut) || loc.noShortcut;
                    const display = document.createElement("span");
                    display.className = mergeClasses(
                        classes.quickQueryShortcutDisplay,
                        !row.shortcut && classes.quickQueryEmpty,
                    );
                    display.title = displayValue;
                    const icon = document.createElement("span");
                    icon.className = classes.quickQueryShortcutIcon;
                    icon.innerHTML = shortcutKeyboardIconMarkup;
                    const text = document.createElement("span");
                    text.className = classes.quickQueryShortcutText;
                    text.textContent = displayValue;
                    display.append(text, icon);
                    cell.append(display);
                    return cell;
                },
            },
            {
                id: "query",
                name: loc.query,
                field: "query",
                editor: {
                    model: QueryDialogEditor,
                    ariaLabel: loc.query,
                },
                minWidth: 260,
                width: 420,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryQueryCell);
                    const query = row.query.trim().replace(/\s+/g, " ");
                    const preview = query.length > 90 ? `${query.slice(0, 90)}...` : query;
                    const previewElement = document.createElement("span");
                    previewElement.className = preview
                        ? classes.quickQueryPreview
                        : classes.quickQueryNoQuery;
                    previewElement.textContent = preview || loc.noQuerySet;
                    previewElement.title = preview || loc.noQuerySet;
                    cell.append(previewElement);
                    return cell;
                },
            },
        ];
    }, [classes, loc, updateQuickQuery]);

    if (!context) {
        return undefined;
    }

    const renderQueries = () => {
        const editingQuery =
            editingQueryIndex !== undefined ? quickQueries[editingQueryIndex] : undefined;

        return (
            <>
                <div className={classes.helpText}>{loc.quickQueriesDescription}</div>
                <div className={mergeClasses(classes.card, classes.quickQueryGridCard)}>
                    <div className={classes.quickQueryGridScroller}>
                        <div
                            id={quickQueryGridContainerId}
                            className={classes.quickQueryGridContainer}>
                            <FluentSlickGrid
                                gridId={quickQueryGridId}
                                columns={quickQueryColumns}
                                options={quickQueryGridOptions}
                                dataset={quickQueryRows}
                                onReactGridCreated={handleQuickQueryGridCreated}
                            />
                        </div>
                    </div>
                </div>
                {editingQuery && editingQueryIndex !== undefined && (
                    <QuickQueryEditorDialog
                        slot={editingQuery}
                        open
                        onClose={() => setEditingQueryIndex(undefined)}
                        onSave={(query) => {
                            updateQuickQuery(editingQueryIndex, {
                                ...editingQuery,
                                query,
                            });
                            setEditingQueryIndex(undefined);
                        }}
                        readClipboardText={context.readClipboardText}
                        writeClipboardText={context.writeClipboardText}
                        themeKind={themeKind}
                        loc={loc}
                    />
                )}
            </>
        );
    };

    const renderShortcuts = () => (
        <>
            <div className={classes.helpText}>{loc.webviewShortcutsDescription}</div>
            <Input
                className={classes.searchInput}
                contentBefore={<Search16Regular />}
                value={shortcutSearch}
                placeholder={loc.searchWebviewShortcuts}
                aria-label={loc.searchWebviewShortcuts}
                onChange={(_event, data) => setShortcutSearch(data.value)}
            />
            <div className={classes.shortcutGroups}>
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
                        return undefined;
                    }

                    return (
                        <CollapsibleSection
                            key={group.id}
                            className={mergeClasses(classes.card, classes.shortcutGroup)}
                            buttonClassName={classes.groupHeader}
                            panelClassName={classes.webviewShortcuts}
                            open={searchTerm ? true : !collapsedGroups[group.id]}
                            onOpenChange={(open) =>
                                setCollapsedGroups((current) => ({
                                    ...current,
                                    [group.id]: !open,
                                }))
                            }
                            title={
                                <span className={classes.groupTitle}>
                                    <span className={classes.groupTitleLabel}>
                                        <HighlightedText
                                            text={groupLabel}
                                            searchTerm={searchTerm}
                                        />
                                    </span>
                                    <span className={classes.groupTitleDescription}>
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

    const findShortcutConflict = (value: string): string | undefined => {
        const normalized = value.trim().toLowerCase();
        if (!normalized || !recording) {
            return undefined;
        }

        for (let index = 0; index < quickQueries.length; index++) {
            const commandId = getQuickQueryCommandId(index + 1);
            if (recording.kind === "quickQuery" && recording.commandId === commandId) {
                continue;
            }
            if ((quickQueryKeybindings[commandId] ?? "").trim().toLowerCase() === normalized) {
                return quickQueries[index].name || loc.quickQueries;
            }
        }

        for (const group of shortcutGroups) {
            for (const item of group.items) {
                if (recording.kind === "webview" && recording.action === item.action) {
                    continue;
                }
                if ((webviewShortcuts[item.action] ?? "").trim().toLowerCase() === normalized) {
                    return loc.webviewShortcutLabels[item.action];
                }
            }
        }

        return undefined;
    };

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
            <div className={classes.page} aria-label={loc.pageAriaLabel}>
                <TabList
                    className={classes.tabs}
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
                    findConflict={findShortcutConflict}
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
