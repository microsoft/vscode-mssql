/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useMemo, useEffect, useCallback, useState } from "react";
import {
    SlickgridReact,
    SlickgridReactInstance,
    Column,
    GridOption,
    Formatters,
    Formatter,
} from "slickgrid-react";
import { makeStyles, shorthands } from "@fluentui/react-components";
import {
    Panel,
    PanelGroup,
    PanelResizeHandle,
    ImperativePanelHandle,
} from "react-resizable-panels";
import { useProfilerSelector } from "./profilerSelector";
import { useProfilerContext } from "./profilerStateProvider";
import { ProfilerToolbar } from "./profilerToolbar";
import { ProfilerColumnFilterPopover, getFilterType } from "./profilerColumnFilterPopover";
import { ProfilerActiveFiltersBar } from "./profilerActiveFiltersBar";
import { ProfilerDetailsPanel } from "./profilerDetailsPanel";
import {
    SessionState,
    ProfilerNotifications,
    FetchRowsResponse,
    NewEventsAvailableParams,
    RowsRemovedParams,
    FilterClause,
    FilterType,
    ProfilerColumnDef,
    SortDirection,
    SortState,
    createDataViewSortFn,
    getNextSortState,
} from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { locConstants } from "../../common/locConstants";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";
import "./profiler.css";

/** Number of rows to fetch per request */
const FETCH_SIZE = 100;

/** Stable empty array to prevent SlickgridReact from resetting DataView on re-renders */
const EMPTY_DATASET: never[] = [];

/** Module-level flag to ensure handlers are registered only once per webview lifecycle */
let notificationHandlersRegistered = false;

/**
 * Formatter for optional numeric fields - shows empty string for undefined/null
 */
const optionalNumberFormatter: Formatter = (_row, _cell, value) => {
    if (value === undefined) {
        return "";
    }
    return String(value);
};

/**
 * Fields that should use the timestamp formatter (using built-in Formatters.date with custom format)
 */
const TIMESTAMP_FIELDS = ["timestamp"];

/**
 * Date format for timestamp columns - includes milliseconds using Tempo format tokens
 * Format: YYYY-MM-DD HH:mm:ss.SSS
 */
const TIMESTAMP_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS";

/**
 * Fields that should use the optional number formatter (may be undefined)
 */
const OPTIONAL_NUMBER_FIELDS = ["spid", "duration", "cpu", "reads", "writes"];

/**
 * Stable fallback for filterState selector to avoid creating a new object reference
 * on every selector invocation when state.filterState is undefined.
 */
const EMPTY_FILTER_STATE = Object.freeze({ enabled: false, clauses: [] });

/**
 * Gets the appropriate formatter configuration for a field
 * Returns an object with formatter and optional params
 */
function getFormatterConfig(
    field: string,
): { formatter: Formatter; params?: Record<string, unknown> } | undefined {
    if (TIMESTAMP_FIELDS.includes(field)) {
        return {
            formatter: Formatters.date,
            params: { dateFormat: TIMESTAMP_DATE_FORMAT },
        };
    }
    if (OPTIONAL_NUMBER_FIELDS.includes(field)) {
        return { formatter: optionalNumberFormatter };
    }
    return undefined;
}

// Inject SlickGrid styles once
let stylesInjected = false;
function injectSlickGridStyles() {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;
    const styleElement = document.createElement("style");
    styleElement.textContent = slickGridStyles;
    document.head.appendChild(styleElement);
}

export const Profiler: React.FC = () => {
    const classes = useStyles();

    // Inject SlickGrid styles on mount
    useEffect(() => {
        injectSlickGridStyles();
    }, []);

    const totalRowCount = useProfilerSelector((s) => s.totalRowCount ?? 0);
    const clearGeneration = useProfilerSelector((s) => s.clearGeneration ?? 0);
    const sessionState = useProfilerSelector((s) => s.sessionState ?? SessionState.NotStarted);

    // Deep-equality comparisons for object selectors to prevent referential instability
    // caused by JSON serialization/deserialization on every state push from extension.
    const viewConfig = useProfilerSelector(
        (s) => s.viewConfig,
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );
    const viewId = useProfilerSelector((s) => s.viewId);
    const availableViews = useProfilerSelector((s) => s.availableViews);
    const availableTemplates = useProfilerSelector((s) => s.availableTemplates);
    const availableSessions = useProfilerSelector((s) => s.availableSessions);
    const selectedSessionId = useProfilerSelector((s) => s.selectedSessionId);
    const autoScroll = useProfilerSelector((s) => s.autoScroll ?? true);
    const isCreatingSession = useProfilerSelector((s) => s.isCreatingSession ?? false);
    const filterState = useProfilerSelector(
        (s) => s.filterState ?? EMPTY_FILTER_STATE,
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    const isFilterActive =
        (filterState.enabled && filterState.clauses.length > 0) ||
        (filterState.quickFilter !== undefined && filterState.quickFilter.trim() !== "");
    const isReadOnly = useProfilerSelector((s) => s.isReadOnly ?? false);
    const selectedEvent = useProfilerSelector((s) => s.selectedEvent);
    const xelFileName = useProfilerSelector((s) => s.xelFileName);

    const {
        pauseResume,
        stop,
        createSession,
        startSession,
        selectSession,
        clearEvents,
        changeView,
        toggleAutoScroll,
        fetchRows,
        applyFilter,
        clearFilter,
        setQuickFilter,
        getDistinctValues,
        selectRow,
        openInEditor,
        copyToClipboard,
        closeDetailsPanel,
        exportToCsv,
    } = useProfilerContext();
    const { themeKind, extensionRpc } = useVscodeWebview();

    const reactGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const [localRowCount, setLocalRowCount] = useState(0);

    // Sort state — only one column can be sorted at a time
    const [sortState, setSortState] = useState<SortState | undefined>(undefined);

    // Popover state
    const [popoverColumn, setPopoverColumn] = useState<ProfilerColumnDef | undefined>(undefined);
    const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | undefined>(undefined);
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);

    // Distinct values for categorical filter — fetched from extension (unfiltered ring buffer)
    const [popoverDistinctValues, setPopoverDistinctValues] = useState<string[]>([]);

    const gridPanelRef = useRef<ImperativePanelHandle | null>(null);
    const detailsPanelRef = useRef<ImperativePanelHandle | null>(null);
    const [isDetailsPanelMaximized, setIsDetailsPanelMaximized] = useState(false);
    const showDetailsPanel = selectedEvent !== undefined;
    const resizeRafRef = useRef<number | null>(null);
    const isFetchingRef = useRef(false);
    const pendingFetchRef = useRef<{ startIndex: number; count: number } | undefined>(undefined);
    const autoScrollRef = useRef(autoScroll);
    const fetchRowsRef = useRef(fetchRows);
    const lastClearGenerationRef = useRef(clearGeneration);
    const sortStateRef = useRef(sortState);
    const totalRowCountRef = useRef(totalRowCount);
    const isPopoverOpenRef = useRef(isPopoverOpen);

    // Keep refs in sync with current values
    useEffect(() => {
        autoScrollRef.current = autoScroll;
    }, [autoScroll]);

    useEffect(() => {
        fetchRowsRef.current = fetchRows;
    }, [fetchRows]);

    // Keep sort state ref in sync
    useEffect(() => {
        sortStateRef.current = sortState;
    }, [sortState]);

    useEffect(() => {
        totalRowCountRef.current = totalRowCount;
    }, [totalRowCount]);

    useEffect(() => {
        isPopoverOpenRef.current = isPopoverOpen;
    }, [isPopoverOpen]);

    /**
     * Schedules a deferred full SlickGrid resize using requestAnimationFrame.
     * Uses resizerService.resizeGrid() which:
     *   1. Reads the container's (#profilerGridContainer) current inner height
     *   2. Sets the grid DOM element's style.height to match
     *   3. Calls grid.resizeCanvas() to recalculate the internal viewport
     * This is the same resize path that fires on window resize / container
     * observation and is the only way to get the grid to shrink/grow its
     * outer element when the available space changes.
     *
     * Multiple calls within the same animation frame are coalesced.
     */
    const scheduleGridResize = useCallback(() => {
        if (resizeRafRef.current !== null) {
            cancelAnimationFrame(resizeRafRef.current);
        }
        resizeRafRef.current = requestAnimationFrame(() => {
            resizeRafRef.current = null;
            const resizerService = reactGridRef.current?.resizerService;
            if (resizerService) {
                // Full resize: measure container → set grid height → resizeCanvas
                void resizerService.resizeGrid();
            }
        });
    }, []);

    // Clean up pending rAF on unmount
    useEffect(() => {
        return () => {
            if (resizeRafRef.current !== null) {
                cancelAnimationFrame(resizeRafRef.current);
            }
        };
    }, []);

    // Resize grid panel when details panel visibility changes
    useEffect(() => {
        if (gridPanelRef.current) {
            if (showDetailsPanel) {
                // Details panel is showing, resize grid to 50%
                gridPanelRef.current.resize(50);
            } else {
                // Details panel is hidden, expand grid to 100%
                gridPanelRef.current.resize(100);
                // Reset maximized state when panel is closed
                setIsDetailsPanelMaximized(false);
            }
        }
        // Ensure SlickGrid redraws after the panel layout settles
        scheduleGridResize();
    }, [showDetailsPanel, scheduleGridResize]);

    // Handle clear when clearGeneration changes (ensures RingBuffer is cleared before we reset local index)
    useEffect(() => {
        if (clearGeneration !== lastClearGenerationRef.current) {
            // Generation changed, meaning a clear happened - now safe to reset local state
            lastClearGenerationRef.current = clearGeneration;
            if (reactGridRef.current?.dataView) {
                reactGridRef.current.dataView.setItems([]);
            }
            setLocalRowCount(0);
            setSortState(undefined);
            isFetchingRef.current = false;
            pendingFetchRef.current = undefined;
            // Don't fetch here - NewEventsAvailable notification from extension will handle it
        }
    }, [clearGeneration]);

    /**
     * Opens the column filter popover anchored to the funnel button.
     * @param field The field name of the column
     * @param buttonElement The funnel button element for anchor positioning
     */
    const openFilterForColumn = useCallback(
        (field: string, buttonElement: HTMLElement) => {
            const colDef = viewConfig?.columns?.find((c) => c.field === field);
            if (!colDef) {
                return;
            }
            setPopoverColumn(colDef);
            setPopoverAnchorRect(buttonElement.getBoundingClientRect());
            setIsPopoverOpen(true);

            // Request distinct values from extension (scans unfiltered ring buffer)
            const filterType = getFilterType(colDef);
            if (filterType === FilterType.Categorical) {
                void getDistinctValues(field).then((response) => {
                    setPopoverDistinctValues(response.values);
                });
            }
        },
        [viewConfig, getDistinctValues],
    );

    // Store the callback in a ref so we can access it from the grid event handler
    const openFilterForColumnRef = useRef(openFilterForColumn);
    useEffect(() => {
        openFilterForColumnRef.current = openFilterForColumn;
    }, [openFilterForColumn]);

    /**
     * Handle sort button click — cycles through NONE → ASC → DESC → NONE.
     * Only one column can be sorted at a time.
     */
    const handleSortClick = useCallback((field: string) => {
        setSortState((prevSort) => getNextSortState(prevSort, field));
    }, []);

    // Store sort click handler in a ref for access in header cell renderer
    const handleSortClickRef = useRef(handleSortClick);
    useEffect(() => {
        handleSortClickRef.current = handleSortClick;
    }, [handleSortClick]);

    // Store filter state in ref for access in header cell renderer
    const filterStateRef = useRef(filterState);
    useEffect(() => {
        filterStateRef.current = filterState;
    }, [filterState]);

    // Grid ready callback
    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;

        // Subscribe to header cell rendered event to add filter buttons
        const grid = reactGrid.slickGrid;

        if (grid) {
            grid.onHeaderCellRendered.subscribe((_e, args) => {
                const column = args.column;
                // Only add sort/filter buttons to filterable columns
                if (column.filterable === false) {
                    return;
                }

                // Check if filter class already added (buttons already exist)
                if (args.node.classList.contains("slick-header-with-filter")) {
                    return;
                }

                // Add class to enable flexbox layout (same pattern as QueryResult)
                args.node.classList.add("slick-header-with-filter");

                // Add tooltip and aria-label to the column name element
                const columnNameElement = args.node.querySelector(".slick-column-name");
                if (columnNameElement) {
                    const columnName = column.name as string;
                    columnNameElement.setAttribute("title", columnName);
                    columnNameElement.setAttribute("aria-label", columnName);
                }

                // Check if this column has an active filter
                const hasActiveFilter = filterStateRef.current.clauses.some(
                    (clause) => clause.field === column.field,
                );

                // Apply filtered class to header cell for text color
                if (hasActiveFilter) {
                    args.node.classList.add("slick-header-column-filtered");
                }

                // --- Sort button (appended FIRST, appears BEFORE filter icon) ---
                const sortButton = document.createElement("button");
                sortButton.className = "slick-header-sortbutton";
                const currentSort = sortStateRef.current;
                if (currentSort && currentSort.field === column.field) {
                    if (currentSort.direction === SortDirection.ASC) {
                        sortButton.classList.add("sorted-asc");
                    } else if (currentSort.direction === SortDirection.DESC) {
                        sortButton.classList.add("sorted-desc");
                    }
                }
                sortButton.setAttribute("aria-label", locConstants.profiler.sortTooltip);
                sortButton.setAttribute("title", locConstants.profiler.sortTooltip);
                sortButton.tabIndex = -1;

                const sortFieldName = column.field as string;
                sortButton.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleSortClickRef.current(sortFieldName);
                });

                args.node.appendChild(sortButton);

                // --- Filter button (appended SECOND, appears AFTER sort icon) ---
                const filterButton = document.createElement("button");
                filterButton.id = "filter-btn";
                filterButton.className = `slick-header-filterbutton${hasActiveFilter ? " filtered" : ""}`;
                filterButton.setAttribute("aria-label", locConstants.profiler.filterTooltip);
                filterButton.setAttribute("title", locConstants.profiler.filterTooltip);
                filterButton.tabIndex = -1;

                // Store the field name on the button for the click handler
                const fieldName = column.field as string;
                filterButton.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openFilterForColumnRef.current(fieldName, filterButton);
                });

                // Append filter button to the header cell (same as QueryResult pattern)
                args.node.appendChild(filterButton);
            });

            // Clean up sort and filter buttons when header cell is destroyed
            grid.onBeforeHeaderCellDestroy.subscribe((_e, args) => {
                const sortButton = args.node.querySelector(".slick-header-sortbutton");
                if (sortButton) {
                    sortButton.remove();
                }
                const filterButton = args.node.querySelector(".slick-header-filterbutton");
                if (filterButton) {
                    filterButton.remove();
                }
                args.node.classList.remove("slick-header-with-filter");
            });

            // Force re-render of headers after subscribing to the event
            // This is needed because headers may have already been rendered before we subscribed
            const currentColumns = grid.getColumns();
            if (currentColumns.length > 0) {
                grid.setColumns(currentColumns);
            }
        }
    }

    // Memoized callback for onReactGridCreated to prevent SlickgridReact re-renders
    const handleReactGridCreated = useCallback((e: CustomEvent) => reactGridReady(e.detail), []);

    // Update filter button states when filter state changes
    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return;
        }

        // Get all filter buttons and update their filtered state
        const headerContainer = grid.getContainerNode()?.querySelector(".slick-header-columns");
        if (!headerContainer) {
            return;
        }

        const gridColumns = grid.getColumns();
        gridColumns.forEach((column) => {
            const headerCell = headerContainer.querySelector(
                `.slick-header-column[data-id="${column.id}"]`,
            );
            if (!headerCell) {
                return;
            }

            const filterButton = headerCell.querySelector(".slick-header-filterbutton");
            if (!filterButton) {
                return;
            }

            const hasActiveFilter = filterState.clauses.some(
                (clause) => clause.field === column.field,
            );

            if (hasActiveFilter) {
                filterButton.classList.add("filtered");
                headerCell.classList.add("slick-header-column-filtered");
            } else {
                filterButton.classList.remove("filtered");
                headerCell.classList.remove("slick-header-column-filtered");
            }
        });
    }, [filterState]);

    // Apply sort to DataView, invalidate the grid, and update header icons
    // whenever sortState changes (click, filter reset, clear, view change).
    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        const dataView = reactGridRef.current?.dataView;
        if (!grid || !dataView) {
            return;
        }

        // 1. Sort the DataView (natural order when sortState is undefined)
        const sortFn = createDataViewSortFn(sortState);
        dataView.sort(sortFn, true);

        // 2. Force the grid to repaint all rows so the new order is visible
        grid.invalidateAllRows();
        grid.render();

        // 3. Update sort-button CSS classes in every header cell
        const headerContainer = grid.getContainerNode()?.querySelector(".slick-header-columns");
        if (headerContainer) {
            const gridColumns = grid.getColumns();
            gridColumns.forEach((column) => {
                const headerCell = headerContainer.querySelector(
                    `.slick-header-column[data-id="${column.id}"]`,
                );
                if (!headerCell) {
                    return;
                }

                const sortButton = headerCell.querySelector(".slick-header-sortbutton");
                if (!sortButton) {
                    return;
                }

                sortButton.classList.remove("sorted-asc", "sorted-desc");
                if (sortState && sortState.field === column.field) {
                    if (sortState.direction === SortDirection.ASC) {
                        sortButton.classList.add("sorted-asc");
                    } else if (sortState.direction === SortDirection.DESC) {
                        sortButton.classList.add("sorted-desc");
                    }
                }
            });
        }
    }, [sortState]);

    // Register notification handlers ONCE per webview lifecycle
    useEffect(() => {
        // Use module-level flag to absolutely prevent duplicate registrations
        if (notificationHandlersRegistered) {
            return;
        }
        notificationHandlersRegistered = true;

        // Handle rows received from extension
        extensionRpc.onNotification(
            ProfilerNotifications.RowsAvailable,
            (response: FetchRowsResponse) => {
                isFetchingRef.current = false;

                if (!reactGridRef.current?.dataView) {
                    return;
                }

                const dataView = reactGridRef.current.dataView;
                const grid = reactGridRef.current.slickGrid;

                // Add new rows to the DataView
                if (response.rows.length > 0) {
                    // Filter out duplicates - only add rows that don't already exist
                    const newRows = response.rows.filter((row) => !dataView.getItemById(row.id));

                    if (newRows.length > 0) {
                        // Use beginUpdate/endUpdate to lock the DataView during add
                        dataView.beginUpdate();
                        dataView.addItems(newRows);
                        dataView.endUpdate();

                        // Re-sort if a sort is active so new rows are in the correct position
                        const currentSort = sortStateRef.current;
                        if (currentSort) {
                            dataView.reSort();
                            grid.invalidateAllRows();
                            grid.render();
                        }

                        const newCount = dataView.getItemCount();
                        setLocalRowCount(newCount);

                        // Auto-scroll if enabled (scroll to bottom for natural order,
                        // or just stay at bottom when sorted — user scrolls manually)
                        if (autoScrollRef.current && grid && !currentSort) {
                            grid.scrollRowToTop(newCount - 1);
                        }
                    }
                }

                // Process pending fetch if any - recalculate based on current count
                if (pendingFetchRef.current) {
                    const currentCount = dataView.getItemCount();
                    const targetTotalCount = pendingFetchRef.current.count;
                    pendingFetchRef.current = undefined;

                    // Only fetch if there's still data we don't have
                    const eventsToFetch = targetTotalCount - currentCount;
                    if (eventsToFetch > 0) {
                        fetchRowsRef.current(currentCount, eventsToFetch);
                        isFetchingRef.current = true;
                    }
                }
            },
        );

        // Handle new events notification from extension
        extensionRpc.onNotification(
            ProfilerNotifications.NewEventsAvailable,
            (params: NewEventsAvailableParams) => {
                if (!reactGridRef.current?.dataView) {
                    return;
                }

                const currentCount = reactGridRef.current.dataView.getItemCount();
                const eventsToFetch = params.totalCount - currentCount;

                if (eventsToFetch > 0) {
                    if (isFetchingRef.current) {
                        // Queue the target total - we'll recalculate startIndex when processing
                        pendingFetchRef.current = {
                            startIndex: 0,
                            count: params.totalCount,
                        };
                    } else {
                        fetchRowsRef.current(currentCount, eventsToFetch);
                        isFetchingRef.current = true;
                    }
                }
            },
        );

        // Handle clear grid notification (fires on filter apply/clear/quick-filter and explicit clear).
        // Resets sort to default so the newly-filtered data appears in natural order.
        extensionRpc.onNotification(ProfilerNotifications.ClearGrid, () => {
            if (reactGridRef.current?.dataView) {
                reactGridRef.current.dataView.setItems([]);
            }
            setLocalRowCount(0);
            setSortState(undefined);
            isFetchingRef.current = false;
            pendingFetchRef.current = undefined;
        });

        // Handle rows removed notification (ring buffer overflow)
        extensionRpc.onNotification(
            ProfilerNotifications.RowsRemoved,
            (params: RowsRemovedParams) => {
                if (!reactGridRef.current?.dataView) {
                    return;
                }

                const dataView = reactGridRef.current.dataView;

                // Remove items from DataView by their IDs
                dataView.beginUpdate();
                dataView.deleteItems(params.removedRowIds);
                dataView.endUpdate();

                // Update local row count
                const newCount = dataView.getItemCount();
                setLocalRowCount(newCount);
            },
        );
    }, []);

    /**
     * Handles closing the popover without applying.
     */
    const handlePopoverClose = useCallback(() => {
        setIsPopoverOpen(false);
        setPopoverColumn(undefined);
        setPopoverAnchorRect(undefined);
    }, []);

    // Store handlePopoverClose in a ref so handleScroll never needs to be recreated for it
    const handlePopoverCloseRef = useRef(handlePopoverClose);
    useEffect(() => {
        handlePopoverCloseRef.current = handlePopoverClose;
    }, [handlePopoverClose]);

    // Close popover when grid scrolls horizontally (FR-016)
    // Uses refs for all values that change frequently (totalRowCount, isPopoverOpen, fetchRows)
    // so that the callback identity remains stable and SlickgridReact doesn't re-render.
    const handleScroll = useCallback(
        (event: CustomEvent) => {
            // Close popover on any scroll
            if (isPopoverOpenRef.current) {
                handlePopoverCloseRef.current();
            }

            const args = event.detail?.args;
            if (!args || !reactGridRef.current?.dataView) {
                return;
            }

            const viewportElm = args.grid.getViewportNode();
            if (!viewportElm) {
                return;
            }

            // Check if scrolled to bottom
            const isAtBottom =
                Math.ceil(viewportElm.offsetHeight + args.scrollTop) >= args.scrollHeight;

            if (isAtBottom && !isFetchingRef.current) {
                const currentCount = reactGridRef.current.dataView.getItemCount();
                // Only fetch if there's more data available
                if (currentCount < totalRowCountRef.current) {
                    fetchRowsRef.current(currentCount, FETCH_SIZE);
                    isFetchingRef.current = true;
                }
            }
        },
        [], // Stable callback — all changing values are accessed via refs
    );

    // Convert view config columns to SlickGrid column definitions
    const columns: Column[] = useMemo(() => {
        if (!viewConfig?.columns) {
            // Default single column if no view config
            return [
                {
                    id: "eventClass",
                    name: "Event",
                    field: "eventClass",
                    sortable: false,
                    filterable: true,
                    resizable: true,
                    minWidth: 200,
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                },
            ];
        }

        return [
            ...viewConfig.columns.map((col) => {
                const formatterConfig = getFormatterConfig(col.field);
                return {
                    id: col.field,
                    name: col.header,
                    field: col.field,
                    width: col.width,
                    sortable: false, // Sorting disabled for profiler grid
                    filterable: col.filterable ?? true, // Default to filterable
                    resizable: true,
                    minWidth: 50,
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                    ...(formatterConfig && {
                        formatter: formatterConfig.formatter,
                        ...(formatterConfig.params && { params: formatterConfig.params }),
                    }),
                };
            }),
        ];
    }, [viewConfig]);

    // Re-render headers when view actually changes (different viewId).
    // This must NOT depend on `columns` or `viewConfig` because those objects
    // are recreated on every state push (JSON deserialization). Using the
    // primitive `viewId` ensures this effect only runs when the user switches views.
    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return;
        }
        // Reset sort when view changes — sorted column may no longer exist
        setSortState(undefined);
        // Force re-render of headers to add sort + filter buttons to new columns
        const currentColumns = grid.getColumns();
        if (currentColumns.length > 0) {
            grid.setColumns(currentColumns);
        }
    }, [viewId]);

    // Grid options
    const gridOptions: GridOption = useMemo(
        () => ({
            autoResize: {
                container: "#profilerGridContainer",
                calculateAvailableSizeBy: "container",
                resizeDetection: "container",
                bottomPadding: 0,
                minHeight: 50,
            },
            enableAutoResize: true,
            enableCellNavigation: true,
            enableColumnReorder: true,
            enableSorting: false,
            enableFiltering: false,
            enablePagination: false,
            enableColumnPicker: false, // Hide column picker menu
            enableGridMenu: false, // Hide grid menu (hamburger menu)
            enableHeaderMenu: false, // Hide header menu (column hide/show)
            enableAutoTooltip: true, // Enable tooltips to show cell values on hover
            enableExcelCopyBuffer: true, // Enable cell range selection (multi-cell select + copy)
            enableTextSelectionOnCells: false, // Disable native text selection so cell range selection works
            rowHeight: 25,
            headerRowHeight: 30,
            showHeaderRow: false,
            forceFitColumns: false,
            alwaysShowVerticalScroll: true, // Always show vertical scrollbar to keep header/row alignment
            darkMode: themeKind === ColorThemeKind.Dark,
            emptyDataWarning: {
                message: isFilterActive
                    ? locConstants.profiler.noResultsMatchFilter
                    : locConstants.profiler.noDataToDisplay,
            },
        }),
        [themeKind, isFilterActive],
    );

    // Toolbar handlers
    const handleNewSession = () => {
        // The extension will handle showing quick picks for template and session name
        // We just need to signal that the user wants to create a new session
        void createSession("", ""); // Empty values signal to extension to show quick picks
    };

    const handleSelectSession = (sessionId: string) => {
        selectSession(sessionId);
    };

    const handleStart = () => {
        if (selectedSessionId) {
            void startSession(selectedSessionId);
        }
    };

    const handlePauseResume = () => {
        void pauseResume();
    };

    const handleStop = () => {
        void stop();
    };

    const handleClear = () => {
        clearEvents(localRowCount);
    };

    const handleViewChange = (newViewId: string) => {
        void changeView(newViewId);
    };

    const handleAutoScrollToggle = () => {
        toggleAutoScroll();
    };

    // ─── Popover handlers ─────────────────────────────────────────────────

    /**
     * Current filter clause for the popover column (if any).
     */
    const popoverCurrentClause = useMemo(() => {
        if (!popoverColumn) {
            return undefined;
        }
        return filterState.clauses.find((c) => c.field === popoverColumn.field);
    }, [popoverColumn, filterState.clauses]);

    /**
     * Handles applying a filter from the popover for a specific column.
     * Merges the new clause into the existing clauses array.
     */
    const handlePopoverApply = useCallback(
        (clause: FilterClause) => {
            // Replace any existing clause for this field, or add a new one
            const otherClauses = filterState.clauses.filter((c) => c.field !== clause.field);
            applyFilter([...otherClauses, clause]);
            handlePopoverClose();
        },
        [filterState.clauses, applyFilter, handlePopoverClose],
    );

    /**
     * Handles clearing the filter for a specific column from the popover.
     */
    const handlePopoverClear = useCallback(() => {
        if (!popoverColumn) {
            return;
        }
        const remainingClauses = filterState.clauses.filter((c) => c.field !== popoverColumn.field);
        if (remainingClauses.length === 0) {
            clearFilter();
        } else {
            applyFilter(remainingClauses);
        }
        handlePopoverClose();
    }, [popoverColumn, filterState.clauses, applyFilter, clearFilter, handlePopoverClose]);

    /**
     * Handles quick filter changes from the toolbar.
     */
    const handleQuickFilterChange = useCallback(
        (term: string) => {
            setQuickFilter(term);
        },
        [setQuickFilter],
    );

    /**
     * Handles clearing all filters (clauses + quick filter) from the toolbar.
     */
    const handleClearFilter = useCallback(() => {
        clearFilter();
        setQuickFilter("");
    }, [clearFilter, setQuickFilter]);

    /**
     * Handles removing a single column's filter from the active filters bar.
     */
    const handleRemoveColumnFilter = useCallback(
        (field: string) => {
            const remainingClauses = filterState.clauses.filter((c) => c.field !== field);
            if (remainingClauses.length === 0) {
                clearFilter();
            } else {
                applyFilter(remainingClauses);
            }
        },
        [filterState.clauses, applyFilter, clearFilter],
    );

    // Handlers for embedded details panel
    const handleOpenInEditor = useCallback(
        (textData: string, eventName?: string) => {
            openInEditor(textData, eventName);
        },
        [openInEditor],
    );

    const handleCopy = useCallback(
        (text: string) => {
            copyToClipboard(text);
        },
        [copyToClipboard],
    );

    const handleToggleMaximize = useCallback(() => {
        if (detailsPanelRef.current) {
            if (isDetailsPanelMaximized) {
                detailsPanelRef.current.resize(50);
            } else {
                detailsPanelRef.current.resize(80);
            }
            setIsDetailsPanelMaximized(!isDetailsPanelMaximized);
            scheduleGridResize();
        }
    }, [isDetailsPanelMaximized, scheduleGridResize]);

    const handleCloseDetailsPanel = useCallback(() => {
        setIsDetailsPanelMaximized(false);
        closeDetailsPanel();
        scheduleGridResize();
    }, [closeDetailsPanel, scheduleGridResize]);

    // Handle row selection (click or keyboard navigation) to show details in the panel
    const handleRowSelection = useCallback(
        (rowIndex: number) => {
            if (!reactGridRef.current?.dataView) {
                return;
            }

            const dataView = reactGridRef.current.dataView;
            const item = dataView.getItem(rowIndex);

            if (item && item.id) {
                selectRow(item.id);
            }
        },
        [selectRow],
    );

    // Handle row click to show details in the panel
    const handleRowClick = useCallback(
        (event: CustomEvent) => {
            const args = event.detail?.args;
            if (!args) {
                return;
            }
            handleRowSelection(args.row);
        },
        [handleRowSelection],
    );

    // Handle active cell change (keyboard navigation) to show details in the panel
    const handleActiveCellChanged = useCallback(
        (event: CustomEvent) => {
            const args = event.detail?.args;
            if (!args || args.row === undefined || args.row === null) {
                return;
            }
            handleRowSelection(args.row);
        },
        [handleRowSelection],
    );
    /**
     * Handle export to CSV request.
     * The extension generates the filename and CSV from the session's RingBuffer.
     */
    const handleExportToCsv = useCallback(() => {
        exportToCsv();
    }, [exportToCsv]);

    return (
        <div className={classes.profilerContainer}>
            <ProfilerToolbar
                sessionState={sessionState}
                currentViewId={viewId}
                availableViews={availableViews}
                availableTemplates={availableTemplates}
                availableSessions={availableSessions}
                selectedSessionId={selectedSessionId}
                autoScroll={autoScroll}
                isCreatingSession={isCreatingSession}
                isFilterActive={isFilterActive}
                quickFilterTerm={filterState.quickFilter ?? ""}
                isReadOnly={isReadOnly}
                xelFileName={xelFileName}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onStart={handleStart}
                onPauseResume={handlePauseResume}
                onStop={handleStop}
                onClear={handleClear}
                onViewChange={handleViewChange}
                onAutoScrollToggle={handleAutoScrollToggle}
                onClearFilter={handleClearFilter}
                onQuickFilterChange={handleQuickFilterChange}
                totalEventCount={totalRowCount}
                onExportToCsv={handleExportToCsv}
            />
            <ProfilerActiveFiltersBar
                clauses={filterState.clauses}
                columns={viewConfig?.columns ?? []}
                onRemoveFilter={handleRemoveColumnFilter}
            />
            {popoverColumn && (
                <ProfilerColumnFilterPopover
                    column={popoverColumn}
                    anchorRect={popoverAnchorRect}
                    isOpen={isPopoverOpen}
                    currentClause={popoverCurrentClause}
                    distinctValues={popoverDistinctValues}
                    onClose={handlePopoverClose}
                    onApply={handlePopoverApply}
                    onClear={handlePopoverClear}
                />
            )}
            <PanelGroup
                direction="vertical"
                className={classes.panelGroup}
                onLayout={scheduleGridResize}>
                <Panel ref={gridPanelRef} defaultSize={100} minSize={20}>
                    <div id="profilerGridContainer" className={classes.profilerGridContainer}>
                        <SlickgridReact
                            gridId="profilerGrid"
                            columns={columns}
                            options={gridOptions}
                            dataset={EMPTY_DATASET}
                            onReactGridCreated={handleReactGridCreated}
                            onScroll={handleScroll}
                            onClick={handleRowClick}
                            onActiveCellChanged={handleActiveCellChanged}
                        />
                    </div>
                </Panel>
                {showDetailsPanel && (
                    <>
                        <PanelResizeHandle className={classes.resizeHandle} />
                        <Panel
                            ref={detailsPanelRef}
                            defaultSize={50}
                            minSize={15}
                            maxSize={80}
                            className={classes.detailsPanelContainer}>
                            <ProfilerDetailsPanel
                                selectedEvent={selectedEvent}
                                themeKind={themeKind}
                                isMaximized={isDetailsPanelMaximized}
                                onOpenInEditor={handleOpenInEditor}
                                onCopy={handleCopy}
                                onToggleMaximize={handleToggleMaximize}
                                onClose={handleCloseDetailsPanel}
                                isPanelView={false}
                            />
                        </Panel>
                    </>
                )}
            </PanelGroup>
        </div>
    );
};

// #region Styles

const useStyles = makeStyles({
    profilerContainer: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        padding: "0",
        boxSizing: "border-box",
    },
    profilerToolbar: {
        display: "flex",
        alignItems: "center",
        padding: "4px 8px",
        borderBottom: "1px solid var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-editor-background)",
        flexShrink: 0,
    },
    profilerToolbarViewSelector: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginLeft: "8px",
    },
    profilerToolbarLabel: {
        fontSize: "12px",
        color: "var(--vscode-foreground)",
    },
    profilerToolbarInfo: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginLeft: "auto",
        paddingLeft: "16px",
    },
    profilerToolbarSessionName: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        maxWidth: "200px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    profilerToolbarStatus: {
        fontSize: "12px",
        padding: "2px 8px",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
    },
    profilerToolbarEventCount: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    panelGroup: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
        minHeight: 0,
        ...shorthands.overflow("hidden"),
    },
    profilerGridContainer: {
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        padding: "0",
        margin: "8px",
        marginTop: "0",
        width: "calc(100% - 16px)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
    },
    resizeHandle: {
        height: "6px",
        backgroundColor: "var(--vscode-editorWidget-border)",
        cursor: "row-resize",
        flexShrink: 0,
        "&:hover": {
            backgroundColor: "var(--vscode-focusBorder)",
        },
        "&:active": {
            backgroundColor: "var(--vscode-focusBorder)",
        },
    },
    detailsPanelContainer: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
        height: "100%",
    },
});

// Global styles for SlickGrid that need to be injected as CSS
// These use CSS custom properties with --slick- prefix which makeStyles doesn't support well
const slickGridStyles = `
#profilerGrid {
    /* Header colors - --slick-header-background-color is what .slick-header-column reads,
       --slick-grid-header-background is what .slick-header-columns reads */
    --slick-header-background-color: var(--vscode-editor-background);
    --slick-grid-header-background: var(--vscode-editor-background);
    --slick-header-text-color: var(--vscode-foreground);
    --slick-hover-header-color: var(--vscode-foreground);
    --slick-sorting-header-color: var(--vscode-foreground);
    --slick-header-row-background-color: var(--vscode-editor-background);
    --slick-header-column-background-hover: var(--vscode-list-hoverBackground);
    --slick-header-column-background-active: var(--vscode-list-activeSelectionBackground);
    --slick-header-row-border-color: var(--vscode-panel-border);

    /* Cell & row colors */
    --slick-cell-even-background-color: var(--vscode-editor-background);
    --slick-cell-odd-background-color: var(--vscode-editor-background);
    --slick-cell-text-color: var(--vscode-foreground);
    --slick-canvas-bg-color: var(--vscode-editor-background);
    --slick-row-mouse-hover-color: var(--vscode-list-hoverBackground);
    --slick-cell-selected-color: var(--vscode-list-activeSelectionBackground);
    --slick-row-selected-color: var(--vscode-list-activeSelectionBackground);

    /* Border colors */
    --slick-border-color: var(--vscode-editorWidget-border);
    --slick-grid-border-color: var(--vscode-editorWidget-border);
    --slick-cell-border-right: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-top: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-bottom: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-left: 0;
    --slick-container-border-top: 1px solid var(--vscode-editorWidget-border);
    --slick-container-border-bottom: 1px solid var(--vscode-editorWidget-border);

    /* Scrollbar */
    --slick-scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background);

    /* Column picker colors */
    --slick-column-picker-background-color: var(--vscode-menu-background);
    --slick-column-picker-item-color: var(--vscode-menu-foreground);
    --slick-column-picker-item-hover-color: var(--vscode-menu-selectionBackground);
    --slick-column-picker-border-color: var(--vscode-menu-border);
    --slick-menu-bg-color: var(--vscode-menu-background);
    --slick-menu-color: var(--vscode-menu-foreground);
    --slick-menu-border: 1px solid var(--vscode-menu-border);
    --slick-menu-item-hover-color: var(--vscode-menu-selectionBackground);

    flex: 1;
    width: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

/* Auto-hide scrollbars when not needed */
#profilerGrid .slick-viewport {
    overflow: auto !important;
}

/* Ensure internal grid structure fills container */
#profilerGrid .slick-pane {
    flex: 1;
}

#profilerGrid .slick-canvas {
    width: 100%;
    height: 100%;
}

/* Hide scrollbars when content fits */
#profilerGrid .slick-viewport::-webkit-scrollbar {
    width: 14px;
    height: 14px;
}

#profilerGrid .slick-viewport::-webkit-scrollbar-track {
    background-color: transparent;
}

#profilerGrid .slick-viewport::-webkit-scrollbar-thumb {
    background-color: var(--vscode-scrollbarSlider-background);
    border-radius: 7px;
    border: 3px solid transparent;
    background-clip: padding-box;
}

#profilerGrid .slick-viewport::-webkit-scrollbar-thumb:hover {
    background-color: var(--vscode-scrollbarSlider-hoverBackground);
}

#profilerGrid .slick-viewport::-webkit-scrollbar-thumb:active {
    background-color: var(--vscode-scrollbarSlider-activeBackground);
}
`;

// #endregion
