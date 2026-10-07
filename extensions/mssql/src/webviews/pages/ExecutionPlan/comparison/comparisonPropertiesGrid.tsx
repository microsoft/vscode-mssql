/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    createTableColumn,
    TableColumnDefinition,
    TableColumnSizingOptions,
    TableRowData,
    useFluent,
    useRestoreFocusTarget,
    useScrollbarWidth,
} from "@fluentui/react-components";
import {
    ArrowBidirectionalLeftRight16Regular,
    ChevronDown16Regular,
    ChevronLeft16Regular,
    ChevronRight16Regular,
    Dismiss16Regular,
    MoreHorizontal16Regular,
} from "@fluentui/react-icons";
// The header must come from this package too: only its header scrolls along with the body.
import {
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
} from "@fluentui-contrib/react-data-grid-react-window";
import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { ExecutionPlanNode } from "../../../../sharedInterfaces/executionPlan";
import { locConstants } from "../../../common/locConstants";
import { PropertyValueDialog } from "../propertyValueDialog";
import {
    buildExecutionPlanComparisonPropertyRows,
    ComparisonOrientation,
    ComparisonSide,
    ExecutionPlanComparisonPropertyRow,
    ExecutionPlanComparisonPropertySort,
    filterComparisonPropertyRows,
    flattenComparisonPropertyRows,
    sortComparisonPropertyRows,
} from "./comparisonModel";

type PropertyGroup = "different" | "equivalent";
type GridItem =
    | { kind: "group"; id: PropertyGroup; label: string; open: boolean }
    | { kind: "property"; id: string; row: ExecutionPlanComparisonPropertyRow };

const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 28;
const COMPARISON_COLUMN_WIDTH = 40;
const NAME_COLUMN_MIN_WIDTH = 110;
const VALUE_COLUMN_MIN_WIDTH = 90;
const openGroupsByDefault: Readonly<Record<PropertyGroup, boolean>> = {
    different: true,
    equivalent: false,
};

/**
 * Fits the columns to the grid, with equal value columns. Fluent's own fitting gives all spare
 * width to the last column and takes it back from there first, which starves one plan's values.
 */
function getColumnSizing(width: number): TableColumnSizingOptions {
    const remaining = Math.max(0, width - COMPARISON_COLUMN_WIDTH);
    const name = Math.max(NAME_COLUMN_MIN_WIDTH, Math.round(remaining * 0.36));
    const primary = Math.max(VALUE_COLUMN_MIN_WIDTH, Math.floor((remaining - name) / 2));
    const secondary = Math.max(VALUE_COLUMN_MIN_WIDTH, remaining - name - primary);
    const column = (minWidth: number, idealWidth: number) => ({
        minWidth,
        defaultWidth: idealWidth,
        idealWidth,
        // Cells use border-box sizing, so their padding is already inside the column width.
        padding: 0,
    });
    return {
        name: column(NAME_COLUMN_MIN_WIDTH, name),
        primary: column(VALUE_COLUMN_MIN_WIDTH, primary),
        comparison: column(COMPARISON_COLUMN_WIDTH, COMPARISON_COLUMN_WIDTH),
        secondary: column(VALUE_COLUMN_MIN_WIDTH, secondary),
    };
}

function HeaderLabel({ label }: { label: string }) {
    return (
        <span className="execution-plan-comparison-grid-header-text" title={label}>
            {label}
        </span>
    );
}

function ComparisonIcon({ row }: { row: ExecutionPlanComparisonPropertyRow }) {
    const label =
        row.comparison === "greater"
            ? locConstants.executionPlan.greaterThan
            : row.comparison === "less"
              ? locConstants.executionPlan.lessThan
              : row.comparison === "different"
                ? locConstants.executionPlan.notEqual
                : "";
    return (
        <span
            className={`execution-plan-comparison-diff execution-plan-comparison-diff-${row.comparison}`}
            title={label}
            aria-label={label}>
            {row.comparison === "greater" ? (
                <ChevronRight16Regular />
            ) : row.comparison === "less" ? (
                <ChevronLeft16Regular />
            ) : row.comparison === "different" ? (
                <Dismiss16Regular />
            ) : undefined}
        </span>
    );
}

interface ComparisonPropertiesGridProps {
    primary: ExecutionPlanNode | undefined;
    secondary: ExecutionPlanNode | undefined;
    filter: string;
    sort: ExecutionPlanComparisonPropertySort;
    orientation: ComparisonOrientation;
}

/**
 * The properties of the two selected operators, side by side: differences first, then the
 * collapsed equivalent ones. Nested properties expand like a tree.
 */
export function ComparisonPropertiesGrid({
    primary,
    secondary,
    filter,
    sort,
    orientation,
}: ComparisonPropertiesGridProps) {
    const [openGroups, setOpenGroups] = useState(openGroupsByDefault);
    const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [fullValue, setFullValue] = useState<{ name: string; value: string }>();
    const containerRef = useRef<HTMLDivElement>(null);
    const fullValueButtonRef = useRef<HTMLButtonElement | undefined>(undefined);
    const restoreFocusTargetAttribute = useRestoreFocusTarget()["data-tabster"];
    const { targetDocument } = useFluent();
    const scrollbarWidth = useScrollbarWidth({ targetDocument }) ?? 0;
    const isFiltering = filter.trim().length > 0;
    const isExpanded = useCallback(
        // A filter reveals the nested rows it matched.
        (row: ExecutionPlanComparisonPropertyRow) => isFiltering || expandedIds.has(row.id),
        [expandedIds, isFiltering],
    );

    const rows = useMemo(
        () => buildExecutionPlanComparisonPropertyRows(primary?.properties, secondary?.properties),
        [primary, secondary],
    );
    const items = useMemo<GridItem[]>(() => {
        const visibleRows = sortComparisonPropertyRows(
            filterComparisonPropertyRows(rows, filter),
            sort,
        );
        const groups: [PropertyGroup, ExecutionPlanComparisonPropertyRow[]][] = [
            ["different", visibleRows.filter((row) => row.hasDifference)],
            ["equivalent", visibleRows.filter((row) => !row.hasDifference)],
        ];
        return groups.flatMap(([group, groupRows]): GridItem[] => {
            if (groupRows.length === 0) {
                return [];
            }
            const label =
                group === "different"
                    ? locConstants.executionPlan.differentProperties(groupRows.length)
                    : locConstants.executionPlan.equivalentProperties(groupRows.length);
            const open = openGroups[group];
            const groupItems = open
                ? flattenComparisonPropertyRows(groupRows, isExpanded).map(
                      (row): GridItem => ({ kind: "property", id: row.id, row }),
                  )
                : [];
            return [{ kind: "group", id: group, label, open }, ...groupItems];
        });
    }, [filter, isExpanded, openGroups, rows, sort]);

    const rowsOverflow = items.length * ROW_HEIGHT > size.height - HEADER_HEIGHT;
    const columnSizing = useMemo(
        () => getColumnSizing(size.width - (rowsOverflow ? scrollbarWidth : 0)),
        [size.width, rowsOverflow, scrollbarWidth],
    );

    useEffect(() => {
        setOpenGroups(openGroupsByDefault);
        setExpandedIds(new Set());
    }, [primary?.id, secondary?.id]);

    useEffect(() => {
        if (!containerRef.current) {
            return;
        }
        const observer = new ResizeObserver(([entry]) =>
            setSize({
                width: Math.floor(entry.contentRect.width),
                height: entry.contentRect.height,
            }),
        );
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const toggleGroup = useCallback(
        (group: PropertyGroup) =>
            setOpenGroups((current) => ({ ...current, [group]: !current[group] })),
        [],
    );
    const setRowExpanded = useCallback((id: string, expanded: boolean) => {
        setExpandedIds((current) => {
            if (current.has(id) === expanded) {
                return current;
            }
            const next = new Set(current);
            if (expanded) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);
    const closeFullValue = useCallback(() => {
        setFullValue(undefined);
        requestAnimationFrame(() => {
            const button = fullValueButtonRef.current;
            if (button?.isConnected) {
                // Focusing the row reveals its buttons before returning focus to the opener.
                button.closest<HTMLElement>('[role="row"]')?.focus({ preventScroll: true });
                button.focus({ preventScroll: true });
            }
        });
    }, []);

    const renderNameCell = useCallback(
        (item: GridItem) => {
            if (item.kind === "group") {
                return (
                    <DataGridCell className="execution-plan-comparison-grid-group-cell">
                        <button
                            className="execution-plan-comparison-group-button"
                            type="button"
                            aria-expanded={item.open}
                            onClick={() => toggleGroup(item.id)}>
                            {item.open ? (
                                <ChevronDown16Regular aria-hidden />
                            ) : (
                                <ChevronRight16Regular aria-hidden />
                            )}
                            {item.label}
                        </button>
                    </DataGridCell>
                );
            }
            const { row } = item;
            const expanded = isExpanded(row);
            return (
                <DataGridCell>
                    <div
                        className="execution-plan-comparison-grid-name"
                        style={{ paddingLeft: `${row.level * 14}px` }}>
                        {row.children.length > 0 ? (
                            <Button
                                appearance="subtle"
                                size="small"
                                className="execution-plan-comparison-disclosure"
                                aria-label={
                                    expanded
                                        ? locConstants.executionPlan.collapse
                                        : locConstants.executionPlan.expand
                                }
                                aria-expanded={expanded}
                                disabled={isFiltering}
                                icon={
                                    expanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />
                                }
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setRowExpanded(row.id, !expanded);
                                }}
                            />
                        ) : (
                            <span
                                className="execution-plan-comparison-disclosure-spacer"
                                aria-hidden
                            />
                        )}
                        <span className="execution-plan-comparison-grid-text" title={row.name}>
                            {row.name}
                        </span>
                    </div>
                </DataGridCell>
            );
        },
        [isExpanded, isFiltering, setRowExpanded, toggleGroup],
    );

    const renderValueCell = useCallback(
        (item: GridItem, side: ComparisonSide) => {
            if (item.kind !== "property") {
                return <DataGridCell />;
            }
            const { row } = item;
            const value = side === "primary" ? row.primaryValue : row.secondaryValue;
            const present = side === "primary" ? row.inPrimary : row.inSecondary;
            return (
                <DataGridCell className="execution-plan-comparison-grid-value" data-side={side}>
                    {!present ? (
                        <span
                            className="execution-plan-comparison-grid-missing"
                            title={locConstants.executionPlan.propertyNotInPlan}>
                            <span aria-hidden>—</span>
                            <span className="execution-plan-comparison-visually-hidden">
                                {locConstants.executionPlan.propertyNotInPlan}
                            </span>
                        </span>
                    ) : (
                        <div className="execution-plan-comparison-grid-value-content" title={value}>
                            <span className="execution-plan-comparison-grid-text">{value}</span>
                            {value && (
                                <Button
                                    data-tabster={restoreFocusTargetAttribute}
                                    appearance="subtle"
                                    size="small"
                                    className="execution-plan-comparison-view-value"
                                    icon={<MoreHorizontal16Regular />}
                                    title={locConstants.executionPlan.viewFullValue(row.name)}
                                    aria-label={locConstants.executionPlan.viewFullValue(row.name)}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        fullValueButtonRef.current = event.currentTarget;
                                        setFullValue({ name: row.name, value });
                                    }}
                                />
                            )}
                        </div>
                    )}
                </DataGridCell>
            );
        },
        [restoreFocusTargetAttribute],
    );

    const columns = useMemo<TableColumnDefinition<GridItem>[]>(() => {
        const stacked = orientation === "stacked";
        const primaryLabel = stacked
            ? locConstants.executionPlan.valueTopPlan
            : locConstants.executionPlan.valueLeftPlan;
        const secondaryLabel = stacked
            ? locConstants.executionPlan.valueBottomPlan
            : locConstants.executionPlan.valueRightPlan;
        return [
            createTableColumn({
                columnId: "name",
                renderHeaderCell: () => <HeaderLabel label={locConstants.executionPlan.name} />,
                renderCell: renderNameCell,
            }),
            createTableColumn({
                columnId: "primary",
                renderHeaderCell: () => <HeaderLabel label={primaryLabel} />,
                renderCell: (item) => renderValueCell(item, "primary"),
            }),
            createTableColumn({
                columnId: "comparison",
                renderHeaderCell: () => (
                    <span
                        className="execution-plan-comparison-grid-header-icon"
                        title={locConstants.executionPlan.comparison}>
                        <ArrowBidirectionalLeftRight16Regular aria-hidden />
                        <span className="execution-plan-comparison-visually-hidden">
                            {locConstants.executionPlan.comparison}
                        </span>
                    </span>
                ),
                renderCell: (item) => (
                    <DataGridCell className="execution-plan-comparison-grid-comparison">
                        {item.kind === "property" ? <ComparisonIcon row={item.row} /> : undefined}
                    </DataGridCell>
                ),
            }),
            createTableColumn({
                columnId: "secondary",
                renderHeaderCell: () => <HeaderLabel label={secondaryLabel} />,
                renderCell: (item) => renderValueCell(item, "secondary"),
            }),
        ];
    }, [orientation, renderNameCell, renderValueCell]);

    const handleRowKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>, row: ExecutionPlanComparisonPropertyRow) => {
            if (event.target !== event.currentTarget || row.children.length === 0 || isFiltering) {
                return;
            }
            const expanded = expandedIds.has(row.id);
            if (
                (event.key === "ArrowRight" && !expanded) ||
                (event.key === "ArrowLeft" && expanded)
            ) {
                event.preventDefault();
                event.stopPropagation();
                setRowExpanded(row.id, !expanded);
            }
        },
        [expandedIds, isFiltering, setRowExpanded],
    );

    const renderRow = useCallback(
        ({ item, rowId }: TableRowData<GridItem>, style: CSSProperties): ReactNode => (
            <DataGridRow<GridItem>
                key={rowId}
                className={
                    item.kind === "group" ? "execution-plan-comparison-grid-group-row" : undefined
                }
                aria-level={item.kind === "property" ? item.row.level + 1 : undefined}
                aria-expanded={
                    item.kind === "property" && item.row.children.length > 0
                        ? isExpanded(item.row)
                        : undefined
                }
                onKeyDown={
                    item.kind === "property"
                        ? (event: ReactKeyboardEvent<HTMLDivElement>) =>
                              handleRowKeyDown(event, item.row)
                        : undefined
                }
                style={style}>
                {({ renderCell }) => <>{renderCell(item)}</>}
            </DataGridRow>
        ),
        [handleRowKeyDown, isExpanded],
    );

    return (
        <div ref={containerRef} className="execution-plan-comparison-property-grid-container">
            {size.height > HEADER_HEIGHT && (
                <DataGrid
                    className="execution-plan-comparison-property-grid"
                    items={items}
                    columns={columns}
                    getRowId={(item) => item.id}
                    size="small"
                    focusMode="composite"
                    role="treegrid"
                    resizableColumns
                    resizableColumnsOptions={{ autoFitColumns: false }}
                    columnSizingOptions={columnSizing}
                    aria-label={locConstants.executionPlan.comparisonProperties}>
                    <DataGridHeader className="execution-plan-comparison-grid-header">
                        <DataGridRow>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<GridItem>
                        itemSize={ROW_HEIGHT}
                        height={size.height - HEADER_HEIGHT}
                        width="100%">
                        {renderRow}
                    </DataGridBody>
                </DataGrid>
            )}
            <PropertyValueDialog property={fullValue} onClose={closeFullValue} />
        </div>
    );
}
