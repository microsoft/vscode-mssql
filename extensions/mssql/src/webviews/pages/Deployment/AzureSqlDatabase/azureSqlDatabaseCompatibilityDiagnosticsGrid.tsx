/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { makeStyles, mergeClasses, Text } from "@fluentui/react-components";
import {
    htmlEncode,
    SlickRange,
    type Column,
    type GridOption,
    type SlickgridReactInstance,
} from "slickgrid-react";
import type { LocalDatabaseCompatibilityDiagnostic } from "../../../../sharedInterfaces/azureSqlDatabase";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    FluentSlickGrid,
    getFluentSlickGridSelectionText,
} from "../../../common/FluentSlickGrid/FluentSlickGrid";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { serializeCompatibilityDiagnostics } from "./compatibilityDiagnosticsExport";

interface DiagnosticRow {
    id: number;
    code: string;
    message: string;
    issue: string;
    location: string;
}

const rowHeight = 28;
const maximumHeight = 280;
const tableBackground =
    "color-mix(in srgb, var(--compatibility-diagnostic-color) 6%, var(--vscode-editor-background))";

const useStyles = makeStyles({
    container: {
        "--compatibility-diagnostic-color": "var(--vscode-errorForeground)",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        maxHeight: "40vh",
        overflow: "hidden",
        isolation: "isolate",
        boxSizing: "border-box",
        border: "1px solid color-mix(in srgb, var(--compatibility-diagnostic-color) 30%, var(--vscode-editor-background))",
        borderRadius: "6px",
        backgroundColor: tableBackground,
        "& .slickgrid-container": {
            boxSizing: "border-box",
        },
        "& .slick-header, & .slick-header-columns, & .slick-header-column": {
            backgroundColor:
                "color-mix(in srgb, var(--compatibility-diagnostic-color) 12%, var(--vscode-editor-background)) !important",
            color: "var(--vscode-foreground)",
        },
        "& .slick-pane, & .slick-viewport, & .grid-canvas, & .slick-row, & .slick-cell": {
            backgroundColor: `${tableBackground} !important`,
        },
        "& .slick-row.odd .slick-cell": {
            backgroundColor:
                "color-mix(in srgb, var(--compatibility-diagnostic-color) 9%, var(--vscode-editor-background)) !important",
        },
        "& .slick-row:hover .slick-cell, & .slick-cell.active": {
            backgroundColor:
                "color-mix(in srgb, var(--compatibility-diagnostic-color) 16%, var(--vscode-editor-background)) !important",
        },
        "& .slick-row .slick-cell.selected, & .slick-row.odd .slick-cell.selected": {
            backgroundColor:
                "color-mix(in srgb, var(--compatibility-diagnostic-color) 24%, var(--vscode-editor-background)) !important",
        },
        "& .slick-header-column": {
            boxSizing: "border-box",
            fontSize: "12px !important",
            padding: "4px 6px !important",
        },
        "& .slick-cell": {
            boxSizing: "border-box",
            fontSize: "12px !important",
            lineHeight: "22px !important",
            padding: "2px 6px !important",
            color: "var(--vscode-foreground)",
        },
    },
    warning: {
        "--compatibility-diagnostic-color": "var(--vscode-editorWarning-foreground)",
    },
    actionError: { color: "var(--vscode-errorForeground)", overflowWrap: "anywhere" },
});

export const AzureSqlDatabaseCompatibilityDiagnosticsGrid = ({
    diagnostics,
    variant = "error",
}: {
    diagnostics: LocalDatabaseCompatibilityDiagnostic[];
    variant?: "error" | "warning";
}) => {
    const classes = useStyles();
    const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const gridId = `azureSqlCompatibility${instanceId}`;
    const containerId = `${gridId}Container`;
    const gridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const resizeFrame = useRef<number | undefined>(undefined);
    const lastResizedColumn = useRef<string | undefined>(undefined);
    const [height, setHeight] = useState(() =>
        Math.min(maximumHeight, diagnostics.length * rowHeight + 30),
    );
    const { themeKind, localization, extensionRpc } = useVscodeWebview<
        DeploymentWebviewState,
        DeploymentReducers
    >();
    const [actionError, setActionError] = useState<string>();
    const strings = locConstants.azureSqlDatabase;
    const codeLabel =
        variant === "warning" ? strings.compatibilityWarningCode : strings.compatibilityErrorCode;
    const messageLabel =
        variant === "warning" ? strings.compatibilityWarningText : strings.compatibilityErrorText;
    const columns = useMemo<Column<DiagnosticRow>[]>(() => {
        const formatter = (_row: number, _cell: number, value: unknown) =>
            htmlEncode(String(value ?? ""));
        return [
            {
                id: "code",
                field: "code",
                name: codeLabel,
                width: variant === "warning" ? 120 : 90,
                minWidth: 70,
                resizable: true,
                formatter,
            },
            {
                id: "message",
                field: "message",
                name: messageLabel,
                width: 360,
                minWidth: 180,
                resizable: true,
                formatter,
            },
            {
                id: "issue",
                field: "issue",
                name: strings.compatibilityIssueColumn,
                width: 170,
                minWidth: 110,
                resizable: true,
                formatter,
            },
            {
                id: "location",
                field: "location",
                name: strings.compatibilityLineColumn,
                width: 220,
                minWidth: 120,
                resizable: true,
                formatter,
            },
        ];
    }, [
        codeLabel,
        messageLabel,
        strings.compatibilityIssueColumn,
        strings.compatibilityLineColumn,
        variant,
    ]);
    const rows = useMemo<DiagnosticRow[]>(() => {
        const labels = locConstants.azureSqlDatabase;
        return diagnostics.map((diagnostic, id) => ({
            id,
            code: diagnostic.code,
            message: diagnostic.message,
            issue:
                diagnostic.category === "dependency"
                    ? labels.compatibilityDependency
                    : diagnostic.category === "tooling"
                      ? labels.compatibilityTooling
                      : labels.compatibilityIssue,
            location: diagnostic.file
                ? diagnostic.line !== undefined
                    ? labels.compatibilityLocation(diagnostic.file, diagnostic.line)
                    : diagnostic.file
                : (diagnostic.line?.toLocaleString() ?? labels.sourceVersionUnavailable),
        }));
    }, [diagnostics, localization]);
    const scheduleLayout = useCallback(
        (columnId?: string) => {
            if (columnId) {
                lastResizedColumn.current = columnId;
            }
            if (resizeFrame.current !== undefined) {
                cancelAnimationFrame(resizeFrame.current);
            }
            resizeFrame.current = requestAnimationFrame(() => {
                resizeFrame.current = undefined;
                const grid = gridRef.current?.slickGrid;
                const container = document.getElementById(containerId);
                const viewport = container?.querySelector<HTMLElement>(".slick-viewport");
                if (!grid || !container || !viewport) {
                    return;
                }
                const currentColumns = grid.getColumns();
                const unusedWidth = Math.floor(
                    viewport.clientWidth -
                        currentColumns.reduce((width, column) => width + (column.width ?? 0), 0),
                );
                const fillColumn = currentColumns.find(
                    (column) =>
                        column.id ===
                        (lastResizedColumn.current === "message" ? "location" : "message"),
                );
                if (unusedWidth > 0 && fillColumn) {
                    grid.setColumns(
                        currentColumns.map((column) =>
                            column === fillColumn
                                ? { ...column, width: (column.width ?? 0) + unusedWidth }
                                : column,
                        ),
                    );
                }
                const gridElement = grid.getContainerNode();
                const body = gridElement.querySelector<HTMLElement>(".slick-pane-top");
                const headerHeight = body?.offsetTop ?? 0;
                const scrollbarHeight = viewport.offsetHeight - viewport.clientHeight;
                const gridBorderHeight = gridElement.offsetHeight - gridElement.clientHeight;
                const borderHeight = container.offsetHeight - container.clientHeight;
                setHeight(
                    Math.min(
                        maximumHeight,
                        diagnostics.length * rowHeight +
                            headerHeight +
                            scrollbarHeight +
                            gridBorderHeight +
                            borderHeight,
                    ),
                );
            });
        },
        [containerId, diagnostics.length],
    );
    useEffect(() => {
        scheduleLayout();
        return () => {
            if (resizeFrame.current !== undefined) {
                cancelAnimationFrame(resizeFrame.current);
            }
        };
    }, [scheduleLayout]);
    const handleCommand = useCallback(
        async (command: string, value: unknown) => {
            setActionError(undefined);
            try {
                const instance = gridRef.current;
                if (!instance) {
                    return;
                }
                const grid = instance.slickGrid;
                if (command === "select-all") {
                    const rowCount = instance.dataView.getLength();
                    const columnCount = grid.getVisibleColumns().length;
                    if (rowCount && columnCount) {
                        grid.setActiveCell(0, 0);
                        grid.getSelectionModel()?.setSelectedRanges([
                            new SlickRange(0, 0, rowCount - 1, columnCount - 1),
                        ]);
                        grid.focus();
                    }
                    return;
                }
                if (command === "export-csv" || command === "export-json") {
                    const visibleColumns = grid.getVisibleColumns();
                    const headers = visibleColumns.map((column) => String(column.name ?? ""));
                    const values = Array.from(
                        { length: instance.dataView.getLength() },
                        (_, index) => {
                            const item = instance.dataView.getItem(index);
                            return visibleColumns.map((column) =>
                                String(column.field ? (item[column.field] ?? "") : ""),
                            );
                        },
                    );
                    const format = command === "export-csv" ? "csv" : "json";
                    extensionRpc.action("downloadDeploymentScript", {
                        content: serializeCompatibilityDiagnostics(headers, values, format),
                        fileName: `compatibility-${variant}s.${format}`,
                    });
                    return;
                }
                const text =
                    command === "copy-value"
                        ? String(value ?? "")
                        : getFluentSlickGridSelectionText(instance, {
                              includeHeaders: command === "copy-with-headers",
                              headersOnly: command === "copy-headers",
                          });
                if (text !== undefined) {
                    await navigator.clipboard.writeText(text);
                }
            } catch (error) {
                extensionRpc.log.error("Compatibility diagnostics table action failed", error);
                setActionError(
                    locConstants.azureSqlDatabase.compatibilityTableActionFailed(
                        error instanceof Error ? error.message : String(error),
                    ),
                );
            }
        },
        [extensionRpc, variant],
    );
    const options = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            autoResize: createFluentAutoResizeOptions(`#${containerId}`, {
                autoHeight: false,
                bottomPadding: 0,
                rightPadding: 0,
                minHeight: 0,
                minWidth: 0,
            }),
            darkMode:
                themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
            rowHeight,
            alwaysShowVerticalScroll: false,
            enableAutoSizeColumns: false,
            enableColumnReorder: true,
            forceFitColumns: false,
            enableExcelCopyBuffer: false,
            enableTextSelectionOnCells: false,
            enableSelection: true,
            selectionOptions: { selectionType: "cell" },
            enableContextMenu: true,
            contextMenu: {
                hideCommands: ["copy"],
                hideCloseButton: true,
                commandItems: [
                    {
                        command: "copy-value",
                        title: strings.compatibilityCopyValue,
                        iconCssClass: "fi fi-copy",
                    },
                    {
                        command: "copy",
                        title: locConstants.slickGrid.copy,
                        iconCssClass: "fi fi-copy",
                    },
                    {
                        command: "copy-with-headers",
                        title: locConstants.slickGrid.copyWithHeaders,
                        iconCssClass: "fi fi-copy",
                    },
                    {
                        command: "copy-headers",
                        title: locConstants.slickGrid.copyHeaders,
                        iconCssClass: "fi fi-copy",
                    },
                    "divider",
                    { command: "select-all", title: locConstants.slickGrid.selectAll },
                    "divider",
                    {
                        command: "export-csv",
                        title: locConstants.slickGrid.exportToCsv,
                        iconCssClass: "fi fi-arrow-download",
                    },
                    {
                        command: "export-json",
                        title: locConstants.slickGrid.exportToJson,
                        iconCssClass: "fi fi-arrow-download",
                    },
                ],
                onBeforeMenuShow: (_event, { grid, row, cell }) => {
                    const selection = grid.getSelectionModel();
                    if (
                        !selection?.getSelectedRanges().some((range) => range.contains(row, cell))
                    ) {
                        grid.setActiveCell(row, cell);
                        selection?.setSelectedRanges([new SlickRange(row, cell)]);
                    }
                },
                onCommand: (_event, args) =>
                    void handleCommand(
                        args.command,
                        args.column.field ? args.dataContext?.[args.column.field] : undefined,
                    ),
            },
        }),
        [containerId, themeKind, handleCommand, localization, strings.compatibilityCopyValue],
    );

    return (
        <>
            <div
                id={containerId}
                className={mergeClasses(
                    classes.container,
                    variant === "warning" && classes.warning,
                )}
                role="region"
                data-vscode-context='{"preventDefaultContextMenuItems": true}'
                aria-label={strings.compatibilityDiagnostics}
                style={{ height }}>
                <FluentSlickGrid
                    gridId={gridId}
                    columns={columns}
                    dataset={rows}
                    options={options}
                    onReactGridCreated={(event) => {
                        gridRef.current = event.detail;
                        scheduleLayout();
                    }}
                    onColumnsResized={(event) =>
                        scheduleLayout(event.detail.args.triggeredByColumn)
                    }
                    onGridAfterResize={() => scheduleLayout()}
                    onKeyDown={(event) => {
                        const keyboardEvent = event.detail.eventData;
                        if (
                            !(keyboardEvent.ctrlKey || keyboardEvent.metaKey) ||
                            keyboardEvent.altKey
                        ) {
                            return;
                        }
                        const key = keyboardEvent.key.toLowerCase();
                        if (key === "c" || key === "a") {
                            keyboardEvent.preventDefault();
                            keyboardEvent.stopImmediatePropagation();
                            void handleCommand(key === "a" ? "select-all" : "copy", undefined);
                        }
                    }}
                />
            </div>
            {actionError && (
                <Text role="alert" className={classes.actionError}>
                    {actionError}
                </Text>
            )}
        </>
    );
};
