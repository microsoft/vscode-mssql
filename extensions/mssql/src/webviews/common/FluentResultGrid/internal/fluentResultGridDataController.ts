/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from "react";
import type { SlickGrid } from "slickgrid-react";
import type {
    ColumnFilterMap,
    DbCellValue,
    ResultSetSummary,
} from "../../../../sharedInterfaces/queryResult";
import type { FluentResultGridDataSource } from "../types/fluentResultGridDataSource";
import type { MaybePromise } from "../types/fluentResultGridPrimitives";
import type { FluentResultGridState } from "../types/fluentResultGridState";
import { FLUENT_RESULT_GRID_WINDOW_SIZE } from "./fluentResultGridConstants";
import type { SourceRow } from "./fluentResultGridControllerTypes";
import {
    createFluentResultGridDataView,
    type FluentResultGridDataView,
    type FluentResultGridDataRow,
} from "./fluentResultGridDataView";
import {
    applyFluentResultGridTransformsToSourceRows,
    hasActiveFluentResultGridFilters,
} from "./fluentResultGridTransforms";

export interface FluentResultGridDataController {
    allRowsCacheRef: MutableRefObject<SourceRow[] | undefined>;
    applyGridTransforms: (
        grid: SlickGrid,
        options?: { preserveScrollPosition?: boolean },
    ) => Promise<boolean>;
    dataSourceRef: MutableRefObject<FluentResultGridDataSource>;
    dataView: FluentResultGridDataView<FluentResultGridDataRow>;
    dataViewKey: number;
    dataViewRef: MutableRefObject<FluentResultGridDataView<FluentResultGridDataRow> | undefined>;
    displayedRowCount: number;
    ensureAllRowsLoaded: () => Promise<SourceRow[] | undefined>;
    fetchRowsFromSource: (offset: number, count: number) => Promise<SourceRow[]>;
    filterStateRef: MutableRefObject<ColumnFilterMap>;
    hasActiveSort: () => boolean;
    hasActiveTransforms: () => boolean;
    latestRowCountRef: MutableRefObject<number>;
    setDisplayedRowCount: Dispatch<SetStateAction<number>>;
    sortStateRef: MutableRefObject<FluentResultGridState["sort"] | undefined>;
    transformedRowsRef: MutableRefObject<SourceRow[] | undefined>;
}

export function useFluentResultGridDataController({
    dataSource,
    resultSetSummary,
    resultIdentitySignature,
    initialState,
    inMemoryDataProcessingThreshold,
    onInMemoryDataProcessingThresholdExceeded,
    restoreHorizontalScrollPosition,
}: {
    dataSource: FluentResultGridDataSource;
    resultSetSummary: ResultSetSummary;
    resultIdentitySignature: string;
    initialState?: FluentResultGridState;
    inMemoryDataProcessingThreshold: number;
    onInMemoryDataProcessingThresholdExceeded?: () => MaybePromise<void>;
    restoreHorizontalScrollPosition: (grid: SlickGrid, scrollLeft: number) => void;
}): FluentResultGridDataController {
    const dataViewRef = useRef<FluentResultGridDataView<FluentResultGridDataRow> | undefined>(
        undefined,
    );
    const allRowsCacheRef = useRef<SourceRow[] | undefined>(undefined);
    const transformedRowsRef = useRef<SourceRow[] | undefined>(undefined);
    const filterStateRef = useRef<ColumnFilterMap>(initialState?.filters ?? {});
    const sortStateRef = useRef<FluentResultGridState["sort"] | undefined>(initialState?.sort);
    const latestRowCountRef = useRef(resultSetSummary.rowCount);
    latestRowCountRef.current = resultSetSummary.rowCount;

    const [displayedRowCount, setDisplayedRowCount] = useState(resultSetSummary.rowCount);
    const dataSourceRef = useRef(dataSource);
    dataSourceRef.current = dataSource;
    const rowsDataSource = dataSource.kind === "rows" ? dataSource : undefined;

    const fetchRowsFromSource = useCallback(
        async (offset: number, count: number): Promise<SourceRow[]> => {
            const currentDataSource = dataSourceRef.current;
            const rows =
                currentDataSource.kind === "rows"
                    ? currentDataSource.rows.slice(offset, offset + count)
                    : await currentDataSource.getRows(offset, count);

            return rows.map((cells, rowOffset) => ({
                rowId: offset + rowOffset,
                cells,
            }));
        },
        [],
    );

    const fetchRows = useCallback(
        async (offset: number, count: number): Promise<DbCellValue[][]> => {
            const transformedRows = transformedRowsRef.current;
            if (transformedRows) {
                return transformedRows.slice(offset, offset + count).map((row) => row.cells);
            }

            return (await fetchRowsFromSource(offset, count)).map((row) => row.cells);
        },
        [fetchRowsFromSource],
    );

    const dataView = useMemo(() => {
        return createFluentResultGridDataView({
            dataSource:
                rowsDataSource ??
                ({
                    kind: "windowed",
                    rowCount:
                        dataSourceRef.current.kind === "windowed"
                            ? dataSourceRef.current.rowCount
                            : 0,
                    getRows: fetchRows,
                } as const),
            columnCount: resultSetSummary.columnInfo.length,
            windowSize: FLUENT_RESULT_GRID_WINDOW_SIZE,
        });
    }, [fetchRows, resultSetSummary.columnInfo.length, rowsDataSource]);

    const dataViewKeyRef = useRef(0);
    const previousDataViewRef = useRef(dataView);
    if (previousDataViewRef.current !== dataView) {
        previousDataViewRef.current = dataView;
        dataViewKeyRef.current++;
    }
    dataViewRef.current = dataView;

    useEffect(() => {
        return () => {
            dataView.dispose();
            if (dataViewRef.current === dataView) {
                dataViewRef.current = undefined;
            }
        };
    }, [dataView]);

    const previousResultIdentitySignatureRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const shouldResetData =
            previousResultIdentitySignatureRef.current !== resultIdentitySignature;
        previousResultIdentitySignatureRef.current = resultIdentitySignature;

        dataView.setLength(resultSetSummary.rowCount, shouldResetData);
        setDisplayedRowCount(resultSetSummary.rowCount);
        if (shouldResetData) {
            dataView.refresh(0);
        }
    }, [dataView, resultIdentitySignature, resultSetSummary.rowCount]);

    useEffect(() => {
        allRowsCacheRef.current = undefined;
        transformedRowsRef.current = undefined;
        filterStateRef.current = initialState?.filters ?? {};
        sortStateRef.current = initialState?.sort;
    }, [initialState?.filters, initialState?.sort, resultIdentitySignature]);

    const ensureAllRowsLoaded = useCallback(async (): Promise<SourceRow[] | undefined> => {
        const currentRowCount = latestRowCountRef.current;
        if (currentRowCount > inMemoryDataProcessingThreshold) {
            await onInMemoryDataProcessingThresholdExceeded?.();
            return undefined;
        }

        const cachedRows = allRowsCacheRef.current;
        if (cachedRows && cachedRows.length === currentRowCount) {
            return cachedRows;
        }

        const rows = currentRowCount > 0 ? await fetchRowsFromSource(0, currentRowCount) : [];
        allRowsCacheRef.current = rows;
        return rows;
    }, [
        fetchRowsFromSource,
        inMemoryDataProcessingThreshold,
        onInMemoryDataProcessingThresholdExceeded,
    ]);

    const hasActiveSort = useCallback(
        () => sortStateRef.current !== undefined && sortStateRef.current.direction !== "NONE",
        [],
    );

    const hasActiveTransforms = useCallback(
        () => hasActiveFluentResultGridFilters(filterStateRef.current) || hasActiveSort(),
        [hasActiveSort],
    );

    const applyGridTransforms = useCallback(
        async (
            grid: SlickGrid,
            options?: { preserveScrollPosition?: boolean },
        ): Promise<boolean> => {
            const preservedTopRow = options?.preserveScrollPosition ? grid.getViewport().top : 0;
            const preservedScrollLeft = options?.preserveScrollPosition
                ? grid.getViewport().leftPx
                : 0;

            if (!hasActiveTransforms()) {
                transformedRowsRef.current = undefined;
                const currentRowCount = latestRowCountRef.current;
                const rowsReset =
                    dataSourceRef.current.kind === "rows" &&
                    dataView.setRows(dataSourceRef.current.rows, currentRowCount);
                if (!rowsReset) {
                    dataView.setLength(currentRowCount, true);
                }
                setDisplayedRowCount(currentRowCount);
                const targetRow = Math.min(preservedTopRow, Math.max(0, currentRowCount - 1));
                if (!rowsReset) {
                    dataView.refresh(targetRow);
                }
                grid.invalidateAllRows();
                grid.updateRowCount();
                if (options?.preserveScrollPosition && currentRowCount > 0) {
                    grid.scrollRowToTop(targetRow);
                }
                grid.render();
                if (options?.preserveScrollPosition) {
                    restoreHorizontalScrollPosition(grid, preservedScrollLeft);
                }
                dataView.ensureViewportLoaded();
                return true;
            }

            const allRows = await ensureAllRowsLoaded();
            if (!allRows) {
                return false;
            }

            const rows = applyFluentResultGridTransformsToSourceRows({
                rows: allRows,
                filters: filterStateRef.current,
                sort: sortStateRef.current,
            });

            transformedRowsRef.current = rows;
            const rowsReplaced =
                dataSourceRef.current.kind === "rows" &&
                dataView.setRows(
                    rows.map((row) => row.cells),
                    rows.length,
                );
            if (!rowsReplaced) {
                dataView.setLength(rows.length, true);
            }
            setDisplayedRowCount(rows.length);
            const targetRow = Math.min(preservedTopRow, Math.max(0, rows.length - 1));
            if (!rowsReplaced) {
                dataView.refresh(targetRow);
            }
            grid.invalidateAllRows();
            grid.updateRowCount();
            if (options?.preserveScrollPosition && rows.length > 0) {
                grid.scrollRowToTop(targetRow);
            } else {
                grid.scrollTo(0);
            }
            grid.render();
            if (options?.preserveScrollPosition) {
                restoreHorizontalScrollPosition(grid, preservedScrollLeft);
            }
            dataView.ensureViewportLoaded();
            return true;
        },
        [dataView, ensureAllRowsLoaded, hasActiveTransforms, restoreHorizontalScrollPosition],
    );

    return {
        allRowsCacheRef,
        applyGridTransforms,
        dataSourceRef,
        dataView,
        dataViewKey: dataViewKeyRef.current,
        dataViewRef,
        displayedRowCount,
        ensureAllRowsLoaded,
        fetchRowsFromSource,
        filterStateRef,
        hasActiveSort,
        hasActiveTransforms,
        latestRowCountRef,
        setDisplayedRowCount,
        sortStateRef,
        transformedRowsRef,
    };
}
