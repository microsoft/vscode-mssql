/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import {
    createRef,
    ForwardRefExoticComponent,
    RefAttributes,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import * as qr from "../../../sharedInterfaces/queryResult";
import CommandBar from "./commandBar";
import ResultGrid, { ResultGridHandle, ResultGridProps } from "./resultGrid";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { perfMark, perfMarkAfterNextPaint } from "../../common/perfMarks";
import { eventMatchesShortcut } from "../../common/keyboardUtils";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import debounce from "lodash/debounce";

const useStyles = makeStyles({
    gridViewContainer: {
        width: "100%",
        height: "100%",
        fontFamily: "var(--vscode-editor-font-family)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        boxSizing: "border-box",
    },
    gridContainer: {
        width: "100%",
        position: "relative",
        display: "flex",
        fontWeight: "normal",
        paddingRight: "8px", // Space for scrollbar
        boxSizing: "border-box",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        flex: "0 0 auto",
        minHeight: 0,
        overflow: "hidden",
    },
});

type GridItem = { batchId: number; resultId: number; index: number };
type ResultGridComponent = ForwardRefExoticComponent<
    ResultGridProps & RefAttributes<ResultGridHandle>
>;

export interface QueryResultsGridViewProps {
    GridComponent?: ResultGridComponent;
    showExternalCommandBar?: boolean;
}

const ROW_HEIGHT = 26;
const HEADER = 30;
export const MARGIN_BOTTOM = 10;
const MIN_HORIZONTAL_SCROLLBAR_SPACE = 18; // Reserve space so short grids don't clip the scrollbar over rows
const DEFAULT_NATURAL_VISIBLE_ROW_CAP = 8;
const DEFAULT_FONT_SIZE = 12;
const BASE_ROW_PADDING = 12;

export const QueryResultsGridView = ({
    GridComponent = ResultGrid,
    showExternalCommandBar = true,
}: QueryResultsGridViewProps) => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return;
    }
    const uri = useQueryResultSelector((state) => state.uri);
    const resultSetSummaries = useQueryResultSelector((state) => state.resultSetSummaries);
    const isExecuting = useQueryResultSelector((state) => state.isExecuting);
    const viewMode =
        useQueryResultSelector((state) => state.tabStates?.resultViewMode) ??
        qr.QueryResultViewMode.Grid;
    const fontSettings = useQueryResultSelector((state) => state.fontSettings);
    const gridSettings = useQueryResultSelector((state) => state.gridSettings);
    const tabStates = useQueryResultSelector((state) => state.tabStates);

    const gridViewContainerRef = useRef<HTMLDivElement>(null);
    const [gridViewContainerHeight, setGridViewContainerHeight] = useState<number>(0);
    const gridContainerRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(
        new Map(),
    );
    const [maximizedGridKey, setMaximizedGridKey] = useState<string | undefined>(undefined);
    const gridRefs = useRef<Array<ResultGridHandle | undefined>>([]);
    const { keyBindings } = useVscodeWebview();

    // Derive a stable flat list for rendering
    const gridList: GridItem[] = useMemo(() => {
        const items: GridItem[] = [];
        if (!resultSetSummaries) return items;
        let index = 0;
        for (const [batchKey, byResult] of Object.entries(resultSetSummaries)) {
            const batchId = Number(batchKey);
            for (const resultKey of Object.keys(byResult)) {
                items.push({ batchId, resultId: Number(resultKey), index: index++ });
            }
        }
        return items;
    }, [resultSetSummaries]);

    function naturalHeight(rowCount: number): number {
        const rowPadding =
            typeof gridSettings?.rowPadding === "number" && Number.isFinite(gridSettings.rowPadding)
                ? Math.max(0, gridSettings.rowPadding)
                : 0;
        const rowHeight = Math.max(
            ROW_HEIGHT,
            (fontSettings?.fontSize ?? DEFAULT_FONT_SIZE) + BASE_ROW_PADDING + rowPadding * 2,
        );
        const visibleRows = Math.max(
            1,
            Math.min(rowCount === 0 ? 1 : rowCount, DEFAULT_NATURAL_VISIBLE_ROW_CAP),
        );
        return visibleRows * rowHeight + HEADER + MARGIN_BOTTOM + MIN_HORIZONTAL_SCROLLBAR_SPACE;
    }

    const gridHeights: number[] = useMemo(() => {
        if (!gridViewContainerHeight || gridList?.length === 0) {
            return [];
        }

        const numGrids = gridList.length;

        // If only one grid, use available space
        if (numGrids === 1) {
            return [gridViewContainerHeight];
        }

        const rowCounts = gridList.map(
            (it) => resultSetSummaries?.[it.batchId]?.[it.resultId]?.rowCount ?? 0,
        );
        const preferredHeights = rowCounts.map((rowCount) => naturalHeight(rowCount));

        // Calculate the content-sized height needed before any large grid absorbs extra space.
        const totalPreferredHeight = preferredHeights.reduce((sum, h) => sum + h, 0);

        if (gridViewContainerHeight <= totalPreferredHeight) {
            return preferredHeights;
        }

        const canGrow = rowCounts.map((rowCount) => rowCount > DEFAULT_NATURAL_VISIBLE_ROW_CAP);
        const growableGridCount = canGrow.filter(Boolean).length;
        if (growableGridCount === 0) {
            return preferredHeights;
        }

        const heightAdjustment =
            (gridViewContainerHeight - totalPreferredHeight) / growableGridCount;

        return preferredHeights.map((preferredHeight, index) =>
            canGrow[index] ? preferredHeight + heightAdjustment : preferredHeight,
        );
    }, [
        fontSettings?.fontSize,
        gridList,
        gridSettings?.rowPadding,
        gridViewContainerHeight,
        resultSetSummaries,
    ]);

    // Diagnostics marks: emitted when the perf/diag bridge is enabled
    // (PERF_MODE runs or Debug Console / Session Diag active); inert otherwise.
    const lastPerfMarkKey = useRef<string | undefined>(undefined);
    const lastDataMarkKey = useRef<string | undefined>(undefined);
    useEffect(() => {
        // Data-received mark: result summaries arrived in the webview (before
        // paint) — the gap to renderComplete is grid render cost.
        if (gridList.length === 0) {
            return;
        }
        const dataKey = `${uri}:${gridList.length}`;
        if (lastDataMarkKey.current !== dataKey) {
            lastDataMarkKey.current = dataKey;
            perfMark("mssql.resultsGrid.dataReceived", {
                resultSets: gridList.length,
                stillExecuting: isExecuting !== false,
            });
        }
    }, [gridList, isExecuting, uri]);
    useEffect(() => {
        if (isExecuting !== false || gridList.length === 0) {
            return;
        }
        const totalRows = gridList.reduce(
            (total, item) =>
                total + (resultSetSummaries?.[item.batchId]?.[item.resultId]?.rowCount ?? 0),
            0,
        );
        const key = `${uri}:${gridList.length}:${totalRows}`;
        if (lastPerfMarkKey.current === key) {
            return;
        }
        lastPerfMarkKey.current = key;
        perfMarkAfterNextPaint("mssql.resultsGrid.renderComplete", {
            rowCount: totalRows,
            resultSets: gridList.length,
        });
    }, [isExecuting, gridList, resultSetSummaries, uri]);

    // Restore grid view container scroll position on mount
    useEffect(() => {
        async function restoreGridViewContainerScrollPosition() {
            const scrollPosition = await context?.extensionRpc.sendRequest(
                qr.GetGridPaneScrollPositionRequest.type,
                {
                    uri: uri,
                },
            );
            if (scrollPosition && gridViewContainerRef.current) {
                gridViewContainerRef.current.scrollTop = scrollPosition.scrollTop;
            }
        }
        void restoreGridViewContainerScrollPosition();
    }, [uri, gridViewContainerRef, tabStates, viewMode]);

    // Restore maximized grid on mount
    useEffect(() => {
        async function restoreMaximizedGrid() {
            const result = await context?.extensionRpc.sendRequest(
                qr.GetMaximizedGridRequest.type,
                {
                    uri: uri,
                },
            );
            if (result?.gridId) {
                setMaximizedGridKey(result.gridId);
            }
        }
        void restoreMaximizedGrid();
    }, [uri, tabStates, viewMode]);

    const getActiveGrid = useCallback(():
        | {
              gridContainerDiv: HTMLDivElement | null;
              grid: ResultGridHandle | undefined;
              gridIndex: number;
              gridDef: GridItem;
          }
        | undefined => {
        const activeElement = document.activeElement;
        for (let i = 0; i < gridList.length; i++) {
            const item = gridList[i];
            const gridContainerDiv = gridContainerRefs.current.get(
                `${item.batchId}_${item.resultId}`,
            )?.current;

            if (gridContainerDiv === activeElement || gridContainerDiv?.contains(activeElement)) {
                return {
                    gridContainerDiv: gridContainerDiv,
                    gridIndex: i,
                    grid: gridRefs.current[i],
                    gridDef: item,
                };
            }
        }
        return undefined;
    }, [gridList, gridRefs]);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            let handled = false;
            if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultMaximizeGrid]?.keyCombination,
                )
            ) {
                if (viewMode === qr.QueryResultViewMode.Grid && gridList.length > 1) {
                    const targetGrid = getActiveGrid();
                    if (!targetGrid) {
                        return;
                    }
                    if (
                        maximizedGridKey ===
                        `${targetGrid.gridDef.batchId}_${targetGrid.gridDef.resultId}`
                    ) {
                        setMaximizedGridKey(undefined);
                    } else {
                        setMaximizedGridKey(
                            `${targetGrid.gridDef.batchId}_${targetGrid.gridDef.resultId}`,
                        );
                    }
                }
            } else if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultPrevGrid]?.keyCombination,
                )
            ) {
                const activeGrid = getActiveGrid();
                if (!activeGrid) {
                    return;
                }
                // Circular navigation
                const newIndex = (activeGrid.gridIndex - 1 + gridList.length) % gridList.length;

                // Scroll div into view before focusing grid
                gridContainerRefs.current
                    .get(`${activeGrid.gridDef.batchId}_${activeGrid.gridDef.resultId}`)
                    ?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                const gridToFocus = gridRefs.current[newIndex];
                if (gridToFocus) {
                    gridToFocus.focusGrid();
                    handled = true;
                }
            } else if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultNextGrid]?.keyCombination,
                )
            ) {
                const activeGrid = getActiveGrid();
                if (!activeGrid) {
                    return;
                }
                // Circular navigation
                const newIndex = (activeGrid.gridIndex + 1) % gridList.length;

                // Scroll div into view before focusing grid
                gridContainerRefs.current
                    .get(`${activeGrid.gridDef.batchId}_${activeGrid.gridDef.resultId}`)
                    ?.current?.scrollIntoView({ behavior: "smooth", block: "center" });

                const gridToFocus = gridRefs.current[newIndex];
                if (gridToFocus) {
                    gridToFocus.focusGrid();
                    handled = true;
                }
            }

            if (handled) {
                event.stopPropagation();
                event.preventDefault();
            }
        };
        document.addEventListener("keydown", handler, true);
        return () => {
            document.removeEventListener("keydown", handler, true);
        };
    }, [keyBindings, gridList, getActiveGrid, viewMode, maximizedGridKey]);

    const handleToggleMaximize = (gridKey: string) => {
        const isAlreadyMaximized = maximizedGridKey === gridKey;
        const newMaximizedKey = isAlreadyMaximized ? undefined : gridKey;
        setMaximizedGridKey(newMaximizedKey);

        // Also scroll the grid into view when minimized
        if (isAlreadyMaximized) {
            const gridContainer = document.getElementById(gridKey);

            requestAnimationFrame(() => {
                gridContainer?.scrollIntoView({ behavior: "instant", block: "center" });
            });
        }

        // Persist to backend
        void context.extensionRpc.sendNotification(qr.SetMaximizedGridNotification.type, {
            uri: uri,
            gridId: newMaximizedKey ?? "",
        });
    };

    const handleCommandBarKeyDown = useCallback(
        (event: React.KeyboardEvent, gridIndex: number) => {
            if (!event.shiftKey || event.key !== "Tab") {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            gridRefs.current[gridIndex]?.focusGrid();
        },
        [gridRefs],
    );

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!event.shiftKey || event.key !== "Tab") {
                return;
            }

            const activeElement = document.activeElement as HTMLElement | null;
            const commandBar = activeElement?.closest<HTMLElement>(
                '[data-query-result-command-bar="true"]',
            );
            if (!commandBar) {
                return;
            }

            for (let i = 0; i < gridList.length; i++) {
                const item = gridList[i];
                const gridKey = `${item.batchId}_${item.resultId}`;
                const resultSetContainer = document.getElementById(gridKey);
                if (!resultSetContainer?.contains(commandBar)) {
                    continue;
                }

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                gridRefs.current[i]?.focusGrid();
                return;
            }
        };

        document.addEventListener("keydown", handler, true);
        return () => {
            document.removeEventListener("keydown", handler, true);
        };
    }, [gridList, gridRefs]);

    const persistGridPaneScrollPosition = useMemo(
        () =>
            debounce((scrollTop: number) => {
                void context.extensionRpc.sendNotification(
                    qr.SetGridPaneScrollPositionNotification.type,
                    {
                        uri: uri,
                        scrollTop: scrollTop,
                    },
                );
            }, 100),
        [context.extensionRpc, uri],
    );

    // Observe container height
    useEffect(() => {
        const observer = new ResizeObserver((entries) => {
            for (let entry of entries) {
                if (entry.target === gridViewContainerRef.current) {
                    const newHeight = entry.contentRect.height;
                    setGridViewContainerHeight(newHeight);
                }
            }
        });
        if (gridViewContainerRef.current) {
            observer.observe(gridViewContainerRef.current);
        }
        return () => {
            observer.disconnect();
        };
    }, [gridViewContainerRef]);

    useEffect(() => {
        const container = gridViewContainerRef.current;
        if (!container) {
            return;
        }

        const handleScroll = () => {
            persistGridPaneScrollPosition(container.scrollTop);
        };

        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", handleScroll);
            persistGridPaneScrollPosition.cancel();
        };
    }, [persistGridPaneScrollPosition]);

    return (
        <div className={classes.gridViewContainer} ref={gridViewContainerRef}>
            {gridList.map((item, index) => {
                const gridKey = `${item.batchId}_${item.resultId}`;
                const containerRef =
                    gridContainerRefs.current.get(gridKey) ||
                    (() => {
                        const ref = createRef<HTMLDivElement>();
                        gridContainerRefs.current.set(gridKey, ref);
                        return ref;
                    })();

                const isMaximized = maximizedGridKey === gridKey;
                const shouldHide = maximizedGridKey !== undefined && !isMaximized;
                /**
                 * When a grid is minimized, we unmount it to allow it to re-measure its dimensions
                 * when it is restored. This ensures that the grid layout is correct based on the
                 * available space and restores its column dimensions properly.
                 */
                if (shouldHide) {
                    return undefined;
                }

                const gridLineClass = `results-grid--gridlines-${gridSettings?.showGridLines ?? "both"}`;
                const gridClasses = [
                    classes.gridContainer,
                    gridSettings?.alternatingRowColors ? "results-grid--alternating" : "",
                    gridLineClass,
                ]
                    .filter(Boolean)
                    .join(" ");
                const rowCount = resultSetSummaries?.[item.batchId]?.[item.resultId]?.rowCount ?? 0;
                const gridHeight = gridHeights[index] ?? naturalHeight(rowCount);

                return (
                    <div
                        key={gridKey}
                        id={gridKey}
                        className={gridClasses}
                        style={
                            {
                                fontFamily: fontSettings?.fontFamily
                                    ? fontSettings.fontFamily
                                    : "var(--vscode-editor-font-family)",
                                fontSize: `${fontSettings?.fontSize ?? 12}px`,
                                height: isMaximized ? "100%" : `${gridHeight}px`,
                                paddingRight: showExternalCommandBar ? undefined : 0,
                                "--results-row-padding": `${gridSettings?.rowPadding ?? 0}px`,
                            } as React.CSSProperties
                        }>
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                minHeight: 0,
                                height: "100%",
                                overflow: "hidden",
                            }}
                            ref={containerRef}>
                            <GridComponent
                                gridId={gridKey}
                                key={gridKey}
                                gridParentRef={containerRef}
                                ref={(gridRef) => {
                                    gridRefs.current[index] = gridRef ?? undefined;
                                }}
                                batchId={item.batchId}
                                resultId={item.resultId}
                                viewMode={viewMode}
                                canToggleMaximize={
                                    viewMode === qr.QueryResultViewMode.Grid && gridList.length > 1
                                }
                                isMaximized={isMaximized}
                                onToggleMaximize={() => handleToggleMaximize(gridKey)}
                            />
                        </div>
                        {showExternalCommandBar && (
                            <CommandBar
                                uri={uri}
                                resultSetSummary={resultSetSummaries[item.batchId][item.resultId]}
                                viewMode={viewMode}
                                onToggleMaximize={() => handleToggleMaximize(gridKey)}
                                onKeyDownCapture={(event) => handleCommandBarKeyDown(event, index)}
                                isMaximized={isMaximized}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
};
