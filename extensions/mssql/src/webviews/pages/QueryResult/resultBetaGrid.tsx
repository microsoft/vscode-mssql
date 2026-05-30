/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type CSSProperties,
    type FocusEvent as ReactFocusEvent,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import debounce from "lodash/debounce";
import { Column, GridOption, SlickgridReactInstance } from "slickgrid-react";
import {
    Formatter,
    type GridMenuCallbackArgs,
    type GridMenuCommandItemCallbackArgs,
    SlickEventData,
    SlickEventHandler,
    SlickGrid,
    SlickRange,
} from "@slickgrid-universal/common";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    FluentSlickGrid,
} from "../../common/FluentSlickGrid/FluentSlickGrid";
import { ColorThemeKind, WebviewAction } from "../../../sharedInterfaces/webview";
import {
    CopyAsCsvRequest,
    CopyAsInClauseRequest,
    CopyAsInsertIntoRequest,
    CopyAsJsonRequest,
    CopyHeadersRequest,
    CopyColumnNameRequest,
    GetColumnWidthsRequest,
    GetFiltersRequest,
    GetGridScrollPositionRequest,
    CopySelectionRequest,
    GetRowsRequest,
    GridContextMenuAction,
    ISlickRange,
    QueryResultSaveAsTrigger,
    ResultSetSummary,
    ResultsGridAutoSizeStyle,
    SaveResultsWebviewRequest,
    SetFiltersRequest,
    SetColumnWidthsRequest,
    SetGridScrollPositionNotification,
    SetSelectionSummaryRequest,
    ShowFilterDisabledMessageRequest,
    SortProperties,
    ColumnFilterMap,
} from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { KeyCode } from "../../common/keys";
import { eventMatchesShortcut } from "../../common/keyboardUtils";
import { isMetaOrCtrlKeyPressed } from "../../common/utils";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import { ResultGridHandle, ResultGridProps } from "./resultGrid";
import { isJson } from "../../common/jsonUtils";
import { isXmlCell } from "../../common/xmlUtils";
import { VirtualizedCollection } from "./table/asyncDataView";
import { convertDisplayedSelectionRowsToActual } from "./table/utils";
import { HeaderContextMenuAction } from "./table/plugins/HeaderContextMenu";
import {
    ColumnMenuPopupAnchorRect,
    FilterListItem,
    FilterValue,
} from "./table/plugins/ColumnMenuPopup";
import { getQueryResultColumnFormatter, getQueryResultColumnName } from "./queryResultGridColumns";
import {
    createQueryResultGridRow,
    createQueryResultPlaceholderRow,
    QUERY_RESULT_ROW_NUMBER_FIELD,
    QueryResultGridRow,
} from "./queryResultRows";
import { QueryResultWindowedDataView } from "./queryResultWindowedDataView";
import "../../media/table.css";
import "./resultBetaGrid.css";

const WINDOW_SIZE = 50;
const DEFAULT_FONT_SIZE = 12;
const BASE_ROW_PADDING = 12;
const DEFAULT_COLUMN_WIDTH = 120;
const ROW_NUMBER_COLUMN_WIDTH = 36;
const MIN_COLUMN_WIDTH = 50;
const MAX_COLUMN_WIDTH = 400;
const AUTO_SIZE_SAMPLE_ROWS = 50;
const AUTO_SIZE_HEADER_PADDING_WIDTH = 20;
const HEADER_ACTION_BUTTON_WIDTH = 16;
const HEADER_SORT_BUTTON_MARGIN_WIDTH = 3;
const AUTO_SIZE_HEADER_EXTRA_WIDTH =
    AUTO_SIZE_HEADER_PADDING_WIDTH +
    HEADER_ACTION_BUTTON_WIDTH * 2 +
    HEADER_SORT_BUTTON_MARGIN_WIDTH;
const AUTO_SIZE_CELL_PADDING_WIDTH = 20;
const SCROLL_POSITION_NOTIFICATION_DEBOUNCE_DELAY_MS = 100;
const ROW_NUMBER_COLUMN_ID = "_mssqlRowNumberColumn";
const DEFAULT_IN_MEMORY_DATA_PROCESSING_THRESHOLD = 5000;
const GRID_MENU_CLEAR_ALL_FILTERS_COMMAND = "mssql-clear-all-filters";
const GRID_MENU_CLEAR_SORT_COMMAND = "mssql-clear-sort";
const GRID_MENU_SHOW_ALL_COLUMNS_COMMAND = "mssql-show-all-columns";
const XML_LANGUAGE_ID = "xml";
const JSON_LANGUAGE_ID = "json";
const FIRST_DATA_CELL_INDEX = 1;
const EMPTY_DATASET: QueryResultGridRow[] = [];
const HEADER_CONTEXT_MENU_ACTIONS: HeaderContextMenuAction[] = [
    HeaderContextMenuAction.ToggleSort,
    HeaderContextMenuAction.Filter,
    HeaderContextMenuAction.Resize,
    HeaderContextMenuAction.CopyColumnName,
    HeaderContextMenuAction.FreezeColumn,
    HeaderContextMenuAction.UnfreezeColumn,
];

type BetaSortState = {
    columnId: string;
    direction: SortProperties;
};

type MutableGridMenuCommandItem = {
    command?: string;
    disabled?: boolean;
    commandItems?: Array<MutableGridMenuCommandItem | "divider">;
};

function isGridMenuDataColumn(column: Column<QueryResultGridRow>): boolean {
    return column.id !== ROW_NUMBER_COLUMN_ID && !column.excludeFromGridMenu;
}

function areAllGridMenuColumnsShown(columns: Column<QueryResultGridRow>[]): boolean {
    const gridMenuColumns = columns.filter(isGridMenuDataColumn);
    return gridMenuColumns.length === 0 || gridMenuColumns.every((column) => !column.hidden);
}

function findGridMenuCommandItem(
    commandItems: Array<MutableGridMenuCommandItem | "divider"> | undefined,
    command: string,
): MutableGridMenuCommandItem | undefined {
    if (!commandItems) {
        return undefined;
    }

    for (const item of commandItems) {
        if (item === "divider") {
            continue;
        }

        if (item.command === command) {
            return item;
        }

        const childItem = findGridMenuCommandItem(item.commandItems, command);
        if (childItem) {
            return childItem;
        }
    }

    return undefined;
}

function getOpenGridMenuElement(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(".slick-grid-menu");
}

function setGridMenuCommandDisabled(grid: SlickGrid, command: string, disabled: boolean): void {
    const commandItems = grid.getOptions().gridMenu?.commandItems as
        | Array<MutableGridMenuCommandItem | "divider">
        | undefined;
    const commandItem = findGridMenuCommandItem(commandItems, command);
    if (commandItem) {
        commandItem.disabled = disabled;
    }
}

function updateGridMenuCommandElementDisabled(
    menuElement: HTMLElement | null,
    command: string,
    disabled: boolean,
): void {
    const commandElement = menuElement?.querySelector<HTMLElement>(`[data-command="${command}"]`);
    if (!commandElement) {
        return;
    }

    commandElement.classList.toggle("slick-menu-item-disabled", disabled);
    if (disabled) {
        commandElement.setAttribute("aria-disabled", "true");
    } else {
        commandElement.removeAttribute("aria-disabled");
    }
}

function syncShowAllColumnsMenuCommandState(
    grid: SlickGrid,
    allColumns: Column<QueryResultGridRow>[],
    menuElement: HTMLElement | null = getOpenGridMenuElement(),
): void {
    const commandDisabled = areAllGridMenuColumnsShown(
        allColumns.length > 0 ? allColumns : (grid.getColumns() as Column<QueryResultGridRow>[]),
    );
    setGridMenuCommandDisabled(grid, GRID_MENU_SHOW_ALL_COLUMNS_COMMAND, commandDisabled);
    updateGridMenuCommandElementDisabled(
        menuElement,
        GRID_MENU_SHOW_ALL_COLUMNS_COMMAND,
        commandDisabled,
    );
}

function normalizeRowPadding(rowPadding: number | null | undefined): number {
    return typeof rowPadding === "number" && Number.isFinite(rowPadding)
        ? Math.max(0, rowPadding)
        : 0;
}

function getRowHeight(fontSize: number | undefined, rowPadding: number): number {
    return (fontSize ?? DEFAULT_FONT_SIZE) + BASE_ROW_PADDING + rowPadding * 2;
}

function getAutoSizeCellText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "object" && value !== null && "displayValue" in value) {
        const cellValue = value as { displayValue?: string; isNull?: boolean };
        return cellValue.isNull ? "NULL" : (cellValue.displayValue ?? "");
    }

    return "";
}

function getCellFilterValue(row: QueryResultGridRow, field: string): FilterValue {
    const value = row[field];
    if (typeof value !== "object" || value === null || value.isNull) {
        return undefined;
    }

    const displayValue = value.displayValue ?? "";
    return displayValue.trim() === "" ? "" : displayValue;
}

function getFilterDisplayText(value: FilterValue): string {
    if (value === undefined) {
        return locConstants.queryResult.null;
    }

    if (value === "") {
        return locConstants.queryResult.blankString;
    }

    return value;
}

function normalizeStoredFilterValue(value: unknown): FilterValue {
    return value === null || value === undefined ? undefined : String(value);
}

function getCellSortValue(row: QueryResultGridRow, field: string): FilterValue {
    return getCellFilterValue(row, field);
}

function compareCellValues(a: FilterValue, b: FilterValue): number {
    const numA = Number(a);
    const numB = Number(b);
    const isANumber = a !== undefined && a !== "" && !Number.isNaN(numA);
    const isBNumber = b !== undefined && b !== "" && !Number.isNaN(numB);

    if (a === undefined || b === undefined) {
        return a === b ? 0 : a === undefined ? -1 : 1;
    }

    if (isANumber || isBNumber) {
        if (isANumber && isBNumber) {
            return numA === numB ? 0 : numA > numB ? 1 : -1;
        }

        return isANumber ? -1 : 1;
    }

    return a.localeCompare(b);
}

function toAnchorRect(rect: DOMRect): ColumnMenuPopupAnchorRect {
    return {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
    };
}

function toSelectionRange(range: SlickRange): ISlickRange {
    return {
        fromCell: Math.min(range.fromCell, range.toCell),
        fromRow: Math.min(range.fromRow, range.toRow),
        toCell: Math.max(range.fromCell, range.toCell),
        toRow: Math.max(range.fromRow, range.toRow),
    };
}

function toActualDataSelection(range: ISlickRange): ISlickRange | undefined {
    const fromCell = Math.max(FIRST_DATA_CELL_INDEX, range.fromCell) - FIRST_DATA_CELL_INDEX;
    const toCell = Math.max(FIRST_DATA_CELL_INDEX, range.toCell) - FIRST_DATA_CELL_INDEX;
    if (toCell < fromCell || range.toRow < range.fromRow) {
        return undefined;
    }

    return {
        fromCell,
        fromRow: range.fromRow,
        toCell,
        toRow: range.toRow,
    };
}

function getDataSelectionsFromRanges(selectedRanges: SlickRange[]): ISlickRange[] {
    const dataSelections = selectedRanges
        .map(toSelectionRange)
        .map(toActualDataSelection)
        .filter((selection): selection is ISlickRange => selection !== undefined);

    return dataSelections;
}

function getDisplayedSelectionForCopy(grid: SlickGrid, rowCount: number): ISlickRange[] {
    const selectionModel = grid.getSelectionModel();
    const selectedRanges = selectionModel?.getSelectedRanges() ?? [];
    const dataSelections = getDataSelectionsFromRanges(selectedRanges);

    if (dataSelections.length > 0) {
        return dataSelections;
    }

    return [
        {
            fromCell: 0,
            fromRow: 0,
            toCell: grid.getColumns().length - 2,
            toRow: Math.max(0, rowCount - 1),
        },
    ];
}

const ResultBetaGrid = forwardRef<ResultGridHandle, ResultGridProps>(
    (props: ResultGridProps, ref) => {
        const reactGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
        const dataViewRef = useRef<QueryResultWindowedDataView<QueryResultGridRow> | undefined>(
            undefined,
        );
        const frozenPaneWheelCleanupRef = useRef<(() => void) | undefined>(undefined);
        const selectionEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
        const gridStateEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
        const keyboardEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
        const handleKeyDownRef = useRef<
            ((eventData: SlickEventData, args: { grid: SlickGrid }) => void) | undefined
        >(undefined);
        const latestResultSetSummaryRef = useRef<ResultSetSummary | undefined>(undefined);
        const latestRowCountRef = useRef(0);
        const lastAutoSizeSignatureRef = useRef<string | undefined>(undefined);
        const restoredColumnWidthsSignatureRef = useRef<string | undefined>(undefined);
        const allRowsCacheRef = useRef<QueryResultGridRow[] | undefined>(undefined);
        const transformedRowsRef = useRef<QueryResultGridRow[] | undefined>(undefined);
        const filterStateRef = useRef<ColumnFilterMap>({});
        const sortStateRef = useRef<BetaSortState | undefined>(undefined);
        const activeFilterColumnRef = useRef<string | undefined>(undefined);
        const isColumnWidthStateRestoredRef = useRef(false);
        const isScrollStateRestoredRef = useRef(false);
        const [frozenColumnIndex, setFrozenColumnIndex] = useState(0);
        const [isGridFocused, setIsGridFocused] = useState(false);
        const [displayedRowCount, setDisplayedRowCount] = useState(0);

        const context = useContext(QueryResultCommandsContext);
        if (!context) {
            return undefined;
        }

        const { themeKind, keyBindings } = useVscodeWebview();

        const uri = useQueryResultSelector((state) => state.uri);
        if (!uri) {
            return undefined;
        }

        const fontSettings = useQueryResultSelector((state) => state.fontSettings);
        const gridSettings = useQueryResultSelector((state) => state.gridSettings);
        const inMemoryDataProcessingThreshold =
            useQueryResultSelector<number | undefined>(
                (state) => state.inMemoryDataProcessingThreshold,
            ) ?? DEFAULT_IN_MEMORY_DATA_PROCESSING_THRESHOLD;
        const rowPadding = normalizeRowPadding(gridSettings?.rowPadding);
        const rowHeight = getRowHeight(fontSettings?.fontSize, rowPadding);
        const autoSizeColumnsMode =
            useQueryResultSelector((state) => state.autoSizeColumnsMode) ??
            ResultsGridAutoSizeStyle.HeadersAndData;
        const resultSetSummary = useQueryResultSelector(
            (state) => state.resultSetSummaries[props.batchId]?.[props.resultId],
            (a, b) => a?.rowCount === b?.rowCount,
        );

        const columnInfo = resultSetSummary?.columnInfo;
        const columnCount = columnInfo?.length ?? 0;
        const rowCount = resultSetSummary?.rowCount ?? 0;
        const hasRows = rowCount > 0;
        latestResultSetSummaryRef.current = resultSetSummary;
        latestRowCountRef.current = rowCount;
        const columnSignature =
            columnInfo
                ?.map((column) =>
                    [
                        column.columnName,
                        column.dataType,
                        column.isXml ? "xml" : "",
                        column.isJson ? "json" : "",
                        column.isVector ? "vector" : "",
                    ].join(","),
                )
                .join("|") ?? "";

        const fetchRowsFromServer = useCallback(
            async (offset: number, count: number): Promise<QueryResultGridRow[]> => {
                const response = await context.extensionRpc.sendRequest(GetRowsRequest.type, {
                    uri,
                    batchId: props.batchId,
                    resultId: props.resultId,
                    rowStart: offset,
                    numberOfRows: count,
                });

                if (!response) {
                    return [];
                }

                return response.rows.map((row, rowOffset) =>
                    createQueryResultGridRow(row, offset + rowOffset, columnCount),
                );
            },
            [columnCount, context.extensionRpc, props.batchId, props.resultId, uri],
        );

        const fetchRows = useCallback(
            async (offset: number, count: number): Promise<QueryResultGridRow[]> => {
                const transformedRows = transformedRowsRef.current;
                if (transformedRows) {
                    return transformedRows.slice(offset, offset + count);
                }

                return fetchRowsFromServer(offset, count);
            },
            [fetchRowsFromServer],
        );

        const dataView = useMemo(() => {
            const collection = new VirtualizedCollection<QueryResultGridRow>(
                WINDOW_SIZE,
                (index) => createQueryResultPlaceholderRow(index, columnCount),
                0,
                fetchRows,
            );
            return new QueryResultWindowedDataView<QueryResultGridRow>(collection);
        }, [columnCount, fetchRows]);

        dataViewRef.current = dataView;

        useEffect(() => {
            return () => {
                selectionEventHandlerRef.current?.unsubscribeAll();
                selectionEventHandlerRef.current = undefined;
                frozenPaneWheelCleanupRef.current?.();
                frozenPaneWheelCleanupRef.current = undefined;
                gridStateEventHandlerRef.current?.unsubscribeAll();
                gridStateEventHandlerRef.current = undefined;
                keyboardEventHandlerRef.current?.unsubscribeAll();
                keyboardEventHandlerRef.current = undefined;
                dataView.dispose();
                if (dataViewRef.current === dataView) {
                    dataViewRef.current = undefined;
                }
            };
        }, [dataView]);

        useEffect(() => {
            dataView.setLength(rowCount);
            setDisplayedRowCount(rowCount);
        }, [dataView, rowCount]);

        useEffect(() => {
            allRowsCacheRef.current = undefined;
            transformedRowsRef.current = undefined;
            filterStateRef.current = {};
            sortStateRef.current = undefined;
            activeFilterColumnRef.current = undefined;
        }, [columnSignature, props.batchId, props.resultId, uri]);

        const columns = useMemo<Column<QueryResultGridRow>[]>(() => {
            const rowNumberColumn: Column<QueryResultGridRow> = {
                id: ROW_NUMBER_COLUMN_ID,
                name: "",
                field: QUERY_RESULT_ROW_NUMBER_FIELD,
                width: ROW_NUMBER_COLUMN_WIDTH,
                minWidth: ROW_NUMBER_COLUMN_WIDTH,
                maxWidth: ROW_NUMBER_COLUMN_WIDTH,
                cssClass: "query-result-beta-row-number-cell",
                headerCssClass: "query-result-beta-row-number-header",
                reorderable: false,
                resizable: false,
                selectable: false,
                sortable: false,
                excludeFromColumnPicker: true,
                excludeFromGridMenu: true,
                excludeFromHeaderMenu: true,
                formatter: ((_row, _cell, value) =>
                    `<span class="row-number query-result-beta-row-number">${value ?? ""}</span>`) as Formatter<QueryResultGridRow>,
            };

            return [
                rowNumberColumn,
                ...(columnInfo?.map((column, index) => ({
                    id: index.toString(),
                    name: getQueryResultColumnName(column),
                    toolTip: column.columnName,
                    field: index.toString(),
                    width: DEFAULT_COLUMN_WIDTH,
                    minWidth: 50,
                    reorderable: true,
                    sortable: false,
                    filterable: true,
                    formatter: getQueryResultColumnFormatter(
                        column,
                    ) as Formatter<QueryResultGridRow>,
                })) ?? []),
            ];
        }, [columnSignature]);

        const refreshFrozenColumnLayout = useCallback((grid: SlickGrid) => {
            grid.resizeCanvas();
            grid.invalidateAllRows();
            grid.updateRowCount();
            grid.render();
            dataViewRef.current?.ensureViewportLoaded();
        }, []);

        const syncFrozenColumnState = useCallback((grid: SlickGrid, columnIndex: number) => {
            const reactGrid = reactGridRef.current as
                | (SlickgridReactInstance & {
                      sharedService?: {
                          gridOptions?: GridOption;
                          frozenVisibleColumnId?: string | number | null;
                      };
                  })
                | undefined;

            if (reactGrid?.sharedService?.gridOptions) {
                reactGrid.sharedService.gridOptions.frozenColumn = columnIndex;
                reactGrid.sharedService.gridOptions.enableMouseWheelScrollHandler = true;
                reactGrid.sharedService.gridOptions.alwaysShowVerticalScroll = false;
                reactGrid.sharedService.gridOptions.skipFreezeColumnValidation = true;
            }

            const gridWithFrozenColumnId = grid as SlickGrid & {
                getFrozenColumnId?: () => string | number | null;
            };
            if (reactGrid?.sharedService) {
                reactGrid.sharedService.frozenVisibleColumnId =
                    gridWithFrozenColumnId.getFrozenColumnId?.() ?? null;
            }
        }, []);

        const applyFrozenColumnIndex = useCallback(
            (grid: SlickGrid, columnIndex: number) => {
                grid.setOptions({
                    alwaysShowVerticalScroll: false,
                    enableMouseWheelScrollHandler: true,
                    frozenColumn: columnIndex,
                    skipFreezeColumnValidation: true,
                });
                syncFrozenColumnState(grid, columnIndex);
                refreshFrozenColumnLayout(grid);
            },
            [refreshFrozenColumnLayout, syncFrozenColumnState],
        );

        const removeGridMenuFromTabOrder = useCallback((grid: SlickGrid) => {
            grid.getContainerNode()
                .querySelectorAll<HTMLElement>(".slick-grid-menu-button")
                .forEach((button) => {
                    button.tabIndex = -1;
                });
        }, []);

        const attachFrozenPaneWheelHandler = useCallback((grid: SlickGrid) => {
            frozenPaneWheelCleanupRef.current?.();

            const containerNode = grid.getContainerNode();
            const handleFrozenPaneWheel = (event: WheelEvent) => {
                if ((grid.getOptions().frozenColumn ?? -1) < 0 || event.deltaY === 0) {
                    return;
                }

                const target = event.target as Element | null;
                if (!target?.closest(".slick-viewport-left")) {
                    return;
                }

                const scrollViewport = containerNode.querySelector<HTMLElement>(
                    ".slick-viewport-top.slick-viewport-right",
                );
                if (!scrollViewport) {
                    return;
                }

                scrollViewport.scrollTop = scrollViewport.scrollTop + event.deltaY;
                dataViewRef.current?.ensureViewportLoaded();
                requestAnimationFrame(() => {
                    dataViewRef.current?.ensureViewportLoaded();
                    grid.render();
                });
                event.preventDefault();
                event.stopPropagation();
            };

            containerNode.addEventListener("wheel", handleFrozenPaneWheel, {
                capture: true,
                passive: false,
            });
            frozenPaneWheelCleanupRef.current = () => {
                containerNode.removeEventListener("wheel", handleFrozenPaneWheel, {
                    capture: true,
                });
            };
        }, []);

        useEffect(() => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid || grid.getOptions().frozenColumn === frozenColumnIndex) {
                return;
            }

            applyFrozenColumnIndex(grid, frozenColumnIndex);
        }, [applyFrozenColumnIndex, frozenColumnIndex]);

        useEffect(() => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid) {
                return;
            }

            const topRow = Math.min(
                grid.getViewport().top,
                Math.max(0, latestRowCountRef.current - 1),
            );
            grid.setOptions({ rowHeight });
            grid.resizeCanvas();
            grid.invalidateAllRows();
            grid.updateRowCount();
            if (latestRowCountRef.current > 0) {
                grid.scrollRowToTop(topRow);
            }
            grid.render();
            dataView.ensureViewportLoaded();
        }, [dataView, rowHeight]);

        const applyAutoSizeColumns = useCallback(async () => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid || autoSizeColumnsMode === ResultsGridAutoSizeStyle.Off) {
                return;
            }

            const includeHeaders =
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeadersAndData ||
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeaderOnly;
            const includeData =
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeadersAndData ||
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.DataOnly;

            if (!includeHeaders && !includeData) {
                return;
            }

            const currentRowCount = latestRowCountRef.current;
            const sampleRows =
                includeData && currentRowCount > 0
                    ? await fetchRows(0, Math.min(AUTO_SIZE_SAMPLE_ROWS, currentRowCount))
                    : [];
            const canvasContext = document.createElement("canvas").getContext("2d");
            if (!canvasContext) {
                return;
            }

            const fontSize = fontSettings?.fontSize ?? DEFAULT_FONT_SIZE;
            const fontFamily = fontSettings?.fontFamily ?? "monospace";
            canvasContext.font = `${fontSize}px ${fontFamily}`;

            const resizedColumns = grid.getColumns().map((column, columnIndex) => {
                if (columnIndex === 0) {
                    return column;
                }

                const headerWidth = includeHeaders
                    ? canvasContext.measureText(String(column.name ?? "")).width +
                      AUTO_SIZE_HEADER_EXTRA_WIDTH
                    : 0;
                const dataWidth = includeData
                    ? sampleRows.reduce((maxWidth, row) => {
                          const field = column.field;
                          const value = field ? row[field] : undefined;
                          const text = getAutoSizeCellText(value);
                          return Math.max(
                              maxWidth,
                              canvasContext.measureText(text).width + AUTO_SIZE_CELL_PADDING_WIDTH,
                          );
                      }, 0)
                    : 0;

                return {
                    ...column,
                    width: Math.max(
                        MIN_COLUMN_WIDTH,
                        Math.min(MAX_COLUMN_WIDTH, Math.ceil(Math.max(headerWidth, dataWidth)) + 1),
                    ),
                };
            });

            grid.setColumns(resizedColumns);
            grid.invalidate();
            grid.render();
        }, [autoSizeColumnsMode, fetchRows, fontSettings?.fontFamily, fontSettings?.fontSize]);

        const ensureAllRowsLoaded = useCallback(async (): Promise<
            QueryResultGridRow[] | undefined
        > => {
            const currentRowCount = latestRowCountRef.current;
            if (currentRowCount > inMemoryDataProcessingThreshold) {
                await context.extensionRpc.sendRequest(ShowFilterDisabledMessageRequest.type);
                return undefined;
            }

            const cachedRows = allRowsCacheRef.current;
            if (cachedRows && cachedRows.length === currentRowCount) {
                return cachedRows;
            }

            const rows = currentRowCount > 0 ? await fetchRowsFromServer(0, currentRowCount) : [];
            allRowsCacheRef.current = rows;
            return rows;
        }, [context.extensionRpc, fetchRowsFromServer, inMemoryDataProcessingThreshold]);

        const hasActiveFilters = useCallback(
            () =>
                Object.values(filterStateRef.current).some(
                    (filterState) => (filterState.filterValues?.length ?? 0) > 0,
                ),
            [],
        );

        const hasActiveSort = useCallback(
            () =>
                sortStateRef.current !== undefined &&
                sortStateRef.current.direction !== SortProperties.NONE,
            [],
        );

        const hasActiveTransforms = useCallback(() => {
            const hasFilters = Object.values(filterStateRef.current).some(
                (filterState) => (filterState.filterValues?.length ?? 0) > 0,
            );
            const hasSort =
                sortStateRef.current !== undefined &&
                sortStateRef.current.direction !== SortProperties.NONE;
            return hasFilters || hasSort;
        }, []);

        const applyGridTransforms = useCallback(
            async (
                grid: SlickGrid,
                options?: { preserveScrollPosition?: boolean },
            ): Promise<boolean> => {
                const preservedTopRow = options?.preserveScrollPosition
                    ? grid.getViewport().top
                    : 0;

                if (!hasActiveTransforms()) {
                    transformedRowsRef.current = undefined;
                    dataView.setLength(latestRowCountRef.current);
                    setDisplayedRowCount(latestRowCountRef.current);
                    const targetRow = Math.min(
                        preservedTopRow,
                        Math.max(0, latestRowCountRef.current - 1),
                    );
                    dataView.refresh(targetRow);
                    grid.invalidateAllRows();
                    grid.updateRowCount();
                    if (options?.preserveScrollPosition && latestRowCountRef.current > 0) {
                        grid.scrollRowToTop(targetRow);
                    }
                    grid.render();
                    dataView.ensureViewportLoaded();
                    return true;
                }

                const allRows = await ensureAllRowsLoaded();
                if (!allRows) {
                    return false;
                }

                let rows = [...allRows];
                for (const [columnId, filterState] of Object.entries(filterStateRef.current)) {
                    const filterValues = filterState.filterValues?.map(normalizeStoredFilterValue);
                    if (!filterValues?.length) {
                        continue;
                    }

                    const selectedValues = new Set<FilterValue>(filterValues);
                    rows = rows.filter((row) =>
                        selectedValues.has(getCellFilterValue(row, columnId)),
                    );
                }

                const sortState = sortStateRef.current;
                if (sortState && sortState.direction !== SortProperties.NONE) {
                    const sortMultiplier = sortState.direction === SortProperties.ASC ? 1 : -1;
                    rows.sort(
                        (a, b) =>
                            compareCellValues(
                                getCellSortValue(a, sortState.columnId),
                                getCellSortValue(b, sortState.columnId),
                            ) * sortMultiplier,
                    );
                }

                transformedRowsRef.current = rows;
                dataView.setLength(rows.length);
                setDisplayedRowCount(rows.length);
                const targetRow = Math.min(preservedTopRow, Math.max(0, rows.length - 1));
                dataView.refresh(targetRow);
                grid.invalidateAllRows();
                grid.updateRowCount();
                if (options?.preserveScrollPosition && rows.length > 0) {
                    grid.scrollRowToTop(targetRow);
                } else {
                    grid.scrollTo(0);
                }
                grid.render();
                dataView.ensureViewportLoaded();
                return true;
            },
            [dataView, ensureAllRowsLoaded, hasActiveTransforms],
        );

        const convertDisplayedSelectionForCopy = useCallback((selection: ISlickRange[]) => {
            const transformedRows = transformedRowsRef.current;
            if (!transformedRows) {
                return selection;
            }

            return convertDisplayedSelectionRowsToActual(
                selection,
                (displayRow) => transformedRows[displayRow]?.id,
            );
        }, []);

        const getActualSelectionForCopy = useCallback(
            (grid: SlickGrid) =>
                convertDisplayedSelectionForCopy(
                    getDisplayedSelectionForCopy(grid, grid.getDataLength()),
                ),
            [convertDisplayedSelectionForCopy],
        );

        const autoSizeSignature = useMemo(
            () =>
                [
                    autoSizeColumnsMode,
                    fontSettings?.fontFamily ?? "",
                    fontSettings?.fontSize ?? DEFAULT_FONT_SIZE,
                    columnSignature,
                    hasRows ? "hasRows" : "noRows",
                ].join(":"),
            [
                autoSizeColumnsMode,
                columnSignature,
                fontSettings?.fontFamily,
                fontSettings?.fontSize,
                hasRows,
            ],
        );

        useEffect(() => {
            if (lastAutoSizeSignatureRef.current === autoSizeSignature) {
                return;
            }

            if (restoredColumnWidthsSignatureRef.current === columnSignature) {
                lastAutoSizeSignatureRef.current = autoSizeSignature;
                return;
            }

            lastAutoSizeSignatureRef.current = autoSizeSignature;
            void applyAutoSizeColumns();
        }, [applyAutoSizeColumns, autoSizeSignature, columnSignature, columns]);

        const restoreColumnWidths = useCallback(
            async (grid: SlickGrid) => {
                isColumnWidthStateRestoredRef.current = false;

                const columnWidths = await context.extensionRpc.sendRequest(
                    GetColumnWidthsRequest.type,
                    {
                        uri,
                        gridId: props.gridId,
                    },
                );

                isColumnWidthStateRestoredRef.current = true;

                if (!columnWidths?.length) {
                    return;
                }

                const restoredColumns = grid.getColumns().map((column) => {
                    if (column.id === ROW_NUMBER_COLUMN_ID) {
                        return column;
                    }

                    const width = columnWidths[Number(column.field)];
                    return typeof width === "number" ? { ...column, width } : column;
                });

                restoredColumnWidthsSignatureRef.current = columnSignature;
                lastAutoSizeSignatureRef.current = autoSizeSignature;
                grid.setColumns(restoredColumns);
                grid.invalidate();
                grid.render();
            },
            [autoSizeSignature, columnSignature, context.extensionRpc, props.gridId, uri],
        );

        const restoreScrollPosition = useCallback(
            async (grid: SlickGrid) => {
                isScrollStateRestoredRef.current = false;

                const scrollPosition = await context.extensionRpc.sendRequest(
                    GetGridScrollPositionRequest.type,
                    {
                        uri,
                        gridId: props.gridId,
                    },
                );

                requestAnimationFrame(() => {
                    if (scrollPosition) {
                        grid.scrollRowToTop(scrollPosition.scrollTop);
                        const containerNode = grid.getContainerNode();
                        const viewport = containerNode
                            ? (containerNode.querySelector(".slick-viewport") as HTMLElement)
                            : undefined;
                        if (viewport) {
                            viewport.scrollLeft = scrollPosition.scrollLeft;
                        }
                    }

                    isScrollStateRestoredRef.current = true;
                });
            },
            [context.extensionRpc, props.gridId, uri],
        );

        const persistScrollPosition = useMemo(
            () =>
                debounce((grid: SlickGrid) => {
                    if (!isScrollStateRestoredRef.current) {
                        return;
                    }

                    const viewport = grid.getViewport();
                    void context.extensionRpc.sendNotification(
                        SetGridScrollPositionNotification.type,
                        {
                            uri,
                            gridId: props.gridId,
                            scrollLeft: viewport.leftPx,
                            scrollTop: viewport.top,
                        },
                    );
                }, SCROLL_POSITION_NOTIFICATION_DEBOUNCE_DELAY_MS),
            [context.extensionRpc, props.gridId, uri],
        );

        useEffect(() => {
            return () => {
                persistScrollPosition.cancel();
            };
        }, [persistScrollPosition]);

        const persistColumnWidths = useCallback(
            async (grid: SlickGrid) => {
                if (!isColumnWidthStateRestoredRef.current) {
                    return;
                }

                const columnWidths = new Array<number>(columnCount);
                grid.getColumns().forEach((column) => {
                    if (column.id === ROW_NUMBER_COLUMN_ID) {
                        return;
                    }

                    const columnIndex = Number(column.field);
                    if (Number.isInteger(columnIndex)) {
                        columnWidths[columnIndex] = column.width ?? DEFAULT_COLUMN_WIDTH;
                    }
                });

                await context.extensionRpc.sendRequest(SetColumnWidthsRequest.type, {
                    uri,
                    gridId: props.gridId,
                    columnWidths: columnWidths.map((width) => width ?? DEFAULT_COLUMN_WIDTH),
                });
            },
            [columnCount, context.extensionRpc, props.gridId, uri],
        );

        const updateHeaderButtonStates = useCallback((grid: SlickGrid) => {
            for (const column of grid.getColumns()) {
                const columnId = column.id?.toString();
                if (!columnId || columnId === ROW_NUMBER_COLUMN_ID) {
                    continue;
                }

                const headerNode = grid.getHeaderColumn(grid.getColumnIndex(column.id));
                const filterButton = headerNode?.querySelector<HTMLButtonElement>(
                    ".slick-header-filterbutton",
                );
                const sortButton = headerNode?.querySelector<HTMLButtonElement>(
                    ".slick-header-sortbutton",
                );
                const filterValues = filterStateRef.current[columnId]?.filterValues ?? [];
                filterButton?.classList.toggle("filtered", filterValues.length > 0);

                sortButton?.classList.remove("sorted-asc", "sorted-desc");
                if (sortStateRef.current?.columnId === columnId) {
                    if (sortStateRef.current.direction === SortProperties.ASC) {
                        sortButton?.classList.add("sorted-asc");
                    } else if (sortStateRef.current.direction === SortProperties.DESC) {
                        sortButton?.classList.add("sorted-desc");
                    }
                }
            }
        }, []);

        const persistFilterState = useCallback(async () => {
            await context.extensionRpc.sendRequest(SetFiltersRequest.type, {
                uri,
                gridId: props.gridId,
                filters: filterStateRef.current,
            });
        }, [context.extensionRpc, props.gridId, uri]);

        const clearAllFilters = useCallback(
            async (grid: SlickGrid) => {
                const clearedFilters: ColumnFilterMap = {};
                for (const [columnId, filterState] of Object.entries(filterStateRef.current)) {
                    clearedFilters[columnId] = {
                        ...filterState,
                        filterValues: [],
                    };
                }

                filterStateRef.current = clearedFilters;
                const applied = await applyGridTransforms(grid, { preserveScrollPosition: true });
                if (!applied) {
                    return;
                }

                context.hideColumnMenuPopup();
                updateHeaderButtonStates(grid);
                await persistFilterState();
                grid.invalidate();
                grid.render();
                grid.focus();
            },
            [applyGridTransforms, context, persistFilterState, updateHeaderButtonStates],
        );

        const clearSort = useCallback(
            async (grid: SlickGrid) => {
                const sortedColumnId = sortStateRef.current?.columnId;
                const clearedSortFilters: ColumnFilterMap = {};
                for (const [columnId, filterState] of Object.entries(filterStateRef.current)) {
                    clearedSortFilters[columnId] = {
                        ...filterState,
                        sorted: SortProperties.NONE,
                    };
                }

                if (sortedColumnId && !clearedSortFilters[sortedColumnId]) {
                    clearedSortFilters[sortedColumnId] = {
                        columnDef: sortedColumnId,
                        filterValues: [],
                        sorted: SortProperties.NONE,
                    };
                }

                sortStateRef.current = undefined;
                filterStateRef.current = clearedSortFilters;
                const applied = await applyGridTransforms(grid, { preserveScrollPosition: true });
                if (!applied) {
                    return;
                }

                updateHeaderButtonStates(grid);
                await persistFilterState();
                grid.invalidate();
                grid.render();
                grid.focus();
            },
            [applyGridTransforms, persistFilterState, updateHeaderButtonStates],
        );

        const showAllColumns = useCallback(
            (grid: SlickGrid, allColumns: Column<QueryResultGridRow>[]) => {
                const columnsToShow = allColumns.length > 0 ? allColumns : grid.getColumns();
                for (const column of columnsToShow) {
                    if (isGridMenuDataColumn(column)) {
                        column.hidden = false;
                    }
                }

                grid.setColumns(columnsToShow);
                grid.invalidate();
                grid.render();
                updateHeaderButtonStates(grid);
                grid.focus();
            },
            [updateHeaderButtonStates],
        );

        const gridOptions = useMemo<GridOption>(
            () => ({
                ...baseFluentReadOnlyGridOption,
                alwaysShowVerticalScroll: false,
                autoResize: createFluentAutoResizeOptions(`#beta-grid-container-${props.gridId}`, {
                    bottomPadding: 0,
                    minHeight: 50,
                }),
                darkMode: themeKind === ColorThemeKind.Dark,
                datasetIdPropertyName: "id",
                editable: false,
                enableAutoSizeColumns: false,
                enableCellNavigation: true,
                enableColumnPicker: false,
                enableColumnReorder: true,
                enableContextMenu: false,
                enableEmptyDataWarningMessage: false,
                enableExcelCopyBuffer: false,
                enableGridMenu: true,
                enableSorting: false,
                enableMouseWheelScrollHandler: true,
                enableSelection: true,
                forceFitColumns: false,
                frozenColumn: frozenColumnIndex,
                frozenRightViewportMinWidth: 50,
                gridMenu: {
                    commandItems: [
                        {
                            command: GRID_MENU_CLEAR_ALL_FILTERS_COMMAND,
                            iconCssClass: "fi fi-filter-dismiss",
                            itemVisibilityOverride: () => hasActiveFilters(),
                            positionOrder: 10,
                            title: locConstants.slickGrid.clearAllFilters,
                            action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                                void clearAllFilters(args.grid);
                            },
                        },
                        {
                            command: GRID_MENU_CLEAR_SORT_COMMAND,
                            iconCssClass: "fi fi-arrow-sort",
                            itemVisibilityOverride: () => hasActiveSort(),
                            positionOrder: 11,
                            title: locConstants.queryResult.clearSort,
                            action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                                void clearSort(args.grid);
                            },
                        },
                        {
                            command: GRID_MENU_SHOW_ALL_COLUMNS_COMMAND,
                            iconCssClass: "fi fi-table",
                            itemUsabilityOverride: (args: GridMenuCallbackArgs) =>
                                !areAllGridMenuColumnsShown(
                                    args.columns as Column<QueryResultGridRow>[],
                                ),
                            positionOrder: 12,
                            title: locConstants.slickGrid.showAllColumns,
                            action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                                showAllColumns(
                                    args.grid,
                                    args.allColumns as Column<QueryResultGridRow>[],
                                );
                            },
                        },
                    ],
                    hideForceFitButton: true,
                    hideSyncResizeButton: true,
                    onAfterMenuShow: (_event, args) => {
                        syncShowAllColumnsMenuCommandState(
                            args.grid,
                            args.allColumns as Column<QueryResultGridRow>[],
                            getOpenGridMenuElement(),
                        );
                    },
                    onColumnsChanged: (_event, args) => {
                        syncShowAllColumnsMenuCommandState(
                            args.grid,
                            args.allColumns as Column<QueryResultGridRow>[],
                            getOpenGridMenuElement(),
                        );
                    },
                },
                rowHeight,
                selectionOptions: {
                    selectActiveCell: true,
                    selectActiveRow: false,
                    selectionType: "cell",
                },
                skipFreezeColumnValidation: true,
            }),
            [
                clearAllFilters,
                clearSort,
                frozenColumnIndex,
                hasActiveFilters,
                hasActiveSort,
                props.gridId,
                rowHeight,
                showAllColumns,
                themeKind,
            ],
        );

        const buildFilterItems = useCallback(
            async (column: Column<QueryResultGridRow>): Promise<FilterListItem[] | undefined> => {
                const rows = await ensureAllRowsLoaded();
                if (!rows) {
                    return undefined;
                }

                const field = column.field?.toString();
                if (!field) {
                    return [];
                }

                const uniqueValues = new Map<FilterValue, string>();
                for (const row of rows) {
                    const value = getCellFilterValue(row, field);
                    if (!uniqueValues.has(value)) {
                        uniqueValues.set(value, getFilterDisplayText(value));
                    }
                }

                const nullEntries: Array<[FilterValue, string]> = [];
                const blankEntries: Array<[FilterValue, string]> = [];
                const otherEntries: Array<[FilterValue, string]> = [];
                uniqueValues.forEach((displayText, value) => {
                    if (value === undefined) {
                        nullEntries.push([value, displayText]);
                    } else if (value === "") {
                        blankEntries.push([value, displayText]);
                    } else {
                        otherEntries.push([value, displayText]);
                    }
                });
                otherEntries.sort((a, b) => a[1].localeCompare(b[1]));

                return [...nullEntries, ...blankEntries, ...otherEntries].map(
                    ([value, displayText], index) => ({
                        value,
                        displayText,
                        index,
                    }),
                );
            },
            [ensureAllRowsLoaded],
        );

        const updateFilterForColumn = useCallback(
            async (
                grid: SlickGrid,
                column: Column<QueryResultGridRow>,
                filterValues: FilterValue[],
                availableItems?: FilterListItem[],
            ) => {
                const columnId = column.id?.toString();
                if (!columnId) {
                    return;
                }

                const normalizedFilterValues =
                    availableItems && filterValues.length === availableItems.length
                        ? []
                        : filterValues;
                filterStateRef.current = {
                    ...filterStateRef.current,
                    [columnId]: {
                        columnDef: columnId,
                        filterValues: normalizedFilterValues as string[],
                        sorted:
                            sortStateRef.current?.columnId === columnId
                                ? sortStateRef.current.direction
                                : filterStateRef.current[columnId]?.sorted,
                    },
                };

                if (normalizedFilterValues.length === 0) {
                    filterStateRef.current[columnId] = {
                        ...filterStateRef.current[columnId],
                        filterValues: [],
                    };
                }

                const applied = await applyGridTransforms(grid, { preserveScrollPosition: true });
                if (applied) {
                    updateHeaderButtonStates(grid);
                    await persistFilterState();
                }
            },
            [applyGridTransforms, persistFilterState, updateHeaderButtonStates],
        );

        const openFilterMenuForColumn = useCallback(
            async (grid: SlickGrid, column: Column<QueryResultGridRow>) => {
                const columnId = column.id?.toString();
                if (!columnId || column.id === ROW_NUMBER_COLUMN_ID) {
                    return;
                }

                if (activeFilterColumnRef.current === columnId) {
                    activeFilterColumnRef.current = undefined;
                    context.hideColumnMenuPopup();
                    grid.focus();
                    return;
                }

                const filterItems = await buildFilterItems(column);
                if (!filterItems) {
                    return;
                }

                const headerNode = grid.getHeaderColumn(grid.getColumnIndex(column.id));
                if (!headerNode) {
                    return;
                }

                activeFilterColumnRef.current = columnId;
                context.showColumnFilterPopup({
                    columnId,
                    anchorRect: toAnchorRect(headerNode.getBoundingClientRect()),
                    items: filterItems,
                    initialSelected:
                        filterStateRef.current[columnId]?.filterValues?.map(
                            normalizeStoredFilterValue,
                        ) ?? [],
                    onApply: async (selected) => {
                        await updateFilterForColumn(grid, column, selected, filterItems);
                    },
                    onClear: async () => {
                        await updateFilterForColumn(grid, column, []);
                    },
                    onDismiss: () => {
                        activeFilterColumnRef.current = undefined;
                        grid.focus();
                    },
                });
            },
            [buildFilterItems, context, updateFilterForColumn],
        );

        const toggleSortForColumn = useCallback(
            async (grid: SlickGrid, column: Column<QueryResultGridRow>) => {
                const columnId = column.id?.toString();
                if (!columnId || column.id === ROW_NUMBER_COLUMN_ID) {
                    return;
                }

                const existingSort =
                    sortStateRef.current?.columnId === columnId
                        ? sortStateRef.current.direction
                        : SortProperties.NONE;
                const nextSort =
                    existingSort === SortProperties.NONE
                        ? SortProperties.ASC
                        : existingSort === SortProperties.ASC
                          ? SortProperties.DESC
                          : SortProperties.NONE;

                const previousSortColumnId = sortStateRef.current?.columnId;
                sortStateRef.current =
                    nextSort === SortProperties.NONE
                        ? undefined
                        : { columnId, direction: nextSort };

                if (previousSortColumnId && previousSortColumnId !== columnId) {
                    filterStateRef.current[previousSortColumnId] = {
                        ...filterStateRef.current[previousSortColumnId],
                        columnDef: previousSortColumnId,
                        filterValues:
                            filterStateRef.current[previousSortColumnId]?.filterValues ?? [],
                        sorted: SortProperties.NONE,
                    };
                }

                filterStateRef.current[columnId] = {
                    ...filterStateRef.current[columnId],
                    columnDef: columnId,
                    filterValues: filterStateRef.current[columnId]?.filterValues ?? [],
                    sorted: nextSort,
                };

                const applied = await applyGridTransforms(grid);
                if (!applied) {
                    return;
                }

                updateHeaderButtonStates(grid);
                await persistFilterState();
                grid.invalidate();
                grid.render();
                grid.focus();
            },
            [applyGridTransforms, persistFilterState, updateHeaderButtonStates],
        );

        const restoreFilterAndSortState = useCallback(
            async (grid: SlickGrid) => {
                const filters =
                    (await context.extensionRpc.sendRequest(GetFiltersRequest.type, {
                        uri,
                        gridId: props.gridId,
                    })) ?? {};

                filterStateRef.current = filters;
                sortStateRef.current = undefined;

                const restoredColumns = grid.getColumns().map((column) => {
                    const columnId = column.id?.toString();
                    if (!columnId || columnId === ROW_NUMBER_COLUMN_ID) {
                        return column;
                    }

                    const filterState = filters[columnId];
                    if (!filterState) {
                        return {
                            ...column,
                            filterValues: undefined,
                            sorted: undefined,
                        } as Column<QueryResultGridRow>;
                    }

                    if (
                        filterState.sorted &&
                        filterState.sorted !== SortProperties.NONE &&
                        !sortStateRef.current
                    ) {
                        sortStateRef.current = {
                            columnId,
                            direction: filterState.sorted,
                        };
                    }

                    return {
                        ...column,
                        filterValues: filterState.filterValues,
                        sorted:
                            filterState.sorted === SortProperties.NONE
                                ? undefined
                                : filterState.sorted,
                    } as Column<QueryResultGridRow>;
                });

                grid.setColumns(restoredColumns);
                await applyGridTransforms(grid);
                updateHeaderButtonStates(grid);
            },
            [
                applyGridTransforms,
                context.extensionRpc,
                props.gridId,
                updateHeaderButtonStates,
                uri,
            ],
        );

        const setSelectedRange = useCallback((grid: SlickGrid, range: SlickRange) => {
            grid.getSelectionModel()?.setSelectedRanges([range]);
        }, []);

        const updateSelectionSummary = useCallback(
            (ranges: SlickRange[]) => {
                const currentResultSetSummary = latestResultSetSummaryRef.current;
                if (!currentResultSetSummary) {
                    return;
                }

                const selection = getDataSelectionsFromRanges(ranges);

                void context.extensionRpc.sendNotification(SetSelectionSummaryRequest.type, {
                    selection,
                    uri,
                    batchId: currentResultSetSummary.batchId,
                    resultId: currentResultSetSummary.id,
                });
            },
            [context.extensionRpc, uri],
        );

        const handleReactGridCreated = useCallback(
            (event: CustomEvent<SlickgridReactInstance>) => {
                const reactGrid = event.detail;
                const grid = reactGrid.slickGrid;
                reactGridRef.current = reactGrid;
                dataViewRef.current?.setGrid(grid);
                attachFrozenPaneWheelHandler(grid);
                selectionEventHandlerRef.current?.unsubscribeAll();
                selectionEventHandlerRef.current = new SlickEventHandler();
                gridStateEventHandlerRef.current?.unsubscribeAll();
                gridStateEventHandlerRef.current = new SlickEventHandler();
                keyboardEventHandlerRef.current?.unsubscribeAll();
                keyboardEventHandlerRef.current = new SlickEventHandler();
                keyboardEventHandlerRef.current.subscribe(grid.onKeyDown, (eventData, args) => {
                    handleKeyDownRef.current?.(eventData as SlickEventData, args);
                });
                const selectionModel = grid.getSelectionModel();
                if (selectionModel?.onSelectedRangesChanged) {
                    selectionEventHandlerRef.current.subscribe(
                        selectionModel.onSelectedRangesChanged,
                        (_event, ranges) => updateSelectionSummary(ranges),
                    );
                }
                gridStateEventHandlerRef.current.subscribe(grid.onColumnsResized, () => {
                    void persistColumnWidths(grid);
                });
                gridStateEventHandlerRef.current.subscribe(grid.onScroll, () => {
                    persistScrollPosition(grid);
                });
                removeGridMenuFromTabOrder(grid);
                requestAnimationFrame(() => removeGridMenuFromTabOrder(grid));
                grid.updateRowCount();
                grid.render();
                void applyAutoSizeColumns();
                void restoreColumnWidths(grid);
                void restoreScrollPosition(grid);
                void restoreFilterAndSortState(grid);
            },
            [
                applyAutoSizeColumns,
                persistColumnWidths,
                persistScrollPosition,
                restoreColumnWidths,
                restoreFilterAndSortState,
                restoreScrollPosition,
                attachFrozenPaneWheelHandler,
                removeGridMenuFromTabOrder,
                updateSelectionSummary,
            ],
        );

        const handleClick = useCallback(
            (event: CustomEvent) => {
                const args = event.detail?.args;
                const currentResultSetSummary = latestResultSetSummaryRef.current;
                if (!args || !currentResultSetSummary) {
                    return;
                }

                if (args.cell === 0) {
                    const lastCell = args.grid.getColumns().length - 1;
                    setSelectedRange(
                        args.grid,
                        new SlickRange(args.row, FIRST_DATA_CELL_INDEX, args.row, lastCell),
                    );
                    args.grid.setActiveCell(args.row, FIRST_DATA_CELL_INDEX);
                    return;
                }

                if (args.cell < FIRST_DATA_CELL_INDEX) {
                    return;
                }

                args.grid.setActiveCell(args.row, args.cell);
                setSelectedRange(
                    args.grid,
                    new SlickRange(args.row, args.cell, args.row, args.cell),
                );

                const row = args.grid.getDataItem(args.row) as QueryResultGridRow | undefined;
                const columnDefinition = args.grid.getColumns()[args.cell] as
                    | Column<QueryResultGridRow>
                    | undefined;
                const resultColumnIndex = Number(columnDefinition?.field);
                if (!Number.isInteger(resultColumnIndex)) {
                    return;
                }

                const cellValue = row?.[resultColumnIndex.toString()];
                if (!cellValue || typeof cellValue !== "object" || cellValue.isNull) {
                    return;
                }

                const column = currentResultSetSummary.columnInfo[resultColumnIndex];
                const languageId = column?.isXml
                    ? XML_LANGUAGE_ID
                    : column?.isJson
                      ? JSON_LANGUAGE_ID
                      : isXmlCell(cellValue.displayValue)
                        ? XML_LANGUAGE_ID
                        : isJson(cellValue.displayValue)
                          ? JSON_LANGUAGE_ID
                          : undefined;
                if (!languageId) {
                    return;
                }

                context.openFileThroughLink(cellValue.displayValue, languageId);
            },
            [context, setSelectedRange],
        );

        const handleContextMenuAction = useCallback(
            async (action: GridContextMenuAction, grid: SlickGrid) => {
                const currentResultSetSummary = latestResultSetSummaryRef.current;
                if (!currentResultSetSummary) {
                    return;
                }

                const currentRowCount = grid.getDataLength();
                let selection: ISlickRange[] | undefined;
                const getSelection = () => {
                    if (!selection) {
                        selection = getActualSelectionForCopy(grid);
                    }
                    return selection;
                };

                switch (action) {
                    case GridContextMenuAction.SelectAll: {
                        const lastRow = Math.max(0, currentRowCount - 1);
                        const lastCell = grid.getColumns().length - 1;
                        setSelectedRange(
                            grid,
                            new SlickRange(0, FIRST_DATA_CELL_INDEX, lastRow, lastCell),
                        );
                        break;
                    }
                    case GridContextMenuAction.CopySelection:
                        await context.extensionRpc.sendRequest(CopySelectionRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getSelection(),
                            includeHeaders: false,
                        });
                        break;
                    case GridContextMenuAction.CopyWithHeaders:
                        await context.extensionRpc.sendRequest(CopySelectionRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getSelection(),
                            includeHeaders: true,
                        });
                        break;
                    case GridContextMenuAction.CopyHeaders:
                        await context.extensionRpc.sendRequest(CopyHeadersRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getDisplayedSelectionForCopy(grid, currentRowCount),
                        });
                        break;
                    case GridContextMenuAction.CopyAsCsv:
                        await context.extensionRpc.sendRequest(CopyAsCsvRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getSelection(),
                        });
                        break;
                    case GridContextMenuAction.CopyAsJson:
                        await context.extensionRpc.sendRequest(CopyAsJsonRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getSelection(),
                            includeHeaders: true,
                        });
                        break;
                    case GridContextMenuAction.CopyAsInClause:
                        await context.extensionRpc.sendRequest(CopyAsInClauseRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getSelection(),
                        });
                        break;
                    case GridContextMenuAction.CopyAsInsertInto:
                        await context.extensionRpc.sendRequest(CopyAsInsertIntoRequest.type, {
                            uri,
                            batchId: currentResultSetSummary.batchId,
                            resultId: currentResultSetSummary.id,
                            selection: getSelection(),
                        });
                        break;
                    default:
                        break;
                }
            },
            [context.extensionRpc, getActualSelectionForCopy, setSelectedRange, uri],
        );

        const handleContextMenu = useCallback(
            (event: CustomEvent) => {
                const eventData = event.detail?.eventData as MouseEvent | undefined;
                const grid = event.detail?.args?.grid as SlickGrid | undefined;
                if (!eventData || !grid) {
                    return;
                }

                eventData.preventDefault();
                eventData.stopPropagation();

                const margin = 8;
                const estimatedWidth = 260;
                const estimatedHeight = 260;
                const maxX = Math.max(margin, window.innerWidth - estimatedWidth - margin);
                const maxY = Math.max(margin, window.innerHeight - estimatedHeight - margin);
                const adjustedX = Math.min(Math.max(eventData.pageX, margin), maxX);
                const adjustedY = Math.min(Math.max(eventData.pageY, margin), maxY);

                context.showGridContextMenu(adjustedX, adjustedY, async (action) => {
                    await handleContextMenuAction(action, grid);
                    context.hideGridContextMenu();
                });
            },
            [context, handleContextMenuAction],
        );

        const resizeColumn = useCallback(
            async (grid: SlickGrid, columnId: string, width: number) => {
                const resizedColumns = grid
                    .getColumns()
                    .map((column) => (column.id === columnId ? { ...column, width } : column));
                grid.setColumns(resizedColumns);
                grid.invalidate();
                grid.render();
                await persistColumnWidths(grid);
                grid.focus();
            },
            [persistColumnWidths],
        );

        const handleHeaderContextMenuAction = useCallback(
            async (
                action: HeaderContextMenuAction,
                grid: SlickGrid,
                column: Column<QueryResultGridRow>,
            ) => {
                const columnId = column.id?.toString();
                if (!columnId) {
                    return;
                }

                switch (action) {
                    case HeaderContextMenuAction.ToggleSort:
                        await toggleSortForColumn(grid, column);
                        break;
                    case HeaderContextMenuAction.Filter:
                        await openFilterMenuForColumn(grid, column);
                        break;
                    case HeaderContextMenuAction.Resize:
                        await context.openResizeDialog({
                            open: true,
                            columnId,
                            columnName: typeof column.name === "string" ? column.name : "",
                            initialWidth: column.width ?? 0,
                            gridId: props.gridId,
                            onDismiss: () => grid.focus(),
                            onSubmit: (newWidth: number) => resizeColumn(grid, columnId, newWidth),
                        });
                        break;
                    case HeaderContextMenuAction.CopyColumnName: {
                        const tooltip =
                            typeof column.toolTip === "string" && column.toolTip.length > 0
                                ? column.toolTip
                                : undefined;
                        const rawName =
                            tooltip ?? (typeof column.name === "string" ? column.name : "");
                        await context.extensionRpc.sendRequest(CopyColumnNameRequest.type, {
                            columnName: `[${rawName.replace(/\]/g, "]]")}]`,
                        });
                        break;
                    }
                    case HeaderContextMenuAction.FreezeColumn: {
                        const columnIndex = grid.getColumnIndex(column.id);
                        setFrozenColumnIndex(columnIndex);
                        applyFrozenColumnIndex(grid, columnIndex);
                        break;
                    }
                    case HeaderContextMenuAction.UnfreezeColumn:
                        const columnIndex = grid.getColumnIndex(column.id);
                        const nextFrozenColumnIndex = Math.max(0, columnIndex - 1);
                        setFrozenColumnIndex(nextFrozenColumnIndex);
                        applyFrozenColumnIndex(grid, nextFrozenColumnIndex);
                        break;
                    default:
                        break;
                }
            },
            [
                applyFrozenColumnIndex,
                context,
                openFilterMenuForColumn,
                props.gridId,
                resizeColumn,
                setFrozenColumnIndex,
                toggleSortForColumn,
            ],
        );

        const handleHeaderContextMenu = useCallback(
            (event: CustomEvent) => {
                const eventData = event.detail?.eventData as MouseEvent | undefined;
                const args = event.detail?.args;
                const grid = args?.grid as SlickGrid | undefined;
                const column = args?.column as Column<QueryResultGridRow> | undefined;
                if (!eventData || !grid || !column || column.id === ROW_NUMBER_COLUMN_ID) {
                    return;
                }

                eventData.preventDefault();
                eventData.stopPropagation();
                context.hideGridContextMenu();

                const columnIndex = grid.getColumnIndex(column.id);
                const activeFrozenColumnIndex = grid.getOptions().frozenColumn ?? frozenColumnIndex;
                const isColumnFrozen = activeFrozenColumnIndex >= columnIndex;
                const freezeAction = isColumnFrozen
                    ? HeaderContextMenuAction.UnfreezeColumn
                    : HeaderContextMenuAction.FreezeColumn;
                const freezeActionLabel = isColumnFrozen ? "Unfreeze Columns" : "Freeze Columns";

                const margin = 8;
                const estimatedWidth = 220;
                const estimatedHeight = 220;
                const maxX = Math.max(margin, window.innerWidth - estimatedWidth - margin);
                const maxY = Math.max(margin, window.innerHeight - estimatedHeight - margin);
                const adjustedX = Math.min(Math.max(eventData.pageX, margin), maxX);
                const adjustedY = Math.min(Math.max(eventData.pageY, margin), maxY);
                const menuActions: HeaderContextMenuAction[] = HEADER_CONTEXT_MENU_ACTIONS.filter(
                    (action) =>
                        action !== HeaderContextMenuAction.FreezeColumn &&
                        action !== HeaderContextMenuAction.UnfreezeColumn,
                ) as HeaderContextMenuAction[];
                menuActions.push(freezeAction);

                context.showHeaderContextMenu(
                    adjustedX,
                    adjustedY,
                    async (action) => {
                        await handleHeaderContextMenuAction(action, grid, column);
                        context.hideHeaderContextMenu();
                    },
                    menuActions,
                    freezeActionLabel,
                );
            },
            [context, frozenColumnIndex, handleHeaderContextMenuAction],
        );

        const handleHeaderCellRendered = useCallback(
            (event: CustomEvent) => {
                const args = event.detail?.args;
                const grid = args?.grid as SlickGrid | undefined;
                const column = args?.column as Column<QueryResultGridRow> | undefined;
                const node = args?.node as HTMLElement | undefined;
                if (!grid || !column || !node || column.id === ROW_NUMBER_COLUMN_ID) {
                    if (node) {
                        node.tabIndex = -1;
                    }
                    return;
                }

                node.tabIndex = -1;
                if (node.classList.contains("slick-header-with-filter")) {
                    node.classList.remove("slick-header-sortable", "slick-header-column-sorted");
                    node.querySelector(".slick-sort-indicator")?.remove();
                    node.querySelector(".slick-sort-indicator-numbered")?.remove();
                    updateHeaderButtonStates(grid);
                    return;
                }

                node.classList.add("slick-header-with-filter");
                node.classList.remove("slick-header-sortable", "slick-header-column-sorted");
                node.querySelector(".slick-sort-indicator")?.remove();
                node.querySelector(".slick-sort-indicator-numbered")?.remove();

                const sortShortcut = keyBindings[WebviewAction.ResultGridToggleSort]?.label;
                const sortTooltip = sortShortcut
                    ? `${locConstants.queryResult.sort} (${sortShortcut})`
                    : locConstants.queryResult.sort;
                const sortButton = document.createElement("button");
                sortButton.id = "sort-btn";
                sortButton.type = "button";
                sortButton.className = "slick-header-sortbutton";
                sortButton.tabIndex = -1;
                sortButton.setAttribute("aria-label", sortTooltip);
                sortButton.title = sortTooltip;
                sortButton.addEventListener("mousedown", (mouseEvent) => {
                    mouseEvent.preventDefault();
                    mouseEvent.stopPropagation();
                });
                sortButton.addEventListener("click", async (clickEvent) => {
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                    await toggleSortForColumn(grid, column);
                });
                const resizableHandle = node.querySelector(".slick-resizable-handle");
                node.insertBefore(sortButton, resizableHandle);

                const filterShortcut = keyBindings[WebviewAction.ResultGridOpenFilterMenu]?.label;
                const filterTooltip = filterShortcut
                    ? `${locConstants.queryResult.filter} (${filterShortcut})`
                    : locConstants.queryResult.filter;
                const filterButton = document.createElement("button");
                filterButton.id = "filter-btn";
                filterButton.type = "button";
                filterButton.className = "slick-header-filterbutton";
                filterButton.tabIndex = -1;
                filterButton.setAttribute("aria-label", filterTooltip);
                filterButton.title = filterTooltip;
                filterButton.addEventListener("mousedown", (mouseEvent) => {
                    mouseEvent.preventDefault();
                    mouseEvent.stopPropagation();
                });
                filterButton.addEventListener("click", async (clickEvent) => {
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                    await openFilterMenuForColumn(grid, column);
                });
                node.insertBefore(filterButton, resizableHandle);
                updateHeaderButtonStates(grid);
            },
            [keyBindings, openFilterMenuForColumn, toggleSortForColumn, updateHeaderButtonStates],
        );

        const handleBeforeHeaderCellDestroy = useCallback((event: CustomEvent) => {
            const node = event.detail?.args?.node as HTMLElement | undefined;
            if (!node) {
                return;
            }

            node.querySelector(".slick-header-sortbutton")?.remove();
            node.querySelector(".slick-header-filterbutton")?.remove();
            node.classList.remove("slick-header-with-filter");
        }, []);

        const handleHeaderClick = useCallback(
            (event: CustomEvent) => {
                context.hideGridContextMenu();
                const args = event.detail?.args;
                const grid = args?.grid as SlickGrid | undefined;
                const column = args?.column as Column<QueryResultGridRow> | undefined;
                if (!grid || !column) {
                    return;
                }

                const currentRowCount = grid.getDataLength();
                if (currentRowCount <= 0) {
                    return;
                }

                const columnIndex = grid.getColumnIndex(column.id);
                const lastRow = currentRowCount - 1;
                const lastCell = grid.getColumns().length - 1;

                if (column.id === ROW_NUMBER_COLUMN_ID) {
                    setSelectedRange(
                        grid,
                        new SlickRange(0, FIRST_DATA_CELL_INDEX, lastRow, lastCell),
                    );
                    return;
                }

                if (columnIndex >= FIRST_DATA_CELL_INDEX) {
                    setSelectedRange(grid, new SlickRange(0, columnIndex, lastRow, columnIndex));
                }
            },
            [context, setSelectedRange],
        );

        const completeKeyboardEvent = useCallback((eventData: SlickEventData) => {
            eventData.preventDefault();
            eventData.stopPropagation();
            eventData.stopImmediatePropagation();
        }, []);

        const getActiveDataColumn = useCallback((grid: SlickGrid) => {
            const active = grid.getActiveCell();
            if (!active || active.cell < FIRST_DATA_CELL_INDEX) {
                return undefined;
            }

            const column = grid.getColumns()[active.cell] as Column<QueryResultGridRow> | undefined;
            if (!column || column.id === ROW_NUMBER_COLUMN_ID) {
                return undefined;
            }

            return { active, column };
        }, []);

        const moveFocusToCommandBar = useCallback(() => {
            const resultGridContainer = document.getElementById(props.gridId);
            const commandBar = resultGridContainer?.querySelector<HTMLElement>(
                '[data-query-result-command-bar="true"]',
            );
            const commandBarTarget = commandBar?.querySelector<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            commandBarTarget?.focus();
        }, [props.gridId]);

        const selectAllCells = useCallback(
            (grid: SlickGrid) => {
                const rowCount = grid.getDataLength();
                if (rowCount <= 0) {
                    return;
                }

                setSelectedRange(
                    grid,
                    new SlickRange(
                        0,
                        FIRST_DATA_CELL_INDEX,
                        rowCount - 1,
                        grid.getColumns().length - 1,
                    ),
                );
            },
            [setSelectedRange],
        );

        const selectActiveCellColumn = useCallback(
            (grid: SlickGrid) => {
                const activeColumn = getActiveDataColumn(grid);
                if (!activeColumn) {
                    return;
                }

                const rowCount = grid.getDataLength();
                if (rowCount <= 0) {
                    return;
                }

                setSelectedRange(
                    grid,
                    new SlickRange(
                        0,
                        activeColumn.active.cell,
                        rowCount - 1,
                        activeColumn.active.cell,
                    ),
                );
                grid.setActiveCell(activeColumn.active.row, activeColumn.active.cell);
            },
            [getActiveDataColumn, setSelectedRange],
        );

        const selectActiveCellRow = useCallback(
            (grid: SlickGrid) => {
                const active = grid.getActiveCell();
                if (!active) {
                    return;
                }

                setSelectedRange(
                    grid,
                    new SlickRange(
                        active.row,
                        FIRST_DATA_CELL_INDEX,
                        active.row,
                        grid.getColumns().length - 1,
                    ),
                );
                grid.setActiveCell(active.row, Math.max(FIRST_DATA_CELL_INDEX, active.cell));
            },
            [setSelectedRange],
        );

        const moveActiveCellToRowEdge = useCallback(
            (grid: SlickGrid, toEnd: boolean) => {
                const active = grid.getActiveCell();
                if (!active) {
                    return;
                }

                const cell = toEnd ? grid.getColumns().length - 1 : FIRST_DATA_CELL_INDEX;
                grid.setActiveCell(active.row, cell);
                setSelectedRange(grid, new SlickRange(active.row, cell, active.row, cell));
            },
            [setSelectedRange],
        );

        const expandSelection = useCallback(
            (
                grid: SlickGrid,
                keyCode:
                    | KeyCode.ArrowLeft
                    | KeyCode.ArrowRight
                    | KeyCode.ArrowUp
                    | KeyCode.ArrowDown,
            ) => {
                const active = grid.getActiveCell();
                if (!active) {
                    return;
                }

                const selectionModel = grid.getSelectionModel();
                const ranges = selectionModel?.getSelectedRanges() ?? [
                    new SlickRange(active.row, active.cell),
                ];
                const nextRanges = [...ranges];
                let lastRange = nextRanges.pop() ?? new SlickRange(active.row, active.cell);
                if (!lastRange.contains(active.row, active.cell)) {
                    lastRange = new SlickRange(active.row, active.cell);
                }

                const dirRow = active.row === lastRange.fromRow ? 1 : -1;
                const dirCell = active.cell === lastRange.fromCell ? 1 : -1;
                let rowDelta = lastRange.toRow - lastRange.fromRow;
                let cellDelta = lastRange.toCell - lastRange.fromCell;

                switch (keyCode) {
                    case KeyCode.ArrowLeft:
                        cellDelta -= dirCell;
                        break;
                    case KeyCode.ArrowRight:
                        cellDelta += dirCell;
                        break;
                    case KeyCode.ArrowUp:
                        rowDelta -= dirRow;
                        break;
                    case KeyCode.ArrowDown:
                        rowDelta += dirRow;
                        break;
                    default:
                        break;
                }

                const row = Math.min(
                    Math.max(active.row + dirRow * rowDelta, 0),
                    Math.max(0, grid.getDataLength() - 1),
                );
                const cell = Math.min(
                    Math.max(active.cell + dirCell * cellDelta, FIRST_DATA_CELL_INDEX),
                    grid.getColumns().length - 1,
                );
                const nextRange = new SlickRange(active.row, active.cell, row, cell);
                nextRanges.push(nextRange);
                selectionModel?.setSelectedRanges(nextRanges);
                grid.scrollRowIntoView(row, false);
                grid.scrollCellIntoView(row, cell, false);
            },
            [],
        );

        const resizeActiveColumn = useCallback(
            async (grid: SlickGrid) => {
                const activeColumn = getActiveDataColumn(grid);
                if (!activeColumn) {
                    return;
                }

                const columnId = activeColumn.column.id?.toString() ?? "";
                await context.openResizeDialog({
                    open: true,
                    columnId,
                    columnName:
                        typeof activeColumn.column.name === "string"
                            ? activeColumn.column.name
                            : "",
                    initialWidth: activeColumn.column.width ?? 0,
                    gridId: props.gridId,
                    onDismiss: () => grid.focus(),
                    onSubmit: (newWidth: number) => resizeColumn(grid, columnId, newWidth),
                });
            },
            [context, getActiveDataColumn, props.gridId, resizeColumn],
        );

        const openHeaderContextMenuForActiveColumn = useCallback(
            (grid: SlickGrid) => {
                const activeColumn = getActiveDataColumn(grid);
                if (!activeColumn) {
                    return;
                }

                const columnIndex = grid.getColumnIndex(activeColumn.column.id);
                const activeFrozenColumnIndex = grid.getOptions().frozenColumn ?? frozenColumnIndex;
                const isColumnFrozen = activeFrozenColumnIndex >= columnIndex;
                const freezeAction = isColumnFrozen
                    ? HeaderContextMenuAction.UnfreezeColumn
                    : HeaderContextMenuAction.FreezeColumn;
                const freezeActionLabel = isColumnFrozen ? "Unfreeze Columns" : "Freeze Columns";
                const headerNode = grid.getHeaderColumn(columnIndex);
                const headerRect = headerNode?.getBoundingClientRect();
                const x = headerRect ? headerRect.left : window.innerWidth / 2;
                const y = headerRect ? headerRect.bottom : window.innerHeight / 2;
                const menuActions: HeaderContextMenuAction[] = HEADER_CONTEXT_MENU_ACTIONS.filter(
                    (action) =>
                        action !== HeaderContextMenuAction.FreezeColumn &&
                        action !== HeaderContextMenuAction.UnfreezeColumn,
                ) as HeaderContextMenuAction[];
                menuActions.push(freezeAction);

                context.showHeaderContextMenu(
                    x,
                    y,
                    async (action) => {
                        await handleHeaderContextMenuAction(action, grid, activeColumn.column);
                        context.hideHeaderContextMenu();
                    },
                    menuActions,
                    freezeActionLabel,
                );
            },
            [context, frozenColumnIndex, getActiveDataColumn, handleHeaderContextMenuAction],
        );

        const saveResults = useCallback(
            async (grid: SlickGrid, format: string) => {
                const currentResultSetSummary = latestResultSetSummaryRef.current;
                if (!currentResultSetSummary) {
                    return;
                }

                await context.extensionRpc.sendRequest(SaveResultsWebviewRequest.type, {
                    uri,
                    batchId: currentResultSetSummary.batchId,
                    resultId: currentResultSetSummary.id,
                    selection: getDisplayedSelectionForCopy(grid, grid.getDataLength()),
                    format,
                    origin: QueryResultSaveAsTrigger.Toolbar,
                });
            },
            [context.extensionRpc, uri],
        );

        const handleKeyDown = useCallback(
            (eventData: SlickEventData, args: { grid: SlickGrid }) => {
                const keyboardEvent = eventData.getNativeEvent<KeyboardEvent>();
                const grid = args.grid;
                if (!keyboardEvent || !grid) {
                    return;
                }

                let handled = true;

                if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopySelection].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopySelection, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopyWithHeaders].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopyWithHeaders, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopyAllHeaders].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopyHeaders, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopyAsCsv].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopyAsCsv, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopyAsJson].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopyAsJson, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopyAsInsert].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopyAsInsertInto, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridCopyAsInClause].keyCombination,
                    )
                ) {
                    void handleContextMenuAction(GridContextMenuAction.CopyAsInClause, grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.QueryResultSaveAsJson].keyCombination,
                    )
                ) {
                    void saveResults(grid, "json");
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.QueryResultSaveAsCsv].keyCombination,
                    )
                ) {
                    void saveResults(grid, "csv");
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.QueryResultSaveAsExcel].keyCombination,
                    )
                ) {
                    void saveResults(grid, "excel");
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.QueryResultSaveAsInsert].keyCombination,
                    )
                ) {
                    void saveResults(grid, "insert");
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridSelectAll].keyCombination,
                    ) ||
                    (isMetaOrCtrlKeyPressed(keyboardEvent) && keyboardEvent.code === KeyCode.KeyA)
                ) {
                    selectAllCells(grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridExpandSelectionLeft].keyCombination,
                    )
                ) {
                    expandSelection(grid, KeyCode.ArrowLeft);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridExpandSelectionRight].keyCombination,
                    )
                ) {
                    expandSelection(grid, KeyCode.ArrowRight);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridExpandSelectionUp].keyCombination,
                    )
                ) {
                    expandSelection(grid, KeyCode.ArrowUp);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridExpandSelectionDown].keyCombination,
                    )
                ) {
                    expandSelection(grid, KeyCode.ArrowDown);
                } else if (
                    keyboardEvent.shiftKey &&
                    !isMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === KeyCode.ArrowLeft
                ) {
                    expandSelection(grid, KeyCode.ArrowLeft);
                } else if (
                    keyboardEvent.shiftKey &&
                    !isMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === KeyCode.ArrowRight
                ) {
                    expandSelection(grid, KeyCode.ArrowRight);
                } else if (
                    keyboardEvent.shiftKey &&
                    !isMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === KeyCode.ArrowUp
                ) {
                    expandSelection(grid, KeyCode.ArrowUp);
                } else if (
                    keyboardEvent.shiftKey &&
                    !isMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === KeyCode.ArrowDown
                ) {
                    expandSelection(grid, KeyCode.ArrowDown);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridOpenColumnMenu].keyCombination,
                    ) ||
                    (keyboardEvent.shiftKey && keyboardEvent.code === KeyCode.F10) ||
                    keyboardEvent.code === KeyCode.ContextMenu
                ) {
                    openHeaderContextMenuForActiveColumn(grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridOpenFilterMenu].keyCombination,
                    )
                ) {
                    const activeColumn = getActiveDataColumn(grid);
                    if (activeColumn) {
                        void openFilterMenuForColumn(grid, activeColumn.column);
                    }
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridMoveToRowStart].keyCombination,
                    )
                ) {
                    moveActiveCellToRowEdge(grid, false);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridMoveToRowEnd].keyCombination,
                    )
                ) {
                    moveActiveCellToRowEdge(grid, true);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridSelectColumn].keyCombination,
                    )
                ) {
                    selectActiveCellColumn(grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridSelectRow].keyCombination,
                    )
                ) {
                    selectActiveCellRow(grid);
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridToggleSort].keyCombination,
                    )
                ) {
                    const activeColumn = getActiveDataColumn(grid);
                    if (activeColumn) {
                        void toggleSortForColumn(grid, activeColumn.column);
                    }
                } else if (
                    eventMatchesShortcut(
                        keyboardEvent,
                        keyBindings[WebviewAction.ResultGridChangeColumnWidth].keyCombination,
                    )
                ) {
                    void resizeActiveColumn(grid);
                } else if (keyboardEvent.shiftKey && keyboardEvent.code === KeyCode.Tab) {
                    moveFocusToCommandBar();
                } else if (!keyboardEvent.shiftKey && keyboardEvent.code === KeyCode.Tab) {
                    moveFocusToCommandBar();
                } else {
                    handled = false;
                }

                if (handled) {
                    completeKeyboardEvent(eventData);
                }
            },
            [
                completeKeyboardEvent,
                expandSelection,
                getActiveDataColumn,
                handleContextMenuAction,
                keyBindings,
                moveActiveCellToRowEdge,
                moveFocusToCommandBar,
                openFilterMenuForColumn,
                openHeaderContextMenuForActiveColumn,
                resizeActiveColumn,
                saveResults,
                selectActiveCellColumn,
                selectActiveCellRow,
                selectAllCells,
                toggleSortForColumn,
            ],
        );
        handleKeyDownRef.current = handleKeyDown;

        const focusGrid = useCallback(() => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid || grid.getDataLength() <= 0) {
                return;
            }

            const active = grid.getActiveCell();
            const row = active?.row ?? 0;
            const cell = Math.max(active?.cell ?? FIRST_DATA_CELL_INDEX, FIRST_DATA_CELL_INDEX);
            (grid as SlickGrid & { tabbingDirection?: number }).tabbingDirection = 1;
            grid.gotoCell(row, cell, false);
        }, []);

        const handleGridContainerFocus = useCallback(
            (event: ReactFocusEvent<HTMLDivElement>) => {
                setIsGridFocused(true);

                if (event.target === event.currentTarget) {
                    focusGrid();
                }
            },
            [focusGrid],
        );

        const handleGridContainerBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
            const nextFocusedElement = event.relatedTarget as Node | null;
            if (!nextFocusedElement || !event.currentTarget.contains(nextFocusedElement)) {
                setIsGridFocused(false);
            }
        }, []);

        useImperativeHandle(ref, () => ({
            focusGrid,
        }));

        if (!resultSetSummary || columns.length === 0) {
            return null;
        }
        const hasDisplayedRows = displayedRowCount > 0;

        const betaGridClasses = [
            "query-result-beta-grid",
            isGridFocused ? "focused" : "",
            gridSettings?.alternatingRowColors ? "results-grid--alternating" : "",
        ]
            .filter(Boolean)
            .join(" ");
        const betaGridStyle = {
            "--results-row-padding": `${rowPadding}px`,
        } as CSSProperties;

        return (
            <div
                id={`beta-grid-container-${props.gridId}`}
                className={betaGridClasses}
                style={betaGridStyle}
                tabIndex={0}
                onFocus={handleGridContainerFocus}
                onBlur={handleGridContainerBlur}>
                <FluentSlickGrid
                    gridId={`beta-result-grid-${props.gridId}`}
                    columns={columns}
                    options={gridOptions}
                    dataset={EMPTY_DATASET}
                    customDataView={dataView as any}
                    onReactGridCreated={handleReactGridCreated}
                    onClick={handleClick}
                    onContextMenu={handleContextMenu}
                    onHeaderCellRendered={handleHeaderCellRendered}
                    onBeforeHeaderCellDestroy={handleBeforeHeaderCellDestroy}
                    onHeaderClick={handleHeaderClick}
                    onHeaderContextMenu={handleHeaderContextMenu}
                />
                {!hasDisplayedRows && (
                    <div className="query-result-beta-empty-state" role="status">
                        {locConstants.queryResult.noResultsToDisplay}
                    </div>
                )}
            </div>
        );
    },
);

ResultBetaGrid.displayName = "ResultBetaGrid";
export default ResultBetaGrid;
