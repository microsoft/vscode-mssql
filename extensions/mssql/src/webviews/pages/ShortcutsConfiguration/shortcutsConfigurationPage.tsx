/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Input,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarBody,
    Tab,
    TabList,
    tokens,
} from "@fluentui/react-components";
import { Keyboard24Regular, Search16Regular } from "@fluentui/react-icons";
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
    ConfigurableKeyCommand,
    configurableKeyCommands,
    getQuickQueryCommandId,
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
    ConfigurableKeyCommandRow,
    WebviewShortcutRow,
} from "./shortcutComponents";
import { formatShortcut, HighlightedText, textMatchesSearch } from "./shortcutKeyboardUtils";
import { QuickQueryGridRow, useQuickQueryColumns } from "./quickQueryGridColumns";
import { useShortcutsConfigurationSave } from "./useShortcutsConfigurationSave";

type ConfigurationTab = "queries" | "shortcuts";
const quickQueryGridContainerId = "shortcutsQuickQueriesGridContainer";
const quickQueryGridId = "shortcutsQuickQueriesGrid";

const configurableKeyCommandCategoryOrder: ConfigurableKeyCommand["category"][] = [
    "queryExecution",
    "connection",
    "others",
];

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
    infoBanner: {
        marginBottom: "14px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        minWidth: 0,
    },
    sectionTitle: {
        color: "var(--vscode-foreground)",
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase400,
        margin: 0,
    },
    sectionFooter: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        margin: 0,
    },
    card: {
        backgroundColor: "var(--vscode-editor-background)",
        border: "1px solid var(--vscode-input-border, var(--vscode-editorGroup-border))",
        borderRadius: "8px",
        overflow: "hidden",
    },
    quickQueryGridCard: {
        borderRadius: 0,
        width: "100%",
    },
    quickQueryGridScroller: {
        overflowX: "auto",
        overflowY: "hidden",
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
    quickQueryShortcutCell: {
        alignItems: "center",
        cursor: "default",
        display: "flex",
        justifyContent: "flex-end",
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
    quickQueryShortcutHeader: {
        alignItems: "center",
        display: "flex",
        gap: "8px",
        justifyContent: "space-between",
        minWidth: 0,
        width: "100%",
    },
    quickQueryShortcutHeaderText: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    quickQueryShortcutHeaderButton: {
        backgroundColor: "transparent",
        border: "none",
        borderRadius: "2px",
        color: "var(--vscode-textLink-foreground)",
        cursor: "pointer",
        flex: "0 0 auto",
        font: "inherit",
        fontSize: "11px",
        lineHeight: "16px",
        margin: 0,
        maxWidth: "72px",
        minWidth: 0,
        overflow: "hidden",
        padding: "0 2px",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        ":hover": {
            color: "var(--vscode-textLink-activeForeground)",
            textDecorationLine: "underline",
        },
        ":focus": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "1px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
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
    vscodeManagedShortcutAction: {
        alignItems: "center",
        backgroundColor: "transparent",
        border: "none",
        borderRadius: "3px",
        color: "var(--vscode-descriptionForeground)",
        cursor: "pointer",
        display: "inline-flex",
        flex: "0 0 190px",
        font: "inherit",
        fontSize: tokens.fontSizeBase200,
        gap: "6px",
        justifyContent: "flex-end",
        margin: 0,
        minWidth: "190px",
        overflow: "hidden",
        padding: "0",
        whiteSpace: "nowrap",
        ":hover": {
            color: "var(--vscode-foreground)",
        },
        ":focus-visible": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "2px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
        ":hover .vscodeManagedShortcutActionText": {
            opacity: 1,
        },
        ":hover .vscodeManagedShortcutActionOpenIcon": {
            opacity: 1,
        },
        ":focus-visible .vscodeManagedShortcutActionText": {
            opacity: 1,
        },
        ":focus-visible .vscodeManagedShortcutActionOpenIcon": {
            opacity: 1,
        },
    },
    vscodeManagedShortcutActionText: {
        display: "inline-flex",
        flex: "1 1 auto",
        justifyContent: "flex-end",
        minWidth: 0,
        opacity: 0,
        overflow: "hidden",
        textAlign: "right",
        textOverflow: "ellipsis",
    },
    vscodeManagedShortcutActionIcon: {
        display: "inline-flex",
        flex: "0 0 auto",
        height: "16px",
        width: "16px",
    },
    vscodeManagedShortcutActionOpenIcon: {
        display: "inline-flex",
        flex: "0 0 auto",
        height: "14px",
        opacity: 0,
        width: "14px",
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
        gap: "12px",
    },
    shortcutGroup: {
        borderRadius: "8px",
    },
    searchInput: {
        maxWidth: "360px",
        width: "100%",
    },
    shortcutsEmptyState: {
        alignItems: "center",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "8px",
        color: "var(--vscode-descriptionForeground)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        justifyContent: "center",
        minHeight: "180px",
        padding: "28px",
        textAlign: "center",
    },
    shortcutsEmptyStateIcon: {
        color: "var(--vscode-descriptionForeground)",
        height: "32px",
        width: "32px",
    },
    shortcutsEmptyStateTitle: {
        color: "var(--vscode-foreground)",
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase400,
    },
    shortcutsEmptyStateDescription: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
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
    const { keyBindings, themeKind } = useVscodeWebview();
    const stateFocusedQuickQuerySlot = useShortcutsConfigurationSelector(
        (s) => s.focusedQuickQuerySlot,
    );
    const stateFocusNonce = useShortcutsConfigurationSelector((s) => s.focusNonce);
    const stateErrorMessage = useShortcutsConfigurationSelector((s) => s.errorMessage);
    const [activeTab, setActiveTab] = useState<ConfigurationTab>("queries");
    const [editingQueryIndex, setEditingQueryIndex] = useState<number | undefined>(undefined);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [shortcutSearch, setShortcutSearch] = useState("");
    const [recording, setRecording] = useState<{ kind: "webview"; action: WebviewAction }>();
    const quickQueryGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const quickQueryRowsRef = useRef<QuickQueryGridRow[]>([]);
    const handledFocusNonceRef = useRef<number | undefined>(undefined);

    const {
        quickQueries,
        webviewShortcuts,
        saveState,
        errorMessage: saveErrorMessage,
        updateQuickQuery,
        clearQuickQueryValues,
        updateWebviewShortcut,
        saveAndClose,
    } = useShortcutsConfigurationSave({
        context,
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
                    name: slot.name,
                    query: slot.query,
                };
            }),
        [quickQueries],
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
            alwaysShowVerticalScroll: false,
            autoCommitEdit: true,
            autoHeight: true,
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
        onRecordShortcut: (commandId) => {
            void context?.openQuickQueryKeybinding(commandId);
        },
        onShowAllShortcuts: () => {
            void context?.openQuickQueryKeybindings();
        },
        onEditQuery: (index) => setEditingQueryIndex(index),
        clearQuickQueryValues,
    });

    if (!context) {
        return null;
    }

    const renderInfoBanner = (message: string, actionLabel?: string, onAction?: () => void) => (
        <MessageBar intent="info" className={classes.infoBanner}>
            <MessageBarBody>
                {message}
                {actionLabel && onAction && (
                    <>
                        {" "}
                        <Link onClick={onAction}>{actionLabel}</Link>
                    </>
                )}
            </MessageBarBody>
        </MessageBar>
    );

    const renderQueries = () => {
        const editingQuery =
            editingQueryIndex !== undefined ? quickQueries[editingQueryIndex] : undefined;

        return (
            <>
                <div className={classes.helpText}>{loc.quickQueriesDescription}</div>
                {renderInfoBanner(
                    loc.quickQueriesKeyboardShortcutsBanner,
                    loc.openKeyboardShortcutsEditor,
                    () => {
                        void context.openQuickQueryKeybindings();
                    },
                )}
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

    const getVisibleQueryEditorShortcutGroups = (searchTerm: string) =>
        configurableKeyCommandCategoryOrder
            .map((category) => ({
                category,
                label: loc.configurableKeyCommandCategoryLabels[category],
                description: loc.configurableKeyCommandCategoryDescriptions[category],
                items: configurableKeyCommands.filter((item) => item.category === category),
            }))
            .filter((group) => group.items.length > 0)
            .map((group) => {
                const groupMatches =
                    !!searchTerm &&
                    (textMatchesSearch(group.label, searchTerm) ||
                        textMatchesSearch(group.description, searchTerm));
                const visibleItems = group.items.filter((item) => {
                    if (!searchTerm || groupMatches) {
                        return true;
                    }

                    return (
                        textMatchesSearch(
                            loc.configurableKeyCommandLabels[item.command],
                            searchTerm,
                        ) ||
                        textMatchesSearch(item.command, searchTerm) ||
                        textMatchesSearch(
                            loc.configurableKeyCommandDescriptions[item.command],
                            searchTerm,
                        )
                    );
                });

                return {
                    ...group,
                    visibleItems,
                };
            })
            .filter((group) => !searchTerm || group.visibleItems.length > 0);

    const getVisibleResultViewShortcutGroups = (searchTerm: string) =>
        shortcutGroups
            .map((group) => {
                const label = getShortcutGroupLabel(group.id, loc);
                const description = getShortcutGroupDescription(group.id, loc);
                const groupMatches =
                    !!searchTerm &&
                    (textMatchesSearch(label, searchTerm) ||
                        textMatchesSearch(description, searchTerm));
                const visibleItems = group.items.filter((item) => {
                    if (!searchTerm || groupMatches) {
                        return true;
                    }

                    const rawShortcut = webviewShortcuts[item.action] ?? "";
                    const formattedShortcut = formatShortcut(rawShortcut);
                    const currentShortcutLabel = keyBindings[item.action]?.label ?? "";

                    return (
                        textMatchesSearch(loc.webviewShortcutLabels[item.action], searchTerm) ||
                        textMatchesSearch(
                            loc.webviewShortcutDescriptions[item.action],
                            searchTerm,
                        ) ||
                        textMatchesSearch(rawShortcut, searchTerm) ||
                        textMatchesSearch(formattedShortcut, searchTerm) ||
                        textMatchesSearch(currentShortcutLabel, searchTerm)
                    );
                });

                return {
                    ...group,
                    label,
                    description,
                    visibleItems,
                };
            })
            .filter((group) => !searchTerm || group.visibleItems.length > 0);

    const renderShortcutEmptyState = () => (
        <div className={classes.shortcutsEmptyState} role="status">
            <Keyboard24Regular aria-hidden className={classes.shortcutsEmptyStateIcon} />
            <div className={classes.shortcutsEmptyStateTitle}>{loc.noShortcutResultsTitle}</div>
            <div className={classes.shortcutsEmptyStateDescription}>
                {loc.noShortcutResultsDescription}
            </div>
        </div>
    );

    const renderQueryEditorShortcuts = (
        groups: ReturnType<typeof getVisibleQueryEditorShortcutGroups>,
        searchTerm: string,
    ) => {
        return (
            <div className={classes.shortcutGroups}>
                {groups.map((group) => {
                    return (
                        <CollapsibleSection
                            key={group.category}
                            className={mergeClasses(classes.card, classes.shortcutGroup)}
                            buttonClassName={classes.groupHeader}
                            panelClassName={classes.webviewShortcuts}
                            open={
                                searchTerm
                                    ? true
                                    : !collapsedGroups[`queryEditor:${group.category}`]
                            }
                            onOpenChange={(open) =>
                                setCollapsedGroups((current) => ({
                                    ...current,
                                    [`queryEditor:${group.category}`]: !open,
                                }))
                            }
                            title={
                                <span className={classes.groupTitle}>
                                    <span className={classes.groupTitleLabel}>
                                        <HighlightedText
                                            text={group.label}
                                            searchTerm={searchTerm}
                                        />
                                    </span>
                                    <span className={classes.groupTitleDescription}>
                                        <HighlightedText
                                            text={group.description}
                                            searchTerm={searchTerm}
                                        />
                                    </span>
                                </span>
                            }>
                            {group.visibleItems.map((item) => (
                                <ConfigurableKeyCommandRow
                                    key={item.command}
                                    item={item}
                                    onOpen={() => {
                                        void context.openKeymapCommandKeybinding(item.command);
                                    }}
                                    loc={loc}
                                    searchTerm={searchTerm}
                                />
                            ))}
                        </CollapsibleSection>
                    );
                })}
            </div>
        );
    };

    const renderResultViewShortcuts = (
        groups: ReturnType<typeof getVisibleResultViewShortcutGroups>,
        searchTerm: string,
    ) => (
        <div className={classes.shortcutGroups}>
            {groups.map((group) => {
                return (
                    <CollapsibleSection
                        key={group.id}
                        className={mergeClasses(classes.card, classes.shortcutGroup)}
                        buttonClassName={classes.groupHeader}
                        panelClassName={classes.webviewShortcuts}
                        open={searchTerm ? true : !collapsedGroups[`resultView:${group.id}`]}
                        onOpenChange={(open) =>
                            setCollapsedGroups((current) => ({
                                ...current,
                                [`resultView:${group.id}`]: !open,
                            }))
                        }
                        title={
                            <span className={classes.groupTitle}>
                                <span className={classes.groupTitleLabel}>
                                    <HighlightedText text={group.label} searchTerm={searchTerm} />
                                </span>
                                <span className={classes.groupTitleDescription}>
                                    <HighlightedText
                                        text={group.description}
                                        searchTerm={searchTerm}
                                    />
                                </span>
                            </span>
                        }>
                        {group.visibleItems.map((item) => (
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
    );

    const renderShortcuts = () => {
        const searchTerm = shortcutSearch.trim();
        const visibleQueryEditorGroups = getVisibleQueryEditorShortcutGroups(searchTerm);
        const visibleResultViewGroups = getVisibleResultViewShortcutGroups(searchTerm);
        const hasSearchResults =
            visibleQueryEditorGroups.length > 0 || visibleResultViewGroups.length > 0;

        return (
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
                {searchTerm && !hasSearchResults ? (
                    renderShortcutEmptyState()
                ) : (
                    <>
                        {visibleQueryEditorGroups.length > 0 && (
                            <section className={classes.section}>
                                <h2 className={classes.sectionTitle}>{loc.queryEditorShortcuts}</h2>
                                {renderInfoBanner(
                                    loc.queryEditorKeyboardShortcutsBanner,
                                    loc.openKeyboardShortcutsEditor,
                                    () => {
                                        void context.openKeymapCommandKeybindings();
                                    },
                                )}
                                {renderQueryEditorShortcuts(visibleQueryEditorGroups, searchTerm)}
                                <p className={classes.sectionFooter}>
                                    {loc.queryEditorKeyboardShortcutsFooter}{" "}
                                    <Link
                                        onClick={() => {
                                            void context.openKeymapCommandKeybindings();
                                        }}>
                                        {loc.openKeyboardShortcutsEditor}
                                    </Link>
                                </p>
                            </section>
                        )}
                        {visibleResultViewGroups.length > 0 && (
                            <section className={classes.section}>
                                <h2 className={classes.sectionTitle}>{loc.resultViewShortcuts}</h2>
                                {renderInfoBanner(loc.resultViewShortcutsBanner)}
                                {renderResultViewShortcuts(visibleResultViewGroups, searchTerm)}
                            </section>
                        )}
                    </>
                )}
            </>
        );
    };

    const findShortcutConflict = (value: string): string | undefined => {
        const normalized = value.trim().toLowerCase();
        if (!normalized || !recording) {
            return undefined;
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
            icon={<Keyboard24Regular aria-label={loc.title} />}
            title={loc.title}
            subtitle={loc.subtitle}
            errorMessage={saveErrorMessage ?? stateErrorMessage}
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
                        updateWebviewShortcut(recording.action, value);
                    }}
                />
            )}
        </DialogPageShell>
    );
};
