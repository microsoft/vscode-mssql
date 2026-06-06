/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
    Badge,
    Button,
    Checkbox,
    Input,
    makeStyles,
    mergeClasses,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SelectTabData,
    SelectTabEvent,
    shorthands,
    Tab,
    TabList,
    Text,
    Tooltip,
} from "@fluentui/react-components";
import {
    Add16Regular,
    ChevronDown16Regular,
    ChevronRight16Regular,
    Copy16Regular,
    Dismiss16Regular,
    FilterDismiss16Regular,
    Filter16Regular,
    FolderOpen16Regular,
    Play16Regular,
    Save16Regular,
    Search16Regular,
    SlideEraser16Regular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Column, Formatter, GridOption, SlickgridReactInstance } from "slickgrid-react";
import "../../index.css";
import { CellRangeSelector } from "../QueryResult/table/plugins/cellRangeSelector";
import { CellSelectionModel } from "../QueryResult/table/plugins/cellSelectionModel.plugin";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    createFluentSlickGridCopyMenu,
    FLUENT_SLICK_GRID_COPY_COMMAND,
    FluentSlickGrid,
    getFluentSlickGridSelectionText,
} from "../../common/FluentSlickGrid/FluentSlickGrid";
import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";
import {
    RpcCaptureEvent,
    RpcCaptureExport,
    RpcCaptureFilter,
    RpcCaptureSession,
    RpcCaptureSummary,
    RpcInspectorClearRequest,
    RpcInspectorExportRequest,
    RpcInspectorImportRequest,
    RpcInspectorSaveExportRequest,
    RpcInspectorStartSessionRequest,
    RpcInspectorStopSessionRequest,
    RpcInspectorWebviewState,
} from "../../../sharedInterfaces/rpcInspector";
import { useVscodeSelector } from "../../common/useVscodeSelector";
import { useVscodeWebview, VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";

type RpcInspectorTabKind = "live" | "session" | "import";

interface RpcInspectorTab {
    id: string;
    title: string;
    kind: RpcInspectorTabKind;
    sessionId?: string;
    importedExport?: RpcCaptureExport;
    isRecording?: boolean;
    eventCount: number;
    droppedEventCount?: number;
}

interface RpcDisplayEvent extends RpcCaptureEvent {
    requestEvent?: RpcCaptureEvent;
    responseEvent?: RpcCaptureEvent;
}

interface RpcGridRow extends RpcDisplayEvent {
    id: string;
    expandLabel: string;
    displayTime: string;
    displayChannel: string;
    displayMethod: string;
    displayMessage: string;
    displayStatus: string;
    displayDuration: string;
    displaySource: string;
}

type DetailsTab = "all" | "params" | "result" | "raw";

interface MethodDomainGroup {
    domain: string;
    methods: string[];
}

type MethodTreeRow =
    | { type: "domain"; domain: string; methods: string[] }
    | { type: "method"; domain: string; method: string };

const LIVE_TAB_ID = "live";
const FILTER_ALL_VALUE = "__all__";
const EXPAND_COLUMN_ID = "expand";
const RPC_GRID_ROW_HEIGHT = 32;
const RPC_GRID_FOLLOW_BOTTOM_THRESHOLD_PX = 64;
const METHOD_TREE_ROW_HEIGHT = 26;
const METHOD_TREE_OVERSCAN = 8;

const useStyles = makeStyles({
    root: {
        height: "100%",
        minWidth: 0,
        display: "grid",
        gridTemplateRows: "auto auto auto minmax(0, 1fr) auto",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
    },
    header: {
        minHeight: "34px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        ...shorthands.padding("4px", "12px"),
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editor-background)",
    },
    title: {
        fontSize: "13px",
        fontWeight: 700,
        lineHeight: "18px",
    },
    tabStrip: {
        minWidth: 0,
        overflowX: "auto",
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    tabButton: {
        minWidth: 0,
        maxWidth: "230px",
        height: "34px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        paddingLeft: "12px",
        paddingRight: "8px",
        borderTop: "none",
        borderRight: "1px solid var(--vscode-editorWidget-border)",
        borderBottom: "2px solid transparent",
        borderLeft: "none",
        backgroundColor: "transparent",
        color: "var(--vscode-foreground)",
        cursor: "pointer",
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "12px",
    },
    activeTabButton: {
        backgroundColor: "var(--vscode-editor-background)",
        borderBottomColor: "var(--vscode-focusBorder)",
    },
    tabTitle: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    recordingDot: {
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        backgroundColor: "var(--vscode-testing-iconFailed)",
        flexShrink: 0,
    },
    tabClose: {
        minWidth: 0,
        width: "22px",
        height: "22px",
    },
    addTabButton: {
        height: "34px",
        minWidth: "36px",
        borderRadius: 0,
        borderRight: "1px solid var(--vscode-editorWidget-border)",
    },
    toolbar: {
        minHeight: "34px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        ...shorthands.padding("4px", "12px"),
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editor-background)",
        overflowX: "auto",
    },
    compactInput: {
        width: "180px",
        flexShrink: 0,
    },
    filterMenuPopover: {
        maxWidth: "calc(100vw - 16px)",
        boxSizing: "border-box",
        overflowX: "hidden",
        backgroundColor: "var(--vscode-menu-background, var(--vscode-editorWidget-background))",
        border: "1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border))",
        boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
        borderRadius: "2px",
        ...shorthands.padding(0),
    },
    filterMenuContent: {
        width: "min(300px, calc(100vw - 16px))",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        ...shorthands.padding("12px"),
        overflowX: "hidden",
        backgroundColor: "var(--vscode-menu-background, var(--vscode-editorWidget-background))",
    },
    methodMenuContent: {
        width: "min(420px, calc(100vw - 16px))",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        ...shorthands.padding("12px"),
        overflowX: "hidden",
        backgroundColor: "var(--vscode-menu-background, var(--vscode-editorWidget-background))",
    },
    filterMenuRow: {
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "60px minmax(0, 1fr)",
        gap: "8px",
        alignItems: "center",
        minHeight: "28px",
        minWidth: 0,
        overflow: "hidden",
    },
    filterLabel: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "11px",
        color: "var(--vscode-descriptionForeground)",
    },
    filterDropdownHost: {
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
        "& .fui-Button": {
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            overflow: "hidden",
            boxSizing: "border-box",
        },
        "& .fui-Button__content": {
            minWidth: 0,
            overflow: "hidden",
        },
        "& .fui-Button__content > span": {
            minWidth: 0,
            overflow: "hidden",
        },
        "& .fui-Text": {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    methodFilter: {
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
    methodFilterHeader: {
        position: "sticky",
        top: 0,
        zIndex: 2,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto",
        gap: "6px",
        alignItems: "center",
        ...shorthands.padding("0", "0", "8px", "0"),
        overflow: "hidden",
        backgroundColor: "var(--vscode-menu-background, var(--vscode-editorWidget-background))",
    },
    methodFilterSearch: {
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        "& input": {
            minWidth: 0,
        },
    },
    methodFilterAction: {
        maxWidth: "84px",
        minWidth: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
    },
    methodFilterSummary: {
        ...shorthands.padding("0", "0", "6px", "0"),
    },
    methodFilterList: {
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        maxHeight: "280px",
        overflowY: "auto",
        overflowX: "hidden",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "2px",
        backgroundColor: "var(--vscode-input-background)",
    },
    methodTreeContent: {
        position: "relative",
        width: "100%",
    },
    methodTreeRow: {
        position: "absolute",
        left: 0,
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        minWidth: 0,
        height: "26px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        overflow: "hidden",
        ...shorthands.padding("0", "6px"),
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "& .fui-Checkbox": {
            minWidth: 0,
        },
        "& .fui-Checkbox__indicator": {
            flexShrink: 0,
        },
        "& .fui-Checkbox__label": {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    methodTreeDomainRow: {
        fontWeight: 600,
        backgroundColor: "color-mix(in srgb, var(--vscode-list-hoverBackground) 45%, transparent)",
    },
    methodTreeMethodRow: {
        cursor: "pointer",
        "& .fui-Checkbox": {
            pointerEvents: "none",
            width: "100%",
            maxWidth: "100%",
        },
    },
    methodTreeToggle: {
        minWidth: 0,
        width: "20px",
        height: "20px",
        flexShrink: 0,
    },
    methodTreeCheckbox: {
        minWidth: 0,
        flex: "1 1 auto",
        overflow: "hidden",
    },
    methodTreeCount: {
        flexShrink: 0,
        color: "var(--vscode-descriptionForeground)",
        fontSize: "11px",
    },
    methodTreeIndent: {
        width: "22px",
        flexShrink: 0,
    },
    methodFilterOption: {
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        minWidth: 0,
        height: "24px",
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        ...shorthands.padding("0", "6px"),
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "& .fui-Checkbox__label": {
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        "& .fui-Checkbox": {
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            pointerEvents: "none",
        },
        "& .fui-Checkbox__indicator": {
            flexShrink: 0,
        },
    },
    eventsPanel: {
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
    },
    panelGroup: {
        height: "100%",
        minHeight: 0,
        minWidth: 0,
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
    gridContainer: {
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
    },
    gridWrapper: {
        flex: "1 1 auto",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "4px",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        "--slick-grid-header-background": "var(--vscode-editor-background)",
        "--slick-header-background-color": "var(--vscode-editor-background)",
        "--slick-header-text-color": "var(--vscode-descriptionForeground)",
        "--slick-header-font-size": "11px",
        "--slick-header-font-weight": "700",
        "--slick-cell-font-family": "var(--vscode-editor-font-family), monospace",
        "--slick-cell-font-size": "12px",
        "--slick-cell-text-color": "var(--vscode-foreground)",
        "--slick-canvas-bg-color": "var(--vscode-editor-background)",
        "--slick-cell-even-background-color": "var(--vscode-editor-background)",
        "--slick-cell-odd-background-color":
            "var(--vscode-list-alternatingBackground, color-mix(in srgb, var(--vscode-editor-foreground) 4%, var(--vscode-editor-background)))",
        "--slick-cell-border-bottom": "1px solid var(--vscode-editorWidget-border)",
        "--slick-cell-border-right": "1px solid var(--vscode-editorWidget-border)",
        "--slick-row-mouse-hover-color": "var(--vscode-list-hoverBackground)",
        "--slick-cell-selected-color": "var(--vscode-list-activeSelectionBackground)",
        "--slick-row-selected-color": "var(--vscode-list-activeSelectionBackground)",
        "& .slickgrid-react, & .slickgrid-container": {
            width: "100%",
            height: "100%",
            minWidth: 0,
            minHeight: 0,
            flex: "1 1 auto",
        },
        "& .slickgrid-react": {
            display: "flex",
            flexDirection: "column",
        },
        "& .slick-pane, & .slick-viewport": {
            backgroundColor: "var(--vscode-editor-background)",
        },
        "& .slick-header-columns": {
            backgroundColor: "var(--vscode-editor-background)",
        },
        "& .slick-header-column": {
            backgroundColor: "var(--vscode-editor-background) !important",
            borderRight: "1px solid var(--vscode-editorWidget-border) !important",
            borderBottom: "1px solid var(--vscode-editorWidget-border) !important",
            fontWeight: 700,
        },
        "& .slick-row": {
            cursor: "pointer",
            backgroundColor: "var(--slick-cell-even-background-color)",
            color: "var(--vscode-foreground)",
        },
        "& .slick-row.odd": {
            backgroundColor: "var(--slick-cell-odd-background-color)",
        },
        "& .slick-row .slick-cell, & .slick-row .slick-cell.even": {
            backgroundColor: "inherit",
            color: "inherit",
        },
        "& .slick-row.selected .slick-cell, & .slick-row.active .slick-cell": {
            backgroundColor: "var(--vscode-list-activeSelectionBackground)",
            color: "var(--vscode-list-activeSelectionForeground)",
        },
        "& .slick-cell": {
            borderRight: "1px solid var(--vscode-editorWidget-border)",
            borderBottom: "1px solid var(--vscode-editorWidget-border)",
            fontSize: "12px",
            lineHeight: "22px",
            paddingTop: "1px",
            paddingBottom: "1px",
        },
        "& .rpc-grid-cell": {
            display: "block",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--vscode-editor-font-family), monospace",
            fontSize: "12px",
        },
        "& .rpc-grid-request": {
            color: "var(--vscode-charts-purple)",
            fontWeight: 600,
        },
        "& .rpc-grid-notification": {
            color: "var(--vscode-charts-orange)",
            fontWeight: 600,
        },
        "& .rpc-grid-response, & .rpc-grid-muted": {
            color: "var(--vscode-descriptionForeground)",
            fontWeight: 600,
        },
        "& .rpc-grid-status-succeeded": {
            color: "var(--vscode-testing-iconPassed)",
            fontWeight: 600,
        },
        "& .rpc-grid-status-failed": {
            color: "var(--vscode-testing-iconFailed)",
            fontWeight: 600,
        },
        "& .rpc-grid-status-pending": {
            color: "var(--vscode-editorWarning-foreground)",
            fontWeight: 600,
        },
        "& .rpc-grid-expand-action": {
            color: "var(--vscode-textLink-foreground)",
            cursor: "pointer",
            fontFamily: "var(--vscode-font-family)",
            fontWeight: 600,
            textAlign: "center",
        },
        "& .slick-cell.rpc-grid-expand-cell": {
            textAlign: "center",
        },
    },
    methodCell: {
        minWidth: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        overflow: "hidden",
    },
    mono: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "12px",
    },
    muted: {
        color: "var(--vscode-descriptionForeground)",
    },
    emptyState: {
        height: "100%",
        minHeight: "220px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--vscode-descriptionForeground)",
    },
    detailsPane: {
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        borderTop: "1px solid var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-editor-background)",
    },
    detailsHeader: {
        minHeight: "34px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "8px",
        ...shorthands.padding("3px", "8px"),
        borderBottom: "1px solid var(--vscode-panel-border)",
    },
    detailsTitle: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    detailsActions: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexShrink: 0,
    },
    detailsContent: {
        minHeight: 0,
        overflow: "hidden",
    },
    detailsColumns: {
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        "@media (max-width: 920px)": {
            gridTemplateColumns: "1fr",
        },
    },
    detailsColumn: {
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        borderRight: "1px solid var(--vscode-editorWidget-border)",
    },
    detailsColumnHeader: {
        minHeight: "28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        ...shorthands.padding("0", "8px"),
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    detailsColumnBody: {
        minHeight: 0,
        overflow: "auto",
        ...shorthands.padding("10px"),
    },
    detailsPre: {
        margin: 0,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--vscode-editor-foreground)",
    },
    statusBar: {
        minHeight: "22px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        ...shorthands.padding("0", "12px"),
        color: "var(--vscode-statusBar-foreground)",
        backgroundColor: "var(--vscode-statusBar-background)",
        fontSize: "11px",
    },
});

function useRpcInspectorState<T>(selector: (state: RpcInspectorWebviewState) => T) {
    return useVscodeSelector<RpcInspectorWebviewState, void, T>(selector);
}

function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });
}

function formatDuration(durationMs: number | undefined): string {
    return durationMs === undefined ? "" : `${durationMs} ms`;
}

function methodDomain(method: string | undefined): string | undefined {
    if (!method) {
        return undefined;
    }

    const slashIndex = method.indexOf("/");
    if (slashIndex > 0) {
        return method.substring(0, slashIndex);
    }

    const dotIndex = method.indexOf(".");
    if (dotIndex > 0) {
        return method.substring(0, dotIndex);
    }

    return method;
}

function methodTreeDomain(method: string): string {
    const slashIndex = method.indexOf("/");
    if (slashIndex > 0) {
        return method.substring(0, slashIndex);
    }

    const dotIndex = method.indexOf(".");
    if (dotIndex > 0) {
        return method.substring(0, dotIndex);
    }

    return "No domain";
}

function formatJson(value: unknown): string {
    if (value === undefined) {
        return "";
    }

    try {
        return JSON.stringify(value, undefined, 2) ?? "";
    } catch {
        return "<unserializable>";
    }
}

function summarizeEvents(events: RpcCaptureEvent[]): RpcCaptureSummary {
    const summary: RpcCaptureSummary = {
        eventCount: events.length,
        requestCount: 0,
        responseCount: 0,
        notificationCount: 0,
        failedCount: 0,
        pendingCount: 0,
        channels: {},
        methods: {},
        droppedEventCount: 0,
    };

    for (const event of events) {
        if (event.kind === "request") {
            summary.requestCount++;
        } else if (event.kind === "response") {
            summary.responseCount++;
        } else if (event.kind === "notification") {
            summary.notificationCount++;
        }

        if (event.status === "failed") {
            summary.failedCount++;
        }

        if (event.status === "pending") {
            summary.pendingCount++;
        }

        summary.channels[event.channel] = (summary.channels[event.channel] ?? 0) + 1;
        if (event.method) {
            summary.methods[event.method] = (summary.methods[event.method] ?? 0) + 1;
        }
    }

    return summary;
}

function createCaptureExport(
    source: RpcCaptureExport["source"],
    events: RpcCaptureEvent[],
    filters?: RpcCaptureFilter,
    session?: RpcCaptureSession,
): RpcCaptureExport {
    return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        source,
        session,
        filters,
        summary: summarizeEvents(events),
        events,
    };
}

function matchesFilter(event: RpcCaptureEvent, filter: RpcCaptureFilter): boolean {
    const displayEvent = event as RpcDisplayEvent;

    if (filter.search) {
        const serialized = JSON.stringify(event).toLowerCase();
        if (!serialized.includes(filter.search.toLowerCase())) {
            return false;
        }
    }

    if (filter.method && event.method !== filter.method) {
        return false;
    }

    if (filter.methods && !filter.methods.includes(event.method ?? "")) {
        return false;
    }

    if (filter.domain && methodDomain(event.method) !== filter.domain) {
        return false;
    }

    if (filter.channels?.length && !filter.channels.includes(event.channel)) {
        return false;
    }

    if (
        filter.directions?.length &&
        !filter.directions.includes(event.direction) &&
        (!displayEvent.responseEvent ||
            !filter.directions.includes(displayEvent.responseEvent.direction))
    ) {
        return false;
    }

    if (
        filter.kinds?.length &&
        !filter.kinds.includes(event.kind) &&
        (!displayEvent.responseEvent || !filter.kinds.includes(displayEvent.responseEvent.kind))
    ) {
        return false;
    }

    if (filter.statuses?.length && !filter.statuses.includes(event.status)) {
        return false;
    }

    return true;
}

function countActiveFilters(filter: RpcCaptureFilter): number {
    return countMethodFilters(filter) + countOtherActiveFilters(filter);
}

function countMethodFilters(filter: RpcCaptureFilter): number {
    let count = 0;
    if (filter.method) count++;
    if (filter.methods !== undefined) count++;
    return count;
}

function countOtherActiveFilters(filter: RpcCaptureFilter): number {
    let count = 0;
    if (filter.domain) count++;
    if (filter.channels?.length) count++;
    if (filter.directions?.length) count++;
    if (filter.kinds?.length) count++;
    if (filter.statuses?.length) count++;
    return count;
}

function getSingleValue<T extends string>(values: T[] | undefined): T | undefined {
    return values?.[0];
}

function setSingleValue<T extends string>(value: T | undefined): T[] | undefined {
    return value ? [value] : undefined;
}

function collapseRequestResponseEvents(events: RpcCaptureEvent[]): RpcDisplayEvent[] {
    const eventsById = new Map(events.map((event) => [event.eventId, event]));
    const consumedEventIds = new Set<string>();
    const displayEvents: RpcDisplayEvent[] = [];

    for (const event of events) {
        if (consumedEventIds.has(event.eventId)) {
            continue;
        }

        if (event.kind === "response" && event.relatedEventId) {
            const request = eventsById.get(event.relatedEventId);
            if (request?.kind === "request") {
                continue;
            }
        }

        if (event.kind === "request" && event.relatedEventId) {
            const response = eventsById.get(event.relatedEventId);
            if (response?.kind === "response") {
                consumedEventIds.add(response.eventId);
                displayEvents.push({
                    ...event,
                    status: response.status,
                    durationMs: response.durationMs ?? event.durationMs,
                    result: response.result,
                    error: response.error,
                    requestEvent: event,
                    responseEvent: response,
                });
                continue;
            }
        }

        displayEvents.push(event);
    }

    return displayEvents;
}

function getVisibleExportEvents(displayEvents: RpcDisplayEvent[]): RpcCaptureEvent[] {
    const eventsById = new Map<string, RpcCaptureEvent>();
    for (const event of displayEvents) {
        eventsById.set(event.eventId, event.requestEvent ?? event);
        if (event.responseEvent) {
            eventsById.set(event.responseEvent.eventId, event.responseEvent);
        }
    }

    return [...eventsById.values()];
}

const RpcInspectorPage = () => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<RpcInspectorWebviewState, void>();
    const liveEvents = useRpcInspectorState((state) => state.events ?? []);
    const sessionEvents = useRpcInspectorState((state) => state.sessionEvents ?? {});
    const sessions = useRpcInspectorState((state) => state.sessions ?? []);
    const bufferCapacity = useRpcInspectorState((state) => state.bufferCapacity ?? 5000);

    const [activeTabId, setActiveTabId] = useState<string>(LIVE_TAB_ID);
    const [closedSessionTabIds, setClosedSessionTabIds] = useState<Set<string>>(() => new Set());
    const [importedTabs, setImportedTabs] = useState<RpcInspectorTab[]>([]);
    const [filtersByTabId, setFiltersByTabId] = useState<Record<string, RpcCaptureFilter>>({});
    const [selectedEventIdsByTabId, setSelectedEventIdsByTabId] = useState<
        Record<string, string | undefined>
    >({});
    const [detailsTab, setDetailsTab] = useState<DetailsTab>("all");

    const sessionTabs = useMemo<RpcInspectorTab[]>(
        () =>
            sessions
                .filter((session) => !closedSessionTabIds.has(session.sessionId))
                .map((session) => ({
                    id: session.sessionId,
                    title: session.name,
                    kind: "session",
                    sessionId: session.sessionId,
                    isRecording: session.isActive,
                    eventCount: session.eventCount,
                    droppedEventCount: session.droppedEventCount,
                })),
        [closedSessionTabIds, sessions],
    );

    const tabs = useMemo<RpcInspectorTab[]>(
        () => [
            {
                id: LIVE_TAB_ID,
                title: "Live",
                kind: "live",
                eventCount: liveEvents.length,
            },
            ...sessionTabs,
            ...importedTabs,
        ],
        [importedTabs, liveEvents.length, sessionTabs],
    );

    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
    const activeEvents = useMemo(() => {
        if (!activeTab || activeTab.kind === "live") {
            return liveEvents;
        }

        if (activeTab.kind === "session" && activeTab.sessionId) {
            return sessionEvents[activeTab.sessionId] ?? [];
        }

        return activeTab.importedExport?.events ?? [];
    }, [activeTab, liveEvents, sessionEvents]);

    const activeDisplayEvents = useMemo(
        () => collapseRequestResponseEvents(activeEvents),
        [activeEvents],
    );
    const activeFilter = filtersByTabId[activeTab.id] ?? {};
    const filteredEvents = useMemo(
        () => activeDisplayEvents.filter((event) => matchesFilter(event, activeFilter)),
        [activeDisplayEvents, activeFilter],
    );
    const activeSummary = useMemo(() => summarizeEvents(filteredEvents), [filteredEvents]);
    const selectedEventId = selectedEventIdsByTabId[activeTab.id];
    const selectedEvent = filteredEvents.find((event) => event.eventId === selectedEventId);
    const activeSession = activeTab.sessionId
        ? sessions.find((session) => session.sessionId === activeTab.sessionId)
        : undefined;

    useEffect(() => {
        if (!tabs.some((tab) => tab.id === activeTabId)) {
            setActiveTabId(LIVE_TAB_ID);
        }
    }, [activeTabId, tabs]);

    useEffect(() => {
        if (selectedEventId && !filteredEvents.some((event) => event.eventId === selectedEventId)) {
            setSelectedEventIdsByTabId((previous) => ({
                ...previous,
                [activeTab.id]: undefined,
            }));
        }
    }, [activeTab.id, filteredEvents, selectedEventId]);

    const methodOptions = useMemo(
        () =>
            [
                ...new Set(activeEvents.map((event) => event.method).filter(Boolean) as string[]),
            ].sort(),
        [activeEvents],
    );
    const domainOptions = useMemo(
        () =>
            [
                ...new Set(
                    activeEvents
                        .map((event) => methodDomain(event.method))
                        .filter(Boolean) as string[],
                ),
            ].sort(),
        [activeEvents],
    );

    const updateActiveFilter = (updates: Partial<RpcCaptureFilter>) => {
        setFiltersByTabId((previous) => ({
            ...previous,
            [activeTab.id]: {
                ...activeFilter,
                ...updates,
            },
        }));
    };

    const clearActiveFilters = () => {
        setFiltersByTabId((previous) => ({
            ...previous,
            [activeTab.id]: {},
        }));
    };

    const selectEvent = (event: RpcCaptureEvent) => {
        setSelectedEventIdsByTabId((previous) => ({
            ...previous,
            [activeTab.id]: previous[activeTab.id] === event.eventId ? undefined : event.eventId,
        }));
        setDetailsTab("all");
    };

    const startSession = async () => {
        const state = await extensionRpc.sendRequest(RpcInspectorStartSessionRequest.type, {});
        const session = state.sessions[state.sessions.length - 1];
        if (session) {
            setClosedSessionTabIds((previous) => {
                const next = new Set(previous);
                next.delete(session.sessionId);
                return next;
            });
            setActiveTabId(session.sessionId);
        }
    };

    const stopSession = async (sessionId: string) => {
        await extensionRpc.sendRequest(RpcInspectorStopSessionRequest.type, { sessionId });
    };

    const closeTab = async (tab: RpcInspectorTab) => {
        if (tab.kind === "session" && tab.sessionId) {
            const session = sessions.find((item) => item.sessionId === tab.sessionId);
            if (session?.isActive) {
                await stopSession(tab.sessionId);
            }
            setClosedSessionTabIds((previous) => new Set(previous).add(tab.sessionId!));
        } else if (tab.kind === "import") {
            setImportedTabs((previous) => previous.filter((item) => item.id !== tab.id));
        }

        if (activeTabId === tab.id) {
            setActiveTabId(LIVE_TAB_ID);
        }
    };

    const importCapture = async () => {
        const captureExport = await extensionRpc.sendRequest(RpcInspectorImportRequest.type);
        if (!captureExport) {
            return;
        }

        const tabId = `import-${Date.now()}`;
        setImportedTabs((previous) => [
            ...previous,
            {
                id: tabId,
                title: captureExport.session?.name ?? `Imported ${previous.length + 1}`,
                kind: "import",
                importedExport: captureExport,
                eventCount: captureExport.events.length,
            },
        ]);
        setActiveTabId(tabId);
    };

    const exportVisible = async () => {
        const source = activeTab.kind === "import" ? "import" : "visible";
        await extensionRpc.sendRequest(RpcInspectorSaveExportRequest.type, {
            captureExport: createCaptureExport(
                source,
                getVisibleExportEvents(filteredEvents),
                activeFilter,
                activeSession,
            ),
        });
    };

    const exportSession = async () => {
        if (activeTab.kind !== "session" || !activeTab.sessionId) {
            return;
        }

        await extensionRpc.sendRequest(RpcInspectorExportRequest.type, {
            source: "session",
            sessionId: activeTab.sessionId,
        });
    };

    const clearLiveEvents = async () => {
        if (activeTab.kind !== "live") {
            return;
        }

        await extensionRpc.sendRequest(RpcInspectorClearRequest.type);
    };

    const methodFilterCount = countMethodFilters(activeFilter);
    const otherFilterCount = countOtherActiveFilters(activeFilter);
    const activeFilterCount = countActiveFilters(activeFilter);
    const hasSearch = !!activeFilter.search;
    const hasAnyFilter = hasSearch || activeFilterCount > 0;

    return (
        <div className={classes.root}>
            <header className={classes.header}>
                <span className={classes.title}>MSSQL RPC Inspector</span>
                <Badge appearance="outline">{`${filteredEvents.length}/${activeDisplayEvents.length} visible`}</Badge>
                <Text size={200} className={classes.muted}>
                    {activeTab.kind === "live"
                        ? `Live buffer ${liveEvents.length}/${bufferCapacity}`
                        : `${filteredEvents.length} items, ${activeSummary.failedCount} failed`}
                </Text>
            </header>

            <nav className={classes.tabStrip} role="tablist" aria-label="RPC capture tabs">
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`${classes.tabButton} ${
                                isActive ? classes.activeTabButton : ""
                            }`}
                            onClick={() => setActiveTabId(tab.id)}>
                            {tab.isRecording && <span className={classes.recordingDot} />}
                            <span className={classes.tabTitle}>{tab.title}</span>
                            <span className={classes.muted}>{tab.eventCount}</span>
                            {tab.kind !== "live" && (
                                <Tooltip content="Close tab" relationship="label">
                                    <Button
                                        className={classes.tabClose}
                                        size="small"
                                        appearance="subtle"
                                        icon={<Dismiss16Regular />}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void closeTab(tab);
                                        }}
                                    />
                                </Tooltip>
                            )}
                        </button>
                    );
                })}

                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            className={classes.addTabButton}
                            appearance="subtle"
                            icon={<Add16Regular />}
                            aria-label="Add RPC capture tab"
                        />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem icon={<Play16Regular />} onClick={startSession}>
                                New recording session
                            </MenuItem>
                            <MenuDivider />
                            <MenuItem icon={<FolderOpen16Regular />} onClick={importCapture}>
                                Import capture file
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </nav>

            <section className={classes.toolbar} aria-label="RPC filters">
                <Input
                    className={classes.compactInput}
                    size="small"
                    contentBefore={<Search16Regular />}
                    placeholder="Search"
                    value={activeFilter.search ?? ""}
                    onChange={(_, data) => updateActiveFilter({ search: data.value || undefined })}
                />

                <Menu positioning="below-start">
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<Filter16Regular />}
                            aria-label={
                                methodFilterCount > 0
                                    ? `Method filters, ${methodFilterCount} active`
                                    : "Method filters"
                            }
                            title={
                                methodFilterCount > 0
                                    ? `Method filters (${methodFilterCount})`
                                    : "Method filters"
                            }>
                            Methods
                        </Button>
                    </MenuTrigger>
                    <MenuPopover className={classes.filterMenuPopover}>
                        <div className={classes.methodMenuContent}>
                            <FilterMethodRow
                                methods={methodOptions}
                                selectedMethods={activeFilter.methods}
                                onChange={(methods) =>
                                    updateActiveFilter({
                                        method: undefined,
                                        methods,
                                    })
                                }
                            />
                        </div>
                    </MenuPopover>
                </Menu>

                <Menu positioning="below-start">
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<Filter16Regular />}
                            aria-label={
                                otherFilterCount > 0
                                    ? `Filters, ${otherFilterCount} active`
                                    : "Filters"
                            }
                            title={
                                otherFilterCount > 0 ? `Filters (${otherFilterCount})` : "Filters"
                            }
                        />
                    </MenuTrigger>
                    <MenuPopover className={classes.filterMenuPopover}>
                        <div className={classes.filterMenuContent}>
                            <FilterSearchableDropdownRow
                                label="Domain"
                                value={activeFilter.domain}
                                options={domainOptions.map((domain) => ({
                                    value: domain,
                                    label: domain,
                                }))}
                                onChange={(value) => updateActiveFilter({ domain: value })}
                            />
                            <FilterSearchableDropdownRow
                                label="Channel"
                                value={getSingleValue(activeFilter.channels)}
                                options={[
                                    { value: "sqlToolsService", label: "SQL Tools Service" },
                                    { value: "resourceProvider", label: "Resource Provider" },
                                ]}
                                onChange={(value) =>
                                    updateActiveFilter({ channels: setSingleValue(value) })
                                }
                            />
                            <FilterSearchableDropdownRow
                                label="Direction"
                                value={getSingleValue(activeFilter.directions)}
                                options={[
                                    { value: "extensionToService", label: "Extension to service" },
                                    { value: "serviceToExtension", label: "Service to extension" },
                                ]}
                                onChange={(value) =>
                                    updateActiveFilter({ directions: setSingleValue(value) })
                                }
                            />
                            <FilterSearchableDropdownRow
                                label="Kind"
                                value={getSingleValue(activeFilter.kinds)}
                                options={[
                                    { value: "request", label: "Request" },
                                    { value: "response", label: "Response" },
                                    { value: "notification", label: "Notification" },
                                    { value: "unknown", label: "Unknown" },
                                ]}
                                onChange={(value) =>
                                    updateActiveFilter({ kinds: setSingleValue(value) })
                                }
                            />
                            <FilterSearchableDropdownRow
                                label="Status"
                                value={getSingleValue(activeFilter.statuses)}
                                options={[
                                    { value: "pending", label: "Pending" },
                                    { value: "succeeded", label: "Succeeded" },
                                    { value: "failed", label: "Failed" },
                                    { value: "notification", label: "Notification" },
                                    { value: "unknown", label: "Unknown" },
                                ]}
                                onChange={(value) =>
                                    updateActiveFilter({ statuses: setSingleValue(value) })
                                }
                            />
                        </div>
                    </MenuPopover>
                </Menu>

                {hasAnyFilter && (
                    <Tooltip content="Clear filters" relationship="label">
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<FilterDismiss16Regular />}
                            aria-label="Clear filters"
                            onClick={clearActiveFilters}
                        />
                    </Tooltip>
                )}

                <Tooltip content="Export visible" relationship="label">
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Save16Regular />}
                        aria-label="Export visible"
                        onClick={exportVisible}
                    />
                </Tooltip>

                {activeTab.kind === "session" && (
                    <>
                        {activeSession?.isActive ? (
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Dismiss16Regular />}
                                onClick={() => void stopSession(activeTab.sessionId!)}>
                                Stop
                            </Button>
                        ) : (
                            <Tooltip content="Export session" relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<Save16Regular />}
                                    aria-label="Export session"
                                    onClick={exportSession}
                                />
                            </Tooltip>
                        )}
                    </>
                )}

                {activeTab.kind === "live" && (
                    <Tooltip content="Clear live" relationship="label">
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<SlideEraser16Regular />}
                            aria-label="Clear live"
                            onClick={clearLiveEvents}
                        />
                    </Tooltip>
                )}

                <Text size={200} className={classes.muted}>
                    {`${activeSummary.failedCount} failed, ${activeSummary.pendingCount} pending`}
                </Text>
            </section>

            <PanelGroup className={classes.panelGroup} direction="vertical">
                <Panel
                    className={classes.eventsPanel}
                    defaultSize={selectedEvent ? 68 : 100}
                    minSize={30}>
                    <section className={classes.eventsPanel}>
                        <EventGrid events={filteredEvents} onSelect={selectEvent} />
                    </section>
                </Panel>
                {selectedEvent && (
                    <>
                        <PanelResizeHandle className={classes.resizeHandle} />
                        <Panel defaultSize={32} minSize={16} collapsible>
                            <RpcEventDetailsPane
                                event={selectedEvent}
                                activeTab={detailsTab}
                                onTabChange={setDetailsTab}
                                onClose={() =>
                                    setSelectedEventIdsByTabId((previous) => ({
                                        ...previous,
                                        [activeTab.id]: undefined,
                                    }))
                                }
                            />
                        </Panel>
                    </>
                )}
            </PanelGroup>

            <footer className={classes.statusBar}>
                <span>{`${filteredEvents.length} of ${activeDisplayEvents.length} events`}</span>
                {activeTab.kind === "live" && <span>{`Live ring buffer: ${bufferCapacity}`}</span>}
                {activeSession?.isActive && <span>Recording session</span>}
                {selectedEvent && <span>{selectedEvent.method ?? selectedEvent.eventId}</span>}
            </footer>
        </div>
    );
};

const FilterSearchableDropdownRow = <T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T | undefined;
    options: Array<{ value: T; label: string }>;
    onChange: (value: T | undefined) => void;
}) => {
    const classes = useStyles();
    const allOption: SearchableDropdownOptions = {
        value: FILTER_ALL_VALUE,
        text: "All",
    };
    const dropdownOptions = useMemo<SearchableDropdownOptions[]>(
        () => [
            allOption,
            ...options.map((option) => ({
                value: option.value,
                text: option.label,
            })),
        ],
        [options],
    );
    const selectedOption =
        dropdownOptions.find((option) => option.value === (value ?? FILTER_ALL_VALUE)) ?? allOption;

    return (
        <div className={classes.filterMenuRow}>
            <span className={classes.filterLabel}>{label}</span>
            <div className={classes.filterDropdownHost}>
                <SearchableDropdown
                    options={dropdownOptions}
                    selectedOption={selectedOption}
                    ariaLabel={label}
                    searchBoxPlaceholder="Search"
                    size="small"
                    disableMinPopupWidth
                    style={{
                        width: "100%",
                        maxWidth: "100%",
                        minWidth: 0,
                        boxSizing: "border-box",
                        overflow: "hidden",
                    }}
                    onSelect={(option) =>
                        onChange(
                            option.value === FILTER_ALL_VALUE ? undefined : (option.value as T),
                        )
                    }
                />
            </div>
        </div>
    );
};

const FilterMethodRow = ({
    methods,
    selectedMethods,
    onChange,
}: {
    methods: string[];
    selectedMethods: string[] | undefined;
    onChange: (methods: string[] | undefined) => void;
}) => {
    const classes = useStyles();
    const [searchText, setSearchText] = useState("");
    const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => new Set());
    const listRef = useRef<HTMLDivElement | null>(null);
    const knownDomainsRef = useRef<Set<string>>(new Set());
    const selectedSet = useMemo(
        () => new Set(selectedMethods ?? methods),
        [methods, selectedMethods],
    );
    const domainGroups = useMemo<MethodDomainGroup[]>(() => {
        const groupMap = new Map<string, string[]>();
        for (const method of methods) {
            const domain = methodTreeDomain(method);
            const domainMethods = groupMap.get(domain) ?? [];
            domainMethods.push(method);
            groupMap.set(domain, domainMethods);
        }

        return [...groupMap.entries()]
            .map(([domain, domainMethods]) => ({
                domain,
                methods: domainMethods.sort((left, right) => left.localeCompare(right)),
            }))
            .sort((left, right) => left.domain.localeCompare(right.domain));
    }, [methods]);
    const domainKey = useMemo(
        () => domainGroups.map((group) => group.domain).join("\u0000"),
        [domainGroups],
    );
    const filteredGroups = useMemo<MethodDomainGroup[]>(() => {
        const search = searchText.trim().toLowerCase();
        if (!search) {
            return domainGroups;
        }

        return domainGroups
            .map((group) => {
                const domainMatches = group.domain.toLowerCase().includes(search);
                const matchingMethods = domainMatches
                    ? group.methods
                    : group.methods.filter((method) => method.toLowerCase().includes(search));

                return {
                    domain: group.domain,
                    methods: matchingMethods,
                };
            })
            .filter((group) => group.methods.length > 0);
    }, [domainGroups, searchText]);
    const isSearching = searchText.trim().length > 0;
    const treeRows = useMemo<MethodTreeRow[]>(() => {
        const rows: MethodTreeRow[] = [];
        for (const group of filteredGroups) {
            rows.push({
                type: "domain",
                domain: group.domain,
                methods: group.methods,
            });

            if (isSearching || expandedDomains.has(group.domain)) {
                for (const method of group.methods) {
                    rows.push({
                        type: "method",
                        domain: group.domain,
                        method,
                    });
                }
            }
        }

        return rows;
    }, [expandedDomains, filteredGroups, isSearching]);
    const rowVirtualizer = useVirtualizer({
        count: treeRows.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => METHOD_TREE_ROW_HEIGHT,
        overscan: METHOD_TREE_OVERSCAN,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();

    const commitSelection = (nextSelected: Set<string>) => {
        if (
            methods.length > 0 &&
            nextSelected.size === methods.length &&
            methods.every((method) => nextSelected.has(method))
        ) {
            onChange(undefined);
            return;
        }

        onChange(methods.filter((method) => nextSelected.has(method)));
    };

    useEffect(() => {
        const domains = new Set(domainGroups.map((group) => group.domain));
        setExpandedDomains((previous) => {
            const next = new Set<string>();
            const knownDomains = knownDomainsRef.current;
            for (const domain of domains) {
                if (previous.has(domain) || !knownDomains.has(domain)) {
                    next.add(domain);
                }
            }

            return next;
        });
        knownDomainsRef.current = domains;
    }, [domainGroups, domainKey]);

    const toggleMethod = (method: string) => {
        const nextSelected = new Set(selectedSet);
        if (nextSelected.has(method)) {
            nextSelected.delete(method);
        } else {
            nextSelected.add(method);
        }
        commitSelection(nextSelected);
    };

    const toggleDomain = (group: MethodDomainGroup) => {
        const nextSelected = new Set(selectedSet);
        const isDomainSelected = group.methods.every((method) => selectedSet.has(method));
        for (const method of group.methods) {
            if (isDomainSelected) {
                nextSelected.delete(method);
            } else {
                nextSelected.add(method);
            }
        }
        commitSelection(nextSelected);
    };

    const toggleExpandedDomain = (domain: string) => {
        setExpandedDomains((previous) => {
            const next = new Set(previous);
            if (next.has(domain)) {
                next.delete(domain);
            } else {
                next.add(domain);
            }

            return next;
        });
    };

    const setAllMethodsSelected = (selected: boolean | "mixed") => {
        onChange(selected ? undefined : []);
    };

    const selectedCount = methods.filter((method) => selectedSet.has(method)).length;
    const allMethodsChecked =
        methods.length === 0
            ? false
            : selectedCount === methods.length
              ? true
              : selectedCount > 0
                ? "mixed"
                : false;
    const domainGroupByName = useMemo(
        () => new Map(filteredGroups.map((group) => [group.domain, group])),
        [filteredGroups],
    );

    return (
        <div className={classes.methodFilter}>
            <div className={classes.methodFilterHeader}>
                <Input
                    className={classes.methodFilterSearch}
                    size="small"
                    value={searchText}
                    placeholder="Search methods"
                    contentBefore={<Search16Regular />}
                    onChange={(_, data) => setSearchText(data.value)}
                />
                <Checkbox
                    className={classes.methodTreeCheckbox}
                    checked={allMethodsChecked}
                    label="Select all"
                    disabled={methods.length === 0}
                    onChange={(_, data) => setAllMethodsSelected(data.checked)}
                />
                <Button
                    className={classes.methodFilterAction}
                    appearance="transparent"
                    size="small"
                    icon={<SlideEraser16Regular />}
                    disabled={methods.length === 0}
                    onClick={() => onChange([])}>
                    Clear
                </Button>
            </div>
            <Text size={100} className={mergeClasses(classes.muted, classes.methodFilterSummary)}>
                {`${selectedCount}/${methods.length} methods selected`}
            </Text>
            <div
                ref={listRef}
                className={classes.methodFilterList}
                role="tree"
                aria-label="Methods">
                {treeRows.length === 0 ? (
                    <div className={classes.methodFilterOption}>
                        <Text size={100} className={classes.muted}>
                            No methods
                        </Text>
                    </div>
                ) : (
                    <div
                        className={classes.methodTreeContent}
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                        {virtualRows.map((virtualRow) => {
                            const row = treeRows[virtualRow.index];
                            if (!row) {
                                return undefined;
                            }

                            const rowStyle = {
                                transform: `translateY(${virtualRow.start}px)`,
                            };

                            if (row.type === "domain") {
                                const group = domainGroupByName.get(row.domain);
                                const rowMethods = group?.methods ?? row.methods;
                                const checkedCount = rowMethods.filter((method) =>
                                    selectedSet.has(method),
                                ).length;
                                const checked =
                                    checkedCount === 0
                                        ? false
                                        : checkedCount === rowMethods.length
                                          ? true
                                          : "mixed";
                                const isExpanded = isSearching || expandedDomains.has(row.domain);

                                return (
                                    <div
                                        key={`domain-${row.domain}`}
                                        className={mergeClasses(
                                            classes.methodTreeRow,
                                            classes.methodTreeDomainRow,
                                        )}
                                        role="treeitem"
                                        aria-level={1}
                                        aria-expanded={isExpanded}
                                        title={row.domain}
                                        style={rowStyle}>
                                        <Button
                                            className={classes.methodTreeToggle}
                                            appearance="transparent"
                                            size="small"
                                            icon={
                                                isExpanded ? (
                                                    <ChevronDown16Regular />
                                                ) : (
                                                    <ChevronRight16Regular />
                                                )
                                            }
                                            disabled={isSearching}
                                            aria-label={
                                                isExpanded
                                                    ? `Collapse ${row.domain}`
                                                    : `Expand ${row.domain}`
                                            }
                                            onClick={() => toggleExpandedDomain(row.domain)}
                                        />
                                        <Checkbox
                                            className={classes.methodTreeCheckbox}
                                            checked={checked}
                                            label={row.domain}
                                            onChange={() =>
                                                toggleDomain({
                                                    domain: row.domain,
                                                    methods: rowMethods,
                                                })
                                            }
                                        />
                                        <span className={classes.methodTreeCount}>
                                            {`${checkedCount}/${rowMethods.length}`}
                                        </span>
                                    </div>
                                );
                            }

                            return (
                                <div
                                    key={`method-${row.domain}-${row.method}`}
                                    className={mergeClasses(
                                        classes.methodTreeRow,
                                        classes.methodTreeMethodRow,
                                    )}
                                    role="treeitem"
                                    aria-level={2}
                                    title={row.method}
                                    style={rowStyle}
                                    onClick={() => toggleMethod(row.method)}>
                                    <span className={classes.methodTreeIndent} />
                                    <Checkbox
                                        checked={selectedSet.has(row.method)}
                                        label={row.method}
                                        tabIndex={-1}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

function formatChannel(channel: RpcCaptureEvent["channel"]): string {
    return channel === "sqlToolsService" ? "SQL Tools" : "Resource";
}

function formatSource(direction: RpcCaptureEvent["direction"]): string {
    return direction === "extensionToService" ? "Extension" : "Service";
}

function formatMessageKind(event: RpcDisplayEvent): string {
    if (event.kind === "request" && event.responseEvent) {
        return "Request/response";
    }

    return event.kind;
}

function formatStatus(status: RpcCaptureEvent["status"]): string {
    switch (status) {
        case "pending":
        case "succeeded":
        case "failed":
        case "notification":
            return status;
        default:
            return "unknown";
    }
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return char;
        }
    });
}

function formatSlickGridCell(value: string, className = "", title?: string): string {
    const titleAttribute = title === undefined ? "" : ` title="${escapeHtml(title)}"`;
    return `<span class="rpc-grid-cell ${className}"${titleAttribute}>${escapeHtml(value)}</span>`;
}

function getMessageGridClass(event: RpcDisplayEvent): string {
    switch (event.kind) {
        case "request":
            return "rpc-grid-request";
        case "notification":
            return "rpc-grid-notification";
        case "response":
            return "rpc-grid-response";
        default:
            return "rpc-grid-muted";
    }
}

function getStatusGridClass(status: RpcCaptureEvent["status"]): string {
    switch (status) {
        case "succeeded":
            return "rpc-grid-status-succeeded";
        case "failed":
            return "rpc-grid-status-failed";
        case "pending":
        case "notification":
            return "rpc-grid-status-pending";
        default:
            return "rpc-grid-muted";
    }
}

const textGridFormatter: Formatter<RpcGridRow> = (_row, _cell, value) =>
    formatSlickGridCell(value === undefined || value === null ? "" : String(value));

function createRpcGridColumns(): Column<RpcGridRow>[] {
    return [
        {
            id: EXPAND_COLUMN_ID,
            field: "expandLabel",
            name: "Expand",
            width: 72,
            minWidth: 64,
            maxWidth: 84,
            cssClass: "rpc-grid-expand-cell",
            excludeFromColumnPicker: true,
            excludeFromExport: true,
            selectable: false,
            formatter: () =>
                formatSlickGridCell("Expand", "rpc-grid-expand-action", "Open details"),
        },
        {
            id: "timestamp",
            field: "displayTime",
            name: "Time",
            width: 138,
            minWidth: 120,
            formatter: textGridFormatter,
        },
        {
            id: "channel",
            field: "displayChannel",
            name: "Channel",
            width: 112,
            minWidth: 96,
            formatter: textGridFormatter,
        },
        {
            id: "method",
            field: "displayMethod",
            name: "Method",
            width: 430,
            minWidth: 260,
            formatter: (_row, _cell, _value, _column, event) => {
                const method = event.displayMethod;
                return formatSlickGridCell(method, "", method);
            },
        },
        {
            id: "kind",
            field: "displayMessage",
            name: "Message",
            width: 144,
            minWidth: 118,
            formatter: (_row, _cell, value, _column, event) =>
                formatSlickGridCell(String(value ?? ""), getMessageGridClass(event)),
        },
        {
            id: "status",
            field: "displayStatus",
            name: "Status",
            width: 122,
            minWidth: 104,
            formatter: (_row, _cell, value, _column, event) =>
                formatSlickGridCell(String(value ?? ""), getStatusGridClass(event.status)),
        },
        {
            id: "duration",
            field: "displayDuration",
            name: "Duration",
            width: 92,
            minWidth: 82,
            formatter: textGridFormatter,
        },
        {
            id: "source",
            field: "displaySource",
            name: "Source",
            width: 104,
            minWidth: 84,
            formatter: textGridFormatter,
        },
        {
            id: "jsonRpcId",
            field: "jsonRpcId",
            name: "RPC Id",
            width: 110,
            minWidth: 88,
            formatter: textGridFormatter,
        },
    ];
}

const EventGrid = ({
    events,
    onSelect,
}: {
    events: RpcDisplayEvent[];
    onSelect: (event: RpcDisplayEvent) => void;
}) => {
    const classes = useStyles();
    const reactGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const gridWrapperRef = useRef<HTMLDivElement | null>(null);
    const resizeRafRef = useRef<number | null>(null);
    const shouldFollowLatestRef = useRef(true);
    const dataset = useMemo<RpcGridRow[]>(
        () =>
            events.map((event) => ({
                ...event,
                id: event.eventId,
                expandLabel: "Expand",
                displayTime: formatTime(event.timestamp),
                displayChannel: formatChannel(event.channel),
                displayMethod: event.method ?? "",
                displayMessage: formatMessageKind(event),
                displayStatus: formatStatus(event.status),
                displayDuration: formatDuration(event.durationMs),
                displaySource: formatSource(event.direction),
            })),
        [events],
    );

    const isEmpty = events.length === 0;
    const columns = useMemo<Column<RpcGridRow>[]>(
        // slickgrid-react mutates the column array during some clear/remount paths.
        // Recreate descriptors around the empty/nonempty transition so new rows do not render blank.
        () => createRpcGridColumns(),
        [isEmpty],
    );

    const gridOptions = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            autoResize: createFluentAutoResizeOptions("#rpcInspectorGridContainer", {
                autoHeight: false,
                bottomPadding: 0,
                minHeight: 50,
            }),
            enableAutoSizeColumns: false,
            enableCellNavigation: true,
            enableContextMenu: true,
            contextMenu: {
                ...createFluentSlickGridCopyMenu("Copy"),
                onCommand: (_event, args) => {
                    if (args?.command !== FLUENT_SLICK_GRID_COPY_COMMAND) {
                        return;
                    }

                    const text = getFluentSlickGridSelectionText(reactGridRef.current);
                    if (text) {
                        void navigator.clipboard.writeText(text);
                    }
                },
            },
            rowHeight: RPC_GRID_ROW_HEIGHT,
            emptyDataWarning: {
                message: "No RPC events",
            },
        }),
        [],
    );
    const latestEventId = dataset[dataset.length - 1]?.eventId;

    const scheduleGridResize = useCallback(() => {
        if (resizeRafRef.current !== null) {
            cancelAnimationFrame(resizeRafRef.current);
        }

        resizeRafRef.current = requestAnimationFrame(() => {
            resizeRafRef.current = null;
            const reactGrid = reactGridRef.current;
            if (!reactGrid) {
                return;
            }

            void reactGrid.resizerService?.resizeGrid();
            reactGrid.slickGrid?.resizeCanvas();
            reactGrid.slickGrid?.invalidate();
            reactGrid.slickGrid?.render();
        });
    }, []);

    const getGridRow = (rowIndex: number): RpcGridRow | undefined =>
        dataset[rowIndex] ??
        (reactGridRef.current?.dataView?.getItem(rowIndex) as RpcGridRow | undefined);

    const selectGridRow = (rowIndex: number) => {
        const event = getGridRow(rowIndex);
        if (!event) {
            return;
        }

        onSelect(event);
    };

    const handleReactGridCreated = (event: CustomEvent<SlickgridReactInstance>) => {
        reactGridRef.current = event.detail;
        const selectionModel = new CellSelectionModel<RpcGridRow>({
            hasRowSelector: true,
            cellRangeSelector: new CellRangeSelector<RpcGridRow>({
                selectionCss: {
                    border: "2px dashed var(--vscode-focusBorder)",
                },
            }),
        });
        event.detail.slickGrid.setSelectionModel(
            selectionModel as unknown as Parameters<
                typeof event.detail.slickGrid.setSelectionModel
            >[0],
        );
        event.detail.dataView?.setItems(dataset);
        event.detail.slickGrid.updateRowCount();
        event.detail.slickGrid.invalidate();
        event.detail.slickGrid.render();
        scheduleGridResize();
    };

    const handleGridClick = (event: CustomEvent) => {
        const args = event.detail?.args;
        const rowIndex = args?.row;
        const cellIndex = args?.cell;
        const column = reactGridRef.current?.slickGrid?.getColumns()?.[cellIndex];
        if (typeof rowIndex === "number" && column?.id === EXPAND_COLUMN_ID) {
            selectGridRow(rowIndex);
        }
    };

    const handleGridScroll = (event: CustomEvent) => {
        const args = event.detail?.args;
        const viewportElement = args?.grid?.getViewportNode?.();
        if (!args || !viewportElement) {
            return;
        }

        const distanceFromBottom =
            args.scrollHeight - args.scrollTop - viewportElement.offsetHeight;
        shouldFollowLatestRef.current = distanceFromBottom <= RPC_GRID_FOLLOW_BOTTOM_THRESHOLD_PX;
    };

    useEffect(() => {
        if (!latestEventId || !shouldFollowLatestRef.current) {
            return;
        }

        requestAnimationFrame(() => {
            reactGridRef.current?.slickGrid?.scrollRowIntoView(dataset.length - 1, false);
        });
    }, [dataset.length, latestEventId]);

    useEffect(() => {
        scheduleGridResize();
    }, [columns, dataset.length, scheduleGridResize]);

    useEffect(() => {
        const reactGrid = reactGridRef.current;
        if (!reactGrid?.dataView || !reactGrid.slickGrid) {
            return;
        }

        reactGrid.dataView.setItems(dataset);
        reactGrid.slickGrid.updateRowCount();
        reactGrid.slickGrid.invalidate();
        reactGrid.slickGrid.render();
        scheduleGridResize();
    }, [dataset, scheduleGridResize]);

    useEffect(() => {
        const gridWrapper = gridWrapperRef.current;
        if (!gridWrapper) {
            return undefined;
        }

        const resizeObserver = new ResizeObserver(() => scheduleGridResize());
        resizeObserver.observe(gridWrapper);
        scheduleGridResize();

        return () => {
            resizeObserver.disconnect();
            if (resizeRafRef.current !== null) {
                cancelAnimationFrame(resizeRafRef.current);
                resizeRafRef.current = null;
            }
        };
    }, [scheduleGridResize]);

    return (
        <div className={classes.gridContainer}>
            <div
                id="rpcInspectorGridContainer"
                className={classes.gridWrapper}
                ref={gridWrapperRef}>
                <FluentSlickGrid
                    gridId="rpcInspectorGrid"
                    columns={columns}
                    options={gridOptions}
                    dataset={dataset}
                    onReactGridCreated={handleReactGridCreated}
                    onClick={handleGridClick}
                    onScroll={handleGridScroll}
                />
            </div>
        </div>
    );
};

const RpcEventDetailsPane = ({
    event,
    activeTab,
    onTabChange,
    onClose,
}: {
    event: RpcDisplayEvent;
    activeTab: DetailsTab;
    onTabChange: (tab: DetailsTab) => void;
    onClose: () => void;
}) => {
    const classes = useStyles();
    const raw = {
        eventId: event.eventId,
        timestamp: event.timestamp,
        channel: event.channel,
        direction: event.direction,
        kind: event.kind,
        method: event.method,
        jsonRpcId: event.jsonRpcId,
        relatedEventId: event.relatedEventId,
        durationMs: event.durationMs,
        status: event.status,
        params: event.params,
        result: event.result,
        error: event.error,
        redactionSummary: event.redactionSummary,
        requestEvent: event.requestEvent,
        responseEvent: event.responseEvent,
    };

    const copy = (value: unknown) => {
        void navigator.clipboard.writeText(formatJson(value));
    };

    const renderSingle = (label: string, value: unknown) => (
        <div className={classes.detailsColumn} style={{ borderRight: "none" }}>
            <div className={classes.detailsColumnHeader}>
                <Text size={200}>{label}</Text>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<Copy16Regular />}
                    disabled={value === undefined}
                    onClick={() => copy(value)}
                    aria-label={`Copy ${label}`}
                />
            </div>
            <div className={classes.detailsColumnBody}>
                {value === undefined ? (
                    <Text className={classes.muted}>No value</Text>
                ) : (
                    <pre className={classes.detailsPre}>{formatJson(value)}</pre>
                )}
            </div>
        </div>
    );

    return (
        <section className={classes.detailsPane} aria-label="RPC event details">
            <div className={classes.detailsHeader}>
                <TabList
                    size="small"
                    selectedValue={activeTab}
                    onTabSelect={(_: SelectTabEvent, data: SelectTabData) => {
                        onTabChange(data.value as DetailsTab);
                    }}>
                    <Tab value="all">All</Tab>
                    <Tab value="params">Params</Tab>
                    <Tab value="result">Result</Tab>
                    <Tab value="raw">Raw</Tab>
                </TabList>
                <span className={classes.detailsTitle}>
                    {`${formatMessageKind(event)}: ${event.method ?? event.jsonRpcId ?? event.eventId}`}
                </span>
                <div className={classes.detailsActions}>
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Copy16Regular />}
                        onClick={() => copy(raw)}
                        aria-label="Copy all event details"
                    />
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Dismiss16Regular />}
                        onClick={onClose}
                        aria-label="Close event details"
                    />
                </div>
            </div>
            <div className={classes.detailsContent}>
                {activeTab === "all" ? (
                    <div className={classes.detailsColumns}>
                        <DetailsColumn label="Params" value={event.params} copy={copy} />
                        <DetailsColumn
                            label="Result"
                            value={event.error ?? event.result}
                            copy={copy}
                        />
                        <DetailsColumn label="Raw" value={raw} copy={copy} />
                    </div>
                ) : activeTab === "params" ? (
                    renderSingle("Params", event.params)
                ) : activeTab === "result" ? (
                    renderSingle(event.error ? "Error" : "Result", event.error ?? event.result)
                ) : (
                    renderSingle("Raw", raw)
                )}
            </div>
        </section>
    );
};

const DetailsColumn = ({
    label,
    value,
    copy,
}: {
    label: string;
    value: unknown;
    copy: (value: unknown) => void;
}) => {
    const classes = useStyles();
    return (
        <div className={classes.detailsColumn}>
            <div className={classes.detailsColumnHeader}>
                <Text size={200}>{label}</Text>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<Copy16Regular />}
                    disabled={value === undefined}
                    onClick={() => copy(value)}
                    aria-label={`Copy ${label}`}
                />
            </div>
            <div className={classes.detailsColumnBody}>
                {value === undefined ? (
                    <Text className={classes.muted}>No value</Text>
                ) : (
                    <pre className={classes.detailsPre}>{formatJson(value)}</pre>
                )}
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <RpcInspectorPage />
    </VscodeWebviewProvider>,
);
