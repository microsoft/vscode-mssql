/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Input,
    makeStyles,
    mergeClasses,
    Tab,
    TabList,
    tokens,
} from "@fluentui/react-components";
import { Search16Regular, Settings24Regular } from "@fluentui/react-icons";
import { type GridOption, type SlickgridReactInstance } from "slickgrid-react";
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
    QuickQueryExecutionMode,
    quickQueryCount,
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
    ShortcutRecorder,
    WebviewShortcutRow,
} from "./shortcutComponents";
import { HighlightedText, textMatchesSearch } from "./shortcutKeyboardUtils";
import { QuickQueryGridRow, useQuickQueryColumns } from "./quickQueryGridColumns";
import { useShortcutsConfigurationSave } from "./useShortcutsConfigurationSave";

type ConfigurationTab = "queries" | "shortcuts";
const quickQueryGridContainerId = "shortcutsQuickQueriesGridContainer";
const quickQueryGridId = "shortcutsQuickQueriesGrid";

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
    quickQueryClearButton: {
        alignItems: "center",
        backgroundColor: "transparent",
        border: "none",
        borderRadius: "2px",
        color: "var(--vscode-icon-foreground)",
        cursor: "pointer",
        display: "inline-flex",
        height: "24px",
        justifyContent: "center",
        padding: 0,
        width: "24px",
        ":hover": {
            backgroundColor: "var(--vscode-toolbar-hoverBackground)",
        },
        ":focus": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "2px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
        ":disabled": {
            backgroundColor: "transparent",
            color: "var(--vscode-disabledForeground)",
            cursor: "default",
        },
        "& svg": {
            height: "20px",
            width: "20px",
        },
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
    const [editingQueryIndex, setEditingQueryIndex] = useState<number | undefined>(undefined);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [shortcutSearch, setShortcutSearch] = useState("");
    const [recording, setRecording] = useState<
        { kind: "quickQuery"; commandId: string } | { kind: "webview"; action: WebviewAction }
    >();
    const quickQueryGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const quickQueryRowsRef = useRef<QuickQueryGridRow[]>([]);
    const handledFocusNonceRef = useRef<number | undefined>(undefined);

    const {
        quickQueries,
        quickQueryKeybindings,
        webviewShortcuts,
        saveState,
        updateQuickQuery,
        updateQuickQueryShortcut,
        clearQuickQueryValues,
        updateWebviewShortcut,
        saveAndClose,
    } = useShortcutsConfigurationSave({
        context,
        stateQuickQueries,
        stateQuickQueryKeybindings,
        stateWebviewShortcuts,
        stateErrorMessage,
        stateIsSaving,
    });

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

    const quickQueryRows = useMemo<QuickQueryGridRow[]>(
        () =>
            quickQueries.map((slot, index) => {
                const commandId = getQuickQueryCommandId(index + 1);
                return {
                    id: index + 1,
                    index,
                    commandId,
                    slot,
                    name: slot.name,
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

    const quickQueryColumns = useQuickQueryColumns({
        classes,
        loc,
        onRecordShortcut: (commandId) => setRecording({ kind: "quickQuery", commandId }),
        onEditQuery: (index) => setEditingQueryIndex(index),
        updateQuickQuery,
        clearQuickQueryValues,
    });

    if (!context) {
        return null;
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
                        slotName={loc.quickQuerySlotName(editingQueryIndex + 1)}
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
                return loc.quickQuerySlotName(index + 1);
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
