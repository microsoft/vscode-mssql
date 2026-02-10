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
import { makeStyles, Text } from "@fluentui/react-components";
import { useProfilerSelector } from "./profilerSelector";
import { useProfilerContext } from "./profilerStateProvider";
import { ProfilerToolbar } from "./profilerToolbar";
import { ProfilerFilterDialog } from "./profilerFilterDialog";
import { ColumnFilterPopover } from "./components";
import "../../media/table.css"; // For slick-header-filterbutton styling
import {
    SessionState,
    ProfilerNotifications,
    FetchRowsResponse,
    NewEventsAvailableParams,
    RowsRemovedParams,
    FilterClause,
    DistinctValuesResponseParams,
    ColumnFilterCriteria,
} from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { locConstants } from "../../common/locConstants";
import { resolveVscodeThemeType } from "../../common/utils";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";

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
    if (value === undefined || value === null) {
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

    const totalRowCount = useProfilerSelector((s) => s.totalRowCount ?? 0);
    const clearGeneration = useProfilerSelector((s) => s.clearGeneration ?? 0);
    const sessionState = useProfilerSelector((s) => s.sessionState ?? SessionState.NotStarted);
    const viewConfig = useProfilerSelector((s) => s.viewConfig);
    const viewId = useProfilerSelector((s) => s.viewId);
    const availableViews = useProfilerSelector((s) => s.availableViews);
    const availableTemplates = useProfilerSelector((s) => s.availableTemplates);
    const availableSessions = useProfilerSelector((s) => s.availableSessions);
    const selectedSessionId = useProfilerSelector((s) => s.selectedSessionId);
    const autoScroll = useProfilerSelector((s) => s.autoScroll ?? true);
    const isCreatingSession = useProfilerSelector((s) => s.isCreatingSession ?? false);
    const filterState = useProfilerSelector(
        (s) => s.filterState ?? { enabled: false, clauses: [] },
    );

    // Legacy filter active (filter dialog clauses)
    const hasLegacyClauses = filterState.enabled && filterState.clauses.length > 0;

    // Quick filter value from state
    const quickFilterValue = filterState.quickFilter ?? "";

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
        setQuickFilter,
        clearAllFilters,
        applyColumnFilter,
        clearColumnFilter,
        getDistinctValues,
    } = useProfilerContext();
    const { themeKind, extensionRpc } = useVscodeWebview2();

    const reactGridRef = useRef<SlickgridReactInstance | null>(null);
    const [localRowCount, setLocalRowCount] = useState(0);
    const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
    const [isGridReady, setIsGridReady] = useState(false); // Track when grid is ready
    const isFetchingRef = useRef(false);
    const pendingFetchRef = useRef<{ startIndex: number; count: number } | null>(null);
    const autoScrollRef = useRef(autoScroll);
    const fetchRowsRef = useRef(fetchRows);
    const lastClearGenerationRef = useRef(clearGeneration);

    // Column filter state - tracks which column's popover is open
    const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
    // Distinct values are populated by the DistinctValuesResponse notification handler
    const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});

    // Get column filter criteria from state
    const columnFilters = filterState.columnFilters ?? {};

    // Check if any column filter is active
    const hasColumnFilters = Object.keys(columnFilters).length > 0;

    // Combined filter active check (any filter type)
    const isFilterActive = hasLegacyClauses || quickFilterValue.length > 0 || hasColumnFilters;

    // Refs for filter state access in event handlers
    const filterStateRef = useRef(filterState);
    useEffect(() => {
        filterStateRef.current = filterState;
    }, [filterState]);

    // Inject SlickGrid styles on mount
    useEffect(() => {
        injectSlickGridStyles();
    }, []);

    // Keep refs in sync with current values
    useEffect(() => {
        autoScrollRef.current = autoScroll;
    }, [autoScroll]);

    useEffect(() => {
        fetchRowsRef.current = fetchRows;
    }, [fetchRows]);

    // Handle clear when clearGeneration changes (ensures RingBuffer is cleared before we reset local index)
    useEffect(() => {
        if (clearGeneration !== lastClearGenerationRef.current) {
            // Generation changed, meaning a clear happened - now safe to reset local state
            lastClearGenerationRef.current = clearGeneration;
            if (reactGridRef.current?.dataView) {
                reactGridRef.current.dataView.setItems([]);
            }
            setLocalRowCount(0);
            isFetchingRef.current = false;
            pendingFetchRef.current = null;
            // Don't fetch here - NewEventsAvailable notification from extension will handle it
        }
    }, [clearGeneration]);

    /**
     * Opens the filter dialog with the specified column pre-selected
     * @param field The field name of the column to pre-select
     */
    const openFilterForColumn = useCallback((field: string) => {
        setOpenFilterColumn(field);
        // Request distinct values for the column
        getDistinctValues(field);
    }, [getDistinctValues]);

    // Store the callback in a ref so we can access it from the grid event handler
    const openFilterForColumnRef = useRef(openFilterForColumn);
    useEffect(() => {
        openFilterForColumnRef.current = openFilterForColumn;
    }, [openFilterForColumn]);

    // Mapping of column IDs to filter button elements
    const columnFilterButtonMapping = useRef<Map<string, HTMLElement>>(new Map());

    /**
     * Gets the filter button element for a column by looking it up in the DOM.
     * This is more reliable than using stored references which can become stale.
     */
    const getFilterButtonForColumn = useCallback((field: string): HTMLElement | null => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return null;
        }
        const gridContainer = grid.getContainerNode();
        const headerCell = gridContainer?.querySelector(
            `.slick-header-column[data-id="${field}"]`,
        );
        if (!headerCell) {
            return null;
        }
        return headerCell.querySelector(".slick-header-filterbutton") as HTMLElement | null;
    }, []);

    // Grid ready callback - stores the grid reference and triggers setup
    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;
        setIsGridReady(true);
    }

    // Set up header cell rendering after grid is initialized
    useEffect(() => {
        if (!isGridReady) {
            return;
        }

        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return;
        }

        // Subscribe to header cell rendered event to add filter buttons
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handleHeaderCellRendered = (_e: any, args: { column: Column; node: HTMLElement }) => {
            const column = args.column;
            if (!column || column.filterable === false) {
                return;
            }

            // Skip if filter button already added
            if (args.node.classList.contains("slick-header-with-filter")) {
                return;
            }

            // Add class to enable flexbox layout (same pattern as QueryResult)
            args.node.classList.add("slick-header-with-filter");

            // Add theme class for proper icon coloring
            const theme = resolveVscodeThemeType(themeKind);
            args.node.classList.add(theme);

            // Add tooltip and aria-label to the column name element
            const columnNameElement = args.node.querySelector(".slick-column-name");
            if (columnNameElement) {
                const columnName = column.name as string;
                columnNameElement.setAttribute("title", columnName);
                columnNameElement.setAttribute("aria-label", columnName);
            }

            // Check if this column has an active filter
            const hasActiveFilter = filterStateRef.current.columnFilters?.[column.field as string] !== undefined;

            // Create filter button (same class as QueryResult for consistent styling)
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
                openFilterForColumnRef.current(fieldName);
            });

            // Append filter button to the header cell (same as QueryResult pattern)
            args.node.appendChild(filterButton);

            // Store reference for later updates
            columnFilterButtonMapping.current.set(column.id as string, filterButton);
        };

        // Clean up filter buttons when header cell is destroyed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handleBeforeHeaderCellDestroy = (_e: any, args: { column: Column; node: HTMLElement }) => {
            const filterButton = args.node.querySelector(".slick-header-filterbutton");
            if (filterButton) {
                filterButton.remove();
            }
            args.node.classList.remove("slick-header-with-filter");
            const columnId = args.column?.id as string;
            if (columnId) {
                columnFilterButtonMapping.current.delete(columnId);
            }
        };

        grid.onHeaderCellRendered.subscribe(handleHeaderCellRendered);
        grid.onBeforeHeaderCellDestroy.subscribe(handleBeforeHeaderCellDestroy);

        // Force re-render of headers after subscribing to the event
        // This is needed because headers may have already been rendered before we subscribed
        const currentColumns = grid.getColumns();
        if (currentColumns.length > 0) {
            grid.setColumns(currentColumns);
        }

        // Cleanup
        return () => {
            grid.onHeaderCellRendered.unsubscribe(handleHeaderCellRendered);
            grid.onBeforeHeaderCellDestroy.unsubscribe(handleBeforeHeaderCellDestroy);
        };
    }, [isGridReady, themeKind]); // Re-run when grid is ready or theme changes

    // Update filter button states when filter state changes
    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return;
        }

        const gridContainer = grid.getContainerNode();
        const headerContainer = gridContainer?.querySelector(".slick-header-columns");
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

            const hasActiveFilter = filterState.columnFilters?.[column.field as string] !== undefined;

            if (hasActiveFilter) {
                filterButton.classList.add("filtered");
            } else {
                filterButton.classList.remove("filtered");
            }
        });
    }, [filterState]);

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

                        const newCount = dataView.getItemCount();
                        setLocalRowCount(newCount);

                        // Auto-scroll if enabled
                        if (autoScrollRef.current && grid) {
                            grid.scrollRowToTop(newCount - 1);
                        }
                    }
                }

                // Process pending fetch if any - recalculate based on current count
                if (pendingFetchRef.current) {
                    const currentCount = dataView.getItemCount();
                    const targetTotalCount = pendingFetchRef.current.count;
                    pendingFetchRef.current = null;

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

        // Handle clear grid notification
        extensionRpc.onNotification(ProfilerNotifications.ClearGrid, () => {
            if (reactGridRef.current?.dataView) {
                reactGridRef.current.dataView.setItems([]);
            }
            setLocalRowCount(0);
            isFetchingRef.current = false;
            pendingFetchRef.current = null;
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

        // Handle distinct values response notification
        extensionRpc.onNotification(
            ProfilerNotifications.DistinctValuesResponse,
            (params: DistinctValuesResponseParams) => {
                setDistinctValues((prev) => ({
                    ...prev,
                    [params.field]: params.values,
                }));
            },
        );
    }, []);

    // Handle scroll event for infinite scroll
    const handleScroll = useCallback(
        (event: CustomEvent) => {
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
                if (currentCount < totalRowCount) {
                    fetchRows(currentCount, FETCH_SIZE);
                    isFetchingRef.current = true;
                }
            }
        },
        [fetchRows, totalRowCount],
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
                // Calculate minimum width based on header length + filter button width (24px)
                // Approximate 7px per character for the header text
                const headerMinWidth = Math.max(80, (col.header?.length ?? 0) * 7 + 28);
                // Ensure width is at least headerMinWidth
                const effectiveWidth = Math.max(col.width ?? headerMinWidth, headerMinWidth);
                return {
                    id: col.field,
                    name: col.header,
                    field: col.field,
                    width: effectiveWidth,
                    sortable: col.sortable ?? false,
                    filterable: col.filterable ?? true,
                    resizable: true,
                    minWidth: headerMinWidth,
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

    // Grid options
    const gridOptions: GridOption = useMemo(
        () => ({
            autoResize: {
                container: "#profilerGridContainer",
                calculateAvailableSizeBy: "container",
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
            rowHeight: 25,
            headerRowHeight: 30,
            showHeaderRow: false,
            forceFitColumns: false,
            darkMode: themeKind === ColorThemeKind.Dark,
        }),
        [themeKind],
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

    /**
     * Handles quick filter value changes from the toolbar.
     * @param value The new quick filter value
     */
    const handleQuickFilterChange = useCallback(
        (value: string) => {
            setQuickFilter(value);
        },
        [setQuickFilter],
    );

    /**
     * Handles applying filter clauses from the filter dialog.
     * @param clauses The filter clauses to apply
     */
    const handleApplyFilter = useCallback(
        (clauses: FilterClause[]) => {
            applyFilter(clauses);
            setIsFilterDialogOpen(false);
        },
        [applyFilter],
    );

    /**
     * Handles clearing all active filters from the toolbar.
     * Removes quick filter, all column filters, and legacy filter clauses.
     */
    const handleClearFilter = useCallback(() => {
        clearAllFilters();
        setIsFilterDialogOpen(false);
    }, [clearAllFilters]);

    /**
     * Closes the column filter popover.
     */
    const handleCloseColumnFilter = useCallback(() => {
        setOpenFilterColumn(null);
    }, []);

    /**
     * Applies a column filter criteria.
     * @param criteria The filter criteria to apply
     */
    const handleApplyColumnFilter = useCallback(
        (criteria: ColumnFilterCriteria) => {
            applyColumnFilter(criteria.field, criteria);
            setOpenFilterColumn(null);
        },
        [applyColumnFilter],
    );

    /**
     * Clears the filter for a specific column.
     * @param field The field name of the column to clear
     */
    const handleClearColumnFilter = useCallback(
        (field: string) => {
            clearColumnFilter(field);
            setOpenFilterColumn(null);
        },
        [clearColumnFilter],
    );

    // Get filtered row count from state
    const filteredRowCount = useProfilerSelector((s) => s.filteredRowCount ?? s.totalRowCount ?? 0);

    // Get the column definition for the currently open filter
    const openFilterColumnDef = useMemo(() => {
        if (!openFilterColumn || !viewConfig?.columns) {
            return undefined;
        }
        return viewConfig.columns.find((col) => col.field === openFilterColumn);
    }, [openFilterColumn, viewConfig?.columns]);

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
                quickFilterValue={quickFilterValue}
                totalRowCount={totalRowCount}
                filteredRowCount={filteredRowCount}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onStart={handleStart}
                onPauseResume={handlePauseResume}
                onStop={handleStop}
                onClear={handleClear}
                onViewChange={handleViewChange}
                onAutoScrollToggle={handleAutoScrollToggle}
                onQuickFilterChange={handleQuickFilterChange}
                onClearFilter={handleClearFilter}
            />
            <ProfilerFilterDialog
                columns={viewConfig?.columns ?? []}
                currentClauses={filterState.clauses}
                isFilterActive={hasLegacyClauses}
                isOpen={isFilterDialogOpen}
                onOpenChange={setIsFilterDialogOpen}
                onApplyFilter={handleApplyFilter}
                onClearFilter={handleClearFilter}
            />
            <div id="profilerGridContainer" className={classes.profilerGridContainer}>
                <SlickgridReact
                    gridId="profilerGrid"
                    columns={columns}
                    options={gridOptions}
                    dataset={EMPTY_DATASET}
                    onReactGridCreated={(e) => reactGridReady(e.detail)}
                    onScroll={handleScroll}
                />
                {/* Column filter popover - rendered when a filter button is clicked */}
                {openFilterColumn && openFilterColumnDef && (
                    <ColumnFilterPopover
                        column={openFilterColumnDef}
                        currentCriteria={columnFilters[openFilterColumn]}
                        distinctValues={distinctValues[openFilterColumn] ?? []}
                        isOpen={true}
                        anchorElement={getFilterButtonForColumn(openFilterColumn)}
                        onOpenChange={(open) => {
                            if (!open) {
                                handleCloseColumnFilter();
                            }
                        }}
                        onApply={handleApplyColumnFilter}
                        onClear={() => handleClearColumnFilter(openFilterColumn)}
                    />
                )}
                {/* Empty state message when filters active but no results */}
                {filteredRowCount === 0 && isFilterActive && (
                    <div className={classes.emptyStateOverlay}>
                        <Text>{locConstants.profiler.noFilterResults}</Text>
                    </div>
                )}
            </div>
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
    profilerGridContainer: {
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        padding: "0",
        margin: "8px",
        marginTop: "0",
        width: "calc(100% - 16px)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        position: "relative",
    },
    emptyStateOverlay: {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        backgroundColor: "var(--vscode-editor-background)",
        padding: "16px 24px",
        borderRadius: "4px",
        border: "1px solid var(--vscode-panel-border)",
        zIndex: 10,
        textAlign: "center",
    },
});

// Global styles for SlickGrid that need to be injected as CSS
// These use CSS custom properties with --slick- prefix which makeStyles doesn't support well
const slickGridStyles = `
#profilerGrid {
    /* Main grid colors */
    --slick-cell-even-background-color: var(--vscode-editor-background);
    --slick-cell-odd-background-color: var(--vscode-editor-background);
    --slick-row-mouse-hover-color: var(--vscode-list-hoverBackground);
    --slick-cell-selected-color: var(--vscode-list-activeSelectionBackground);
    --slick-cell-text-color: var(--vscode-foreground);
    --slick-grid-header-background: var(--vscode-editor-background);
    --slick-grid-header-text-color: var(--vscode-foreground);
    --slick-grid-header-column-width: auto;
    --slick-header-row-border-color: var(--vscode-panel-border);

    /* Border colors */
    --slick-border-color: var(--vscode-editorWidget-border);
    --slick-cell-border-right: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-top: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-bottom: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-left: 0;

    /* Column picker colors */
    --slick-column-picker-background-color: var(--vscode-menu-background);
    --slick-column-picker-item-color: var(--vscode-menu-foreground);
    --slick-column-picker-item-hover-color: var(--vscode-menu-selectionBackground);
    --slick-column-picker-border-color: var(--vscode-menu-border);

    /* Scrollbar colors */
    --slick-scrollbar-background: var(--vscode-scrollbar-background);
    --slick-scrollbar-thumb-background: var(--vscode-scrollbarSlider-background);
    --slick-scrollbar-thumb-hover-background: var(--vscode-scrollbarSlider-hoverBackground);
    --slick-scrollbar-thumb-active-background: var(--vscode-scrollbarSlider-activeBackground);

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
