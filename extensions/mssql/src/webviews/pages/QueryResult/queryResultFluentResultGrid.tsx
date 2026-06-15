/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    FluentResultGrid,
    FluentResultGridCommand,
    FluentResultGridCommandPlacement,
    FluentResultGridProvider,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandEvent,
    type FluentResultGridKeyBindingMap,
    type FluentResultGridState,
    type FluentResultGridStrings,
    type FluentResultGridTheme,
} from "../../common/FluentResultGrid";
import "../../common/FluentResultGrid/FluentResultGrid.vscode.css";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    ColorThemeKind,
    WebviewAction,
    type WebviewKeyBindings,
} from "../../../sharedInterfaces/webview";
import * as qr from "../../../sharedInterfaces/queryResult";
import { QueryResultsGridView } from "./queryResultsGridView";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import type { ResultGridHandle, ResultGridProps } from "./resultGrid";
import {
    getQueryResultGridPerfNow,
    measureQueryResultGridPerfAsync,
    recordQueryResultGridPerfEvent,
    scheduleQueryResultGridPerfPaint,
    setQueryResultGridPerfEnabled,
    type QueryResultGridPerfContext,
} from "./gridPerf";

const DEFAULT_FONT_SIZE = 12;
const BASE_ROW_PADDING = 12;
const vscodeOverlayRootProps = {
    "data-vscode-context": JSON.stringify({ preventDefaultContextMenuItems: true }),
};

function normalizeRowPadding(rowPadding: number | null | undefined): number {
    return typeof rowPadding === "number" && Number.isFinite(rowPadding)
        ? Math.max(0, rowPadding)
        : 0;
}

function getRowHeight(fontSize: number | undefined, rowPadding: number): number {
    return (fontSize ?? DEFAULT_FONT_SIZE) + BASE_ROW_PADDING + rowPadding * 2;
}

function toFluentThemeKind(themeKind: ColorThemeKind): FluentResultGridTheme["kind"] {
    switch (themeKind) {
        case ColorThemeKind.Dark:
            return "dark";
        case ColorThemeKind.HighContrast:
            return "highContrast";
        case ColorThemeKind.HighContrastLight:
            return "highContrastLight";
        default:
            return "light";
    }
}

function mapKeyBinding(
    keyBindings: WebviewKeyBindings,
    command: string,
    action: WebviewAction,
): [string, FluentResultGridKeyBindingMap[string]] {
    return [command, keyBindings[action]];
}

function getFluentResultGridKeyBindings(
    keyBindings: WebviewKeyBindings,
): FluentResultGridKeyBindingMap {
    return Object.fromEntries([
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SelectAll,
            WebviewAction.ResultGridSelectAll,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopySelection,
            WebviewAction.ResultGridCopySelection,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopyWithHeaders,
            WebviewAction.ResultGridCopyWithHeaders,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopyHeaders,
            WebviewAction.ResultGridCopyAllHeaders,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopyAsCsv,
            WebviewAction.ResultGridCopyAsCsv,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopyAsJson,
            WebviewAction.ResultGridCopyAsJson,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopyAsInsertInto,
            WebviewAction.ResultGridCopyAsInsert,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.CopyAsInClause,
            WebviewAction.ResultGridCopyAsInClause,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SaveAsJson,
            WebviewAction.QueryResultSaveAsJson,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SaveAsCsv,
            WebviewAction.QueryResultSaveAsCsv,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SaveAsExcel,
            WebviewAction.QueryResultSaveAsExcel,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SaveAsInsert,
            WebviewAction.QueryResultSaveAsInsert,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SwitchToGridView,
            WebviewAction.QueryResultSwitchToTextView,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SwitchToTextView,
            WebviewAction.QueryResultSwitchToTextView,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.Maximize,
            WebviewAction.QueryResultMaximizeGrid,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.Restore,
            WebviewAction.QueryResultMaximizeGrid,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.ToggleSort,
            WebviewAction.ResultGridToggleSort,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.OpenFilter,
            WebviewAction.ResultGridOpenFilterMenu,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.OpenResizeDialog,
            WebviewAction.ResultGridChangeColumnWidth,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.ExpandSelectionLeft,
            WebviewAction.ResultGridExpandSelectionLeft,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.ExpandSelectionRight,
            WebviewAction.ResultGridExpandSelectionRight,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.ExpandSelectionUp,
            WebviewAction.ResultGridExpandSelectionUp,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.ExpandSelectionDown,
            WebviewAction.ResultGridExpandSelectionDown,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.OpenColumnMenu,
            WebviewAction.ResultGridOpenColumnMenu,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.MoveToRowStart,
            WebviewAction.ResultGridMoveToRowStart,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.MoveToRowEnd,
            WebviewAction.ResultGridMoveToRowEnd,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SelectColumn,
            WebviewAction.ResultGridSelectColumn,
        ),
        mapKeyBinding(
            keyBindings,
            FluentResultGridCommand.SelectRow,
            WebviewAction.ResultGridSelectRow,
        ),
    ]) as FluentResultGridKeyBindingMap;
}

function getQueryResultFluentGridCommandConfiguration(): FluentResultGridCommandConfiguration {
    const placement = FluentResultGridCommandPlacement;

    return {
        contributions: [
            {
                id: FluentResultGridCommand.SelectAll,
                label: "",
                placements: [placement.CellContextMenu, placement.Keyboard],
                groupId: "selection",
                order: 100,
            },
            {
                id: FluentResultGridCommand.CopySelection,
                label: "",
                placements: [placement.CellContextMenu, placement.Keyboard],
                groupId: "clipboard",
                order: 200,
            },
            {
                id: FluentResultGridCommand.CopyWithHeaders,
                label: "",
                placements: [placement.CellContextMenu, placement.Keyboard],
                groupId: "clipboard",
                order: 210,
            },
            {
                id: FluentResultGridCommand.CopyHeaders,
                label: "",
                placements: [placement.CellContextMenu],
                groupId: "clipboard",
                order: 220,
            },
            {
                id: FluentResultGridCommand.CopyAsCsv,
                label: "",
                placements: [placement.CellContextMenu],
                groupId: "copyAs",
                order: 230,
            },
            {
                id: FluentResultGridCommand.CopyAsJson,
                label: "",
                placements: [placement.CellContextMenu],
                groupId: "copyAs",
                order: 240,
            },
            {
                id: FluentResultGridCommand.CopyAsInClause,
                label: "",
                placements: [placement.CellContextMenu],
                groupId: "copyAs",
                order: 250,
            },
            {
                id: FluentResultGridCommand.CopyAsInsertInto,
                label: "",
                placements: [placement.CellContextMenu],
                groupId: "copyAs",
                order: 260,
            },
            {
                id: FluentResultGridCommand.CopyColumnName,
                label: "",
                placements: [placement.ColumnHeaderMenu],
                groupId: "clipboard",
                order: 700,
            },
            {
                id: FluentResultGridCommand.SaveAsCsv,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 300,
            },
            {
                id: FluentResultGridCommand.SaveAsJson,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 310,
            },
            {
                id: FluentResultGridCommand.SaveAsExcel,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 320,
            },
            {
                id: FluentResultGridCommand.SaveAsInsert,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 330,
            },
            {
                id: FluentResultGridCommand.SwitchToGridView,
                label: "",
                placements: [placement.Toolbar],
                groupId: "view",
                order: 100,
                isVisible: (context) => !!context.canToggleViewMode && context.viewMode === "text",
            },
            {
                id: FluentResultGridCommand.SwitchToTextView,
                label: "",
                placements: [placement.Toolbar],
                groupId: "view",
                order: 100,
                isVisible: (context) => !!context.canToggleViewMode && context.viewMode !== "text",
            },
            {
                id: FluentResultGridCommand.Maximize,
                label: "",
                placements: [placement.Toolbar],
                groupId: "view",
                order: 200,
                isVisible: (context) => !!context.canToggleMaximize && !context.isMaximized,
            },
            {
                id: FluentResultGridCommand.Restore,
                label: "",
                placements: [placement.Toolbar],
                groupId: "view",
                order: 200,
                isVisible: (context) => !!context.canToggleMaximize && !!context.isMaximized,
            },
        ],
    };
}

function getQueryResultFluentGridStrings(): FluentResultGridStrings {
    const command = (label: string) => ({ label, tooltip: label, ariaLabel: label });

    return {
        commands: {
            [FluentResultGridCommand.SelectAll]: command(locConstants.queryResult.selectAll),
            [FluentResultGridCommand.CopySelection]: command(locConstants.queryResult.copy),
            [FluentResultGridCommand.CopyWithHeaders]: command(
                locConstants.queryResult.copyWithHeaders,
            ),
            [FluentResultGridCommand.CopyHeaders]: command(locConstants.queryResult.copyHeaders),
            [FluentResultGridCommand.CopyAsCsv]: command(locConstants.queryResult.copyAsCsv),
            [FluentResultGridCommand.CopyAsJson]: command(locConstants.queryResult.copyAsJson),
            [FluentResultGridCommand.CopyAsInClause]: command(
                locConstants.queryResult.copyAsInClause,
            ),
            [FluentResultGridCommand.CopyAsInsertInto]: command(
                locConstants.queryResult.copyAsInsertInto,
            ),
            [FluentResultGridCommand.CopyColumnName]: command(
                locConstants.queryResult.copyColumnName,
            ),
            [FluentResultGridCommand.SaveAsCsv]: command(locConstants.queryResult.saveAsCSV),
            [FluentResultGridCommand.SaveAsJson]: command(locConstants.queryResult.saveAsJSON),
            [FluentResultGridCommand.SaveAsExcel]: command(
                locConstants.queryResult.saveAsExcelLabel,
            ),
            [FluentResultGridCommand.SaveAsInsert]: command(
                locConstants.queryResult.saveAsInsert(""),
            ),
            [FluentResultGridCommand.SwitchToGridView]: command(
                locConstants.queryResult.toggleToGridView(""),
            ),
            [FluentResultGridCommand.SwitchToTextView]: command(
                locConstants.queryResult.toggleToTextView(""),
            ),
            [FluentResultGridCommand.Maximize]: command(locConstants.queryResult.maximize("")),
            [FluentResultGridCommand.Restore]: command(locConstants.queryResult.restore("")),
            [FluentResultGridCommand.ToggleSort]: command(locConstants.queryResult.sort),
            [FluentResultGridCommand.OpenFilter]: command(locConstants.queryResult.filter),
            [FluentResultGridCommand.OpenResizeDialog]: command(locConstants.queryResult.resize),
            [FluentResultGridCommand.FreezeColumn]: command(locConstants.slickGrid.freezeColumns),
            [FluentResultGridCommand.UnfreezeColumn]: command(
                locConstants.slickGrid.unfreezeColumns,
            ),
            [FluentResultGridCommand.ClearAllFilters]: command(
                locConstants.slickGrid.clearAllFilters,
            ),
            [FluentResultGridCommand.ClearSort]: command(locConstants.queryResult.clearSort),
            [FluentResultGridCommand.ShowAllColumns]: command(
                locConstants.slickGrid.showAllColumns,
            ),
        },
        menus: {
            copyAs: locConstants.queryResult.copyAs,
            moreActions: locConstants.queryResult.moreQueryActions,
            filterOptions: locConstants.queryResult.filterOptions,
        },
        filter: {
            nullValue: locConstants.queryResult.null,
            blankValue: locConstants.queryResult.blankString,
            search: locConstants.queryResult.search,
            apply: locConstants.queryResult.apply,
            clear: locConstants.queryResult.clear,
            close: locConstants.queryResult.close,
            noResultsToDisplay: locConstants.queryResult.noResultsToDisplay,
        },
        resizeDialog: {
            title: locConstants.queryResult.resizeColumn,
            widthLabel: locConstants.queryResult.enterDesiredColumnWidth,
            validationError: (minWidth) => locConstants.queryResult.resizeValidationError(minWidth),
            submit: locConstants.queryResult.resize,
            cancel: locConstants.common.cancel,
        },
        accessibility: {
            selectedCount: locConstants.queryResult.selectedCount,
            gridAriaLabel: locConstants.queryResult.resultSet,
            toolbarAriaLabel: locConstants.queryResult.moreQueryActions,
        },
    };
}

function getSortStateFromFilters(filters?: qr.ColumnFilterMap): FluentResultGridState["sort"] {
    for (const [columnId, filterState] of Object.entries(filters ?? {})) {
        if (filterState.sorted && filterState.sorted !== qr.SortProperties.NONE) {
            return {
                columnId,
                direction: filterState.sorted,
            };
        }
    }

    return undefined;
}

function getGridViewStateSignature(state: FluentResultGridState): string {
    return JSON.stringify({
        hiddenColumnIds: state.hiddenColumnIds ?? [],
        frozenColumnIndex: state.frozenColumnIndex,
        selection: state.selection ?? [],
    });
}

function getResultSetSummaryColumnSignature(summary: qr.ResultSetSummary | undefined): string {
    return (
        summary?.columnInfo
            .map((column) =>
                [
                    column.columnName,
                    column.dataType,
                    column.isXml ? "xml" : "",
                    column.isJson ? "json" : "",
                    column.isVector ? "vector" : "",
                ].join(","),
            )
            .join("|") ?? ""
    );
}

function areResultSetSummariesEquivalent(
    left: qr.ResultSetSummary | undefined,
    right: qr.ResultSetSummary | undefined,
): boolean {
    if (left === right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return (
        left.batchId === right.batchId &&
        left.id === right.id &&
        left.rowCount === right.rowCount &&
        getResultSetSummaryColumnSignature(left) === getResultSetSummaryColumnSignature(right)
    );
}

const QueryResultFluentResultGrid = forwardRef<ResultGridHandle, ResultGridProps>((props, ref) => {
    const context = useContext(QueryResultCommandsContext);
    const uri = useQueryResultSelector((state) => state.uri);
    const fontSettings = useQueryResultSelector((state) => state.fontSettings);
    const gridSettings = useQueryResultSelector((state) => state.gridSettings);
    const autoSizeColumnsMode =
        useQueryResultSelector((state) => state.autoSizeColumnsMode) ??
        qr.ResultsGridAutoSizeStyle.HeadersAndData;
    const inMemoryDataProcessingThreshold =
        useQueryResultSelector((state) => state.inMemoryDataProcessingThreshold) ?? 5000;
    const isGridPerfTelemetryEnabled = useQueryResultSelector(
        (state) => state.isGridPerfTelemetryEnabled === true,
    );
    const resultSetSummary = useQueryResultSelector(
        (state) => state.resultSetSummaries[props.batchId]?.[props.resultId],
        areResultSetSummariesEquivalent,
    );
    const gridPerfResultIdentity = useMemo(
        () =>
            [
                props.gridId,
                resultSetSummary?.batchId,
                resultSetSummary?.id,
                getResultSetSummaryColumnSignature(resultSetSummary),
            ].join("|"),
        [props.gridId, resultSetSummary],
    );
    const [initialState, setInitialState] = useState<FluentResultGridState | undefined>();
    const [isInitialStateLoaded, setIsInitialStateLoaded] = useState(false);
    const isInitialStateLoadedRef = useRef(false);
    const latestDataSourceRowCountRef = useRef(resultSetSummary?.rowCount ?? 0);
    latestDataSourceRowCountRef.current = resultSetSummary?.rowCount ?? 0;
    const columnWidthsSignatureRef = useRef<string | undefined>(undefined);
    const filtersSignatureRef = useRef<string | undefined>(undefined);
    const gridViewStateSignatureRef = useRef<string | undefined>(undefined);
    const scrollPositionSignatureRef = useRef<string | undefined>(undefined);
    const gridPerfContext = useMemo<QueryResultGridPerfContext>(
        () => ({
            enabled: isGridPerfTelemetryEnabled,
            gridKind: "beta",
            gridId: props.gridId,
            batchId: props.batchId,
            resultId: props.resultId,
        }),
        [isGridPerfTelemetryEnabled, props.batchId, props.gridId, props.resultId],
    );
    const gridPerfContextRef = useRef(gridPerfContext);
    gridPerfContextRef.current = gridPerfContext;
    const gridPerfMountStartRef = useRef(getQueryResultGridPerfNow());
    const gridPerfFirstDataPaintRecordedRef = useRef(false);
    const gridPerfPreviousRowCountRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        setQueryResultGridPerfEnabled(isGridPerfTelemetryEnabled);
    }, [isGridPerfTelemetryEnabled]);

    useEffect(() => {
        if (!resultSetSummary) {
            return;
        }

        const mountStart = getQueryResultGridPerfNow();
        gridPerfMountStartRef.current = mountStart;
        gridPerfFirstDataPaintRecordedRef.current = false;
        gridPerfPreviousRowCountRef.current = resultSetSummary.rowCount;

        recordQueryResultGridPerfEvent(gridPerfContext, "mount-start", {
            rowCount: resultSetSummary.rowCount,
            columnCount: resultSetSummary.columnInfo.length,
        });
        scheduleQueryResultGridPerfPaint(gridPerfContext, "mount-first-paint", mountStart, {
            rowCount: resultSetSummary.rowCount,
            columnCount: resultSetSummary.columnInfo.length,
        });

        return () => {
            recordQueryResultGridPerfEvent(gridPerfContext, "unmount");
        };
    }, [gridPerfContext, gridPerfResultIdentity]);

    useEffect(() => {
        if (!resultSetSummary) {
            return;
        }

        const previousRowCount = gridPerfPreviousRowCountRef.current;
        if (previousRowCount !== undefined && previousRowCount !== resultSetSummary.rowCount) {
            const startTime = getQueryResultGridPerfNow();
            const metadata = {
                previousRowCount,
                rowCount: resultSetSummary.rowCount,
            };
            recordQueryResultGridPerfEvent(gridPerfContext, "row-count-change", metadata);
            scheduleQueryResultGridPerfPaint(
                gridPerfContext,
                "row-count-change-paint",
                startTime,
                metadata,
            );
        }

        gridPerfPreviousRowCountRef.current = resultSetSummary.rowCount;
    }, [gridPerfContext, resultSetSummary?.rowCount]);

    useEffect(() => {
        if (!context || !uri) {
            return;
        }

        let disposed = false;
        isInitialStateLoadedRef.current = false;
        setIsInitialStateLoaded(false);
        void (async () => {
            const [filters, columnWidths, gridViewState, scrollPosition] = await Promise.all([
                context.extensionRpc.sendRequest(qr.GetFiltersRequest.type, {
                    uri,
                    gridId: props.gridId,
                }),
                context.extensionRpc.sendRequest(qr.GetColumnWidthsRequest.type, {
                    uri,
                    gridId: props.gridId,
                }),
                context.extensionRpc.sendRequest(qr.GetGridViewStateRequest.type, {
                    uri,
                    gridId: props.gridId,
                }),
                context.extensionRpc.sendRequest(qr.GetGridScrollPositionRequest.type, {
                    uri,
                    gridId: props.gridId,
                }),
            ]);

            if (disposed) {
                return;
            }

            const nextInitialState: FluentResultGridState = {
                ...(gridViewState ?? {}),
                columnWidths,
                filters: filters ?? {},
                sort: getSortStateFromFilters(filters),
                scrollPosition,
            };
            columnWidthsSignatureRef.current = JSON.stringify(columnWidths ?? []);
            filtersSignatureRef.current = JSON.stringify(filters ?? {});
            gridViewStateSignatureRef.current = getGridViewStateSignature(nextInitialState);
            scrollPositionSignatureRef.current = JSON.stringify(scrollPosition ?? {});
            setInitialState(nextInitialState);
            isInitialStateLoadedRef.current = true;
            setIsInitialStateLoaded(true);
        })();

        return () => {
            disposed = true;
        };
    }, [context, props.gridId, uri]);

    const dataSource = useMemo(
        () => ({
            kind: "windowed" as const,
            rowCount: latestDataSourceRowCountRef.current,
            getRows: async (offset: number, count: number) => {
                if (!context || !uri) {
                    return [];
                }

                const rows =
                    (await measureQueryResultGridPerfAsync(
                        gridPerfContextRef.current,
                        "get-rows",
                        {
                            offset,
                            count,
                        },
                        async () => {
                            const response = await context.extensionRpc.sendRequest(
                                qr.GetRowsRequest.type,
                                {
                                    uri,
                                    batchId: props.batchId,
                                    resultId: props.resultId,
                                    rowStart: offset,
                                    numberOfRows: count,
                                },
                            );
                            return response?.rows ?? [];
                        },
                    )) ?? [];

                if (rows.length > 0) {
                    const responseTime = getQueryResultGridPerfNow();
                    scheduleQueryResultGridPerfPaint(
                        gridPerfContextRef.current,
                        "get-rows-response-paint",
                        responseTime,
                        {
                            offset,
                            count,
                            returnedRows: rows.length,
                        },
                    );

                    if (!gridPerfFirstDataPaintRecordedRef.current) {
                        gridPerfFirstDataPaintRecordedRef.current = true;
                        scheduleQueryResultGridPerfPaint(
                            gridPerfContextRef.current,
                            "first-data-paint",
                            gridPerfMountStartRef.current,
                            {
                                offset,
                                count,
                                returnedRows: rows.length,
                            },
                        );
                    }
                }

                return rows;
            },
        }),
        [context, props.batchId, props.resultId, uri],
    );

    const handleStateChange = useCallback(
        (state: FluentResultGridState) => {
            if (!context || !uri || !isInitialStateLoadedRef.current) {
                return;
            }

            const columnWidthsSignature = JSON.stringify(state.columnWidths ?? []);
            if (columnWidthsSignature !== columnWidthsSignatureRef.current) {
                columnWidthsSignatureRef.current = columnWidthsSignature;
                void context.extensionRpc.sendRequest(qr.SetColumnWidthsRequest.type, {
                    uri,
                    gridId: props.gridId,
                    columnWidths: state.columnWidths ?? [],
                });
            }

            const filtersSignature = JSON.stringify(state.filters ?? {});
            if (filtersSignature !== filtersSignatureRef.current) {
                filtersSignatureRef.current = filtersSignature;
                void context.extensionRpc.sendRequest(qr.SetFiltersRequest.type, {
                    uri,
                    gridId: props.gridId,
                    filters: state.filters ?? {},
                });
            }

            const gridViewStateSignature = getGridViewStateSignature(state);
            if (gridViewStateSignature !== gridViewStateSignatureRef.current) {
                gridViewStateSignatureRef.current = gridViewStateSignature;
                void context.extensionRpc.sendRequest(qr.SetGridViewStateRequest.type, {
                    uri,
                    gridId: props.gridId,
                    gridViewState: {
                        hiddenColumnIds: state.hiddenColumnIds,
                        frozenColumnIndex: state.frozenColumnIndex,
                        selection: state.selection,
                    },
                });
            }

            const scrollPositionSignature = JSON.stringify(state.scrollPosition ?? {});
            if (
                state.scrollPosition &&
                scrollPositionSignature !== scrollPositionSignatureRef.current
            ) {
                scrollPositionSignatureRef.current = scrollPositionSignature;
                void context.extensionRpc.sendNotification(
                    qr.SetGridScrollPositionNotification.type,
                    {
                        uri,
                        gridId: props.gridId,
                        scrollLeft: state.scrollPosition.scrollLeft,
                        scrollTop: state.scrollPosition.scrollTop,
                    },
                );
            }
        },
        [context, props.gridId, uri],
    );

    const handleSelectionSummaryChange = useCallback(
        (selection: readonly qr.ISlickRange[]) => {
            if (!context || !uri || !resultSetSummary) {
                return;
            }

            void context.extensionRpc.sendNotification(qr.SetSelectionSummaryRequest.type, {
                selection: [...selection],
                uri,
                batchId: resultSetSummary.batchId,
                resultId: resultSetSummary.id,
            });
        },
        [context, resultSetSummary, uri],
    );

    const handleCommand = useCallback(
        async (event: FluentResultGridCommandEvent) => {
            if (!context || !uri) {
                return;
            }

            const selection = [...(event.selection ?? [])];
            switch (event.commandId) {
                case FluentResultGridCommand.CopySelection:
                    await context.extensionRpc.sendRequest(qr.CopySelectionRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                        includeHeaders: false,
                    });
                    break;
                case FluentResultGridCommand.CopyWithHeaders:
                    await context.extensionRpc.sendRequest(qr.CopySelectionRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                        includeHeaders: true,
                    });
                    break;
                case FluentResultGridCommand.CopyHeaders:
                    await context.extensionRpc.sendRequest(qr.CopyHeadersRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                    });
                    break;
                case FluentResultGridCommand.CopyAsCsv:
                    await context.extensionRpc.sendRequest(qr.CopyAsCsvRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                    });
                    break;
                case FluentResultGridCommand.CopyAsJson:
                    await context.extensionRpc.sendRequest(qr.CopyAsJsonRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                        includeHeaders: true,
                    });
                    break;
                case FluentResultGridCommand.CopyAsInClause:
                    await context.extensionRpc.sendRequest(qr.CopyAsInClauseRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                    });
                    break;
                case FluentResultGridCommand.CopyAsInsertInto:
                    await context.extensionRpc.sendRequest(qr.CopyAsInsertIntoRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                    });
                    break;
                case FluentResultGridCommand.CopyColumnName: {
                    const rawName = event.column?.columnName ?? event.columnId ?? "";
                    await context.extensionRpc.sendRequest(qr.CopyColumnNameRequest.type, {
                        columnName: `[${rawName.replace(/\]/g, "]]")}]`,
                    });
                    break;
                }
                case FluentResultGridCommand.SaveAsCsv:
                case FluentResultGridCommand.SaveAsJson:
                case FluentResultGridCommand.SaveAsExcel:
                case FluentResultGridCommand.SaveAsInsert: {
                    let format = "csv";
                    if (event.commandId === FluentResultGridCommand.SaveAsJson) {
                        format = "json";
                    } else if (event.commandId === FluentResultGridCommand.SaveAsExcel) {
                        format = "excel";
                    } else if (event.commandId === FluentResultGridCommand.SaveAsInsert) {
                        format = "insert";
                    }

                    await context.extensionRpc.sendRequest(qr.SaveResultsWebviewRequest.type, {
                        uri,
                        batchId: event.batchId,
                        resultId: event.resultId,
                        selection,
                        format,
                        origin: qr.QueryResultSaveAsTrigger.Toolbar,
                    });
                    break;
                }
                case FluentResultGridCommand.OpenCell:
                    if (event.cell?.languageId) {
                        context.openFileThroughLink(
                            event.cell.value.displayValue,
                            event.cell.languageId,
                        );
                    }
                    break;
                case FluentResultGridCommand.SwitchToGridView:
                    context.setResultViewMode(qr.QueryResultViewMode.Grid);
                    break;
                case FluentResultGridCommand.SwitchToTextView:
                    context.setResultViewMode(qr.QueryResultViewMode.Text);
                    break;
                case FluentResultGridCommand.Maximize:
                case FluentResultGridCommand.Restore:
                    props.onToggleMaximize?.();
                    break;
                default:
                    break;
            }
        },
        [context, props, uri],
    );

    const handleThresholdExceeded = useCallback(async () => {
        if (!context) {
            return;
        }

        await context.extensionRpc.sendRequest(qr.ShowFilterDisabledMessageRequest.type);
    }, [context]);

    useEffect(() => {
        isInitialStateLoadedRef.current = false;
        setIsInitialStateLoaded(false);
        setInitialState(undefined);
    }, [props.gridId, uri]);

    if (!context || !uri || !resultSetSummary) {
        return null;
    }

    return (
        <FluentResultGrid
            ref={ref}
            gridId={props.gridId}
            resultSetSummary={resultSetSummary}
            dataSource={dataSource}
            heightMode={{ kind: "fill" }}
            showRowNumberColumn
            autoSizeColumnsMode={autoSizeColumnsMode}
            inMemoryDataProcessingThreshold={inMemoryDataProcessingThreshold}
            gridSettings={gridSettings}
            rowHeight={getRowHeight(
                fontSettings?.fontSize,
                normalizeRowPadding(gridSettings?.rowPadding),
            )}
            toolbar={{ visible: true }}
            viewMode={props.viewMode === qr.QueryResultViewMode.Text ? "text" : "grid"}
            canToggleViewMode
            canToggleMaximize={props.canToggleMaximize}
            isMaximized={props.isMaximized}
            initialState={initialState}
            initialStateReady={isInitialStateLoaded}
            onCommand={handleCommand}
            onStateChange={handleStateChange}
            onSelectionSummaryChange={handleSelectionSummaryChange}
            onInMemoryDataProcessingThresholdExceeded={handleThresholdExceeded}
        />
    );
});

QueryResultFluentResultGrid.displayName = "QueryResultFluentResultGrid";

export function QueryResultFluentResultGridView() {
    const { keyBindings, themeKind } = useVscodeWebview<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();
    const providerKeyBindings = useMemo(
        () => getFluentResultGridKeyBindings(keyBindings),
        [keyBindings],
    );
    const strings = useMemo(() => getQueryResultFluentGridStrings(), []);
    const defaultCommands = useMemo(() => getQueryResultFluentGridCommandConfiguration(), []);
    const theme = useMemo<FluentResultGridTheme>(
        () => ({
            kind: toFluentThemeKind(themeKind),
        }),
        [themeKind],
    );

    return (
        <FluentResultGridProvider
            strings={strings}
            keyBindings={providerKeyBindings}
            theme={theme}
            overlayRootProps={vscodeOverlayRootProps}
            defaultCommands={defaultCommands}>
            <QueryResultsGridView
                GridComponent={QueryResultFluentResultGrid}
                showExternalCommandBar={false}
            />
        </FluentResultGridProvider>
    );
}
