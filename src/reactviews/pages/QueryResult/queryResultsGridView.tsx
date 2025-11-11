/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { createRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import * as qr from "../../../sharedInterfaces/queryResult";
import CommandBar from "./commandBar";
import ResultGrid, { ResultGridHandle } from "./resultGrid";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { eventMatchesShortcut } from "../../common/keyboardUtils";
import { WebviewAction } from "../../../sharedInterfaces/webview";

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
    },
});

type GridItem = { batchId: number; resultId: number; index: number };

const ROW_HEIGHT = 26;
const HEADER = 30;
export const MARGIN_BOTTOM = 10;
export const MAXIMUMG_GRID_HEIGHT_PX = 300;

export const QueryResultsGridView = () => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return;
    }
    const uri = useQueryResultSelector((state) => state.uri);
    const resultSetSummaries = useQueryResultSelector((state) => state.resultSetSummaries);
    const viewMode =
        useQueryResultSelector((state) => state.tabStates?.resultViewMode) ??
        qr.QueryResultViewMode.Grid;
    const fontSettings = useQueryResultSelector((state) => state.fontSettings);
    const tabStates = useQueryResultSelector((state) => state.tabStates);

    const gridViewContainerRef = useRef<HTMLDivElement>(null);
    const [gridViewContainerHeight, setGridViewContainerHeight] = useState<number>(0);
    const gridContainerRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(new Map());
    const [maximizedGridKey, setMaximizedGridKey] = useState<string | undefined>(undefined);
    const gridRefs = useRef<Array<ResultGridHandle | undefined>>([]);
    const { keyBindings } = useVscodeWebview2();

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
        return HEADER + rowCount * ROW_HEIGHT + MARGIN_BOTTOM;
    }

    const gridHeights: number[] = useMemo(() => {
        if (!gridViewContainerHeight || gridList?.length === 0) {
            return [];
        }

        const naturalHeights = gridList.map((it) =>
            naturalHeight(resultSetSummaries?.[it.batchId]?.[it.resultId]?.rowCount ?? 0),
        );

        const equalHeights = gridViewContainerHeight / gridList.length;

        return gridList.map((_, i) =>
            Math.min(
                naturalHeights[i],
                Math.max(equalHeights, Math.min(gridViewContainerHeight, MAXIMUMG_GRID_HEIGHT_PX)),
            ),
        );
    }, [gridList, gridViewContainerHeight]);

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
    }, [gridList, gridContainerRefs, gridRefs]);

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

    return (
        <div
            className={classes.gridViewContainer}
            ref={gridViewContainerRef}
            onScroll={async (e) => {
                await context.extensionRpc.sendNotification(
                    qr.SetGridPaneScrollPositionNotification.type,
                    {
                        uri: uri,
                        scrollTop: e.currentTarget.scrollTop,
                    },
                );
            }}>
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

                return (
                    <div
                        key={gridKey}
                        id={gridKey}
                        className={classes.gridContainer}
                        style={{
                            fontFamily: fontSettings.fontFamily
                                ? fontSettings.fontFamily
                                : "var(--vscode-font-family)",
                            fontSize: `${fontSettings.fontSize ?? 12}px`,
                            height: `${maximizedGridKey === gridKey ? `100%` : `${gridHeights[index]}px`}`,
                        }}>
                        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }} ref={containerRef}>
                            <ResultGrid
                                gridId={gridKey}
                                key={gridKey}
                                gridParentRef={containerRef}
                                ref={(gridRef) => {
                                    gridRefs.current[index] = gridRef ?? undefined;
                                }}
                                batchId={item.batchId}
                                resultId={item.resultId}
                            />
                        </div>
                        <CommandBar
                            uri={uri}
                            resultSetSummary={resultSetSummaries[item.batchId][item.resultId]}
                            viewMode={viewMode}
                            onToggleMaximize={() => handleToggleMaximize(gridKey)}
                            isMaximized={isMaximized}
                        />
                    </div>
                );
            })}
        </div>
    );
};
