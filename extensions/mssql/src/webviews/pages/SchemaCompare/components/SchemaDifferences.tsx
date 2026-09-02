/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import {
    createTableColumn,
    TableColumnDefinition,
    Checkbox,
    makeStyles,
    Spinner,
    DataGridHeader,
    DataGridHeaderCell,
    Text,
    TableColumnSizingOptions,
    mergeClasses,
    Input,
    Button,
    CounterBadge,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Menu,
    MenuDivider,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
} from "@fluentui/react-components";
import {
    DataGridBody,
    DataGrid,
    DataGridRow,
    DataGridCell,
    RowRenderer,
} from "@fluentui-contrib/react-data-grid-react-window";
import {
    ChevronDownRegular,
    ChevronRightRegular,
    Dismiss12Regular,
    Dismiss16Regular,
    Filter16Regular,
    Search16Regular,
    TextBulletListTree16Regular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { DiffEntry } from "vscode-mssql";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { SchemaCompareGroupBy } from "../SchemaCompare";

type DiffRow = { kind: "diff" } & DiffEntry;
type GroupRow = {
    kind: "group";
    key: string;
    label: string;
    count: number;
    collapsed: boolean;
};
type Row = DiffRow | GroupRow;

interface FilterOption {
    key: string;
    label: string;
    count: number;
}

const FILTER_ROW_HEIGHT = 28;
const FILTER_VISIBLE_ROWS = 5;
const GROUP_BY_MENU_NAME = "schemaCompareGroupBy";

const VirtualizedFilterOptions = (props: {
    options: FilterOption[];
    selected: ReadonlySet<string>;
    onToggle: (key: string) => void;
}) => {
    const classes = useStyles();
    const listRef = React.useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: props.options.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => FILTER_ROW_HEIGHT,
        overscan: 3,
    });
    const height = Math.min(props.options.length, FILTER_VISIBLE_ROWS) * FILTER_ROW_HEIGHT;

    return (
        <div ref={listRef} className={classes.filterList} style={{ height }}>
            <div
                className={classes.filterListContent}
                style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const option = props.options[virtualItem.index];
                    return (
                        <div
                            key={option.key}
                            className={classes.filterOption}
                            style={{
                                height: virtualItem.size,
                                transform: `translateY(${virtualItem.start}px)`,
                            }}>
                            <Checkbox
                                className={classes.filterCheckbox}
                                checked={props.selected.has(option.key)}
                                label={
                                    <span className={classes.filterOptionLabel}>
                                        <span className={classes.filterOptionName}>
                                            {option.label}
                                        </span>
                                        <span className={classes.filterCount}>{option.count}</span>
                                    </span>
                                }
                                onChange={() => props.onToggle(option.key)}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const getLabelForAction = (action: SchemaUpdateAction): string => {
    switch (action) {
        case SchemaUpdateAction.Add:
            return loc.schemaCompare.add;
        case SchemaUpdateAction.Change:
            return loc.schemaCompare.change;
        case SchemaUpdateAction.Delete:
            return loc.schemaCompare.delete;
        default:
            return "";
    }
};

const getActionIndicatorClass = (
    action: SchemaUpdateAction,
    classes: ReturnType<typeof useStyles>,
): string | undefined => {
    switch (action) {
        case SchemaUpdateAction.Add:
            return classes.addIndicator;
        case SchemaUpdateAction.Change:
            return classes.changeIndicator;
        case SchemaUpdateAction.Delete:
            return classes.deleteIndicator;
        default:
            return undefined;
    }
};

const highlightText = (
    text: string,
    searchText: string,
    highlightClassName: string,
): React.ReactNode => {
    const trimmedSearch = searchText.trim();
    if (!trimmedSearch) {
        return text;
    }

    // Escape regular-expression metacharacters so the filter is treated as literal text.
    const escapedSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedSearch})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
        part.toLocaleLowerCase() === trimmedSearch.toLocaleLowerCase() ? (
            <span key={index} className={highlightClassName}>
                {part}
            </span>
        ) : (
            part
        ),
    );
};

const useStyles = makeStyles({
    HeaderCellPadding: {
        padding: "0 8px",
    },
    selectedRow: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
        "& td": {
            backgroundColor: "var(--vscode-list-activeSelectionBackground)",
            color: "var(--vscode-list-activeSelectionForeground)",
        },
    },
    resizableContainer: {
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
    },
    hideTextOverflow: {
        overflow: "hidden",
        whiteSpace: "nowrap",
    },
    alignSpinner: {
        marginLeft: "8px",
    },
    includeCell: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    dataGridHeader: {
        backgroundColor: "var(--vscode-keybindingTable-headerBackground)",
    },
    summaryBar: {
        minHeight: "36px",
        boxSizing: "border-box",
        padding: "4px 8px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-keybindingTable-headerBackground)",
    },
    differencesSummary: {
        flex: "0 0 auto",
        whiteSpace: "nowrap",
    },
    actionSummary: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        color: "var(--vscode-descriptionForeground)",
    },
    summaryIndicator: {
        display: "inline-block",
        flex: "0 0 auto",
        width: "7px",
        height: "7px",
        borderRadius: "2px",
    },
    addIndicator: {
        backgroundColor: "var(--vscode-charts-green)",
    },
    changeIndicator: {
        backgroundColor: "var(--vscode-charts-yellow)",
    },
    deleteIndicator: {
        backgroundColor: "var(--vscode-charts-red)",
    },
    filterInput: {
        flex: "0 1 240px",
        width: "240px",
        minWidth: "120px",
        marginLeft: 0,
    },
    filterControls: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        marginLeft: "auto",
    },
    filterButtonActive: {
        color: "var(--vscode-textLink-foreground)",
    },
    filterButton: {
        columnGap: "6px",
    },
    filterButtonContent: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
    },
    filterSurface: {
        minWidth: "280px",
        padding: "10px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "8px",
        boxShadow: "var(--vscode-widget-shadow)",
    },
    filterPopupHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
    },
    filterPopupBody: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    filterPopupTitle: {
        fontSize: "13px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
    },
    filterCloseButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        borderRadius: "6px",
    },
    filterDivider: {
        height: "1px",
        backgroundColor: "var(--vscode-editorWidget-border)",
        opacity: 0.7,
        margin: "6px 0 8px",
    },
    filterSection: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    filterSectionTitle: {
        fontSize: "11px",
        fontWeight: 600,
        color: "var(--vscode-descriptionForeground)",
    },
    filterSelectAllRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: `${FILTER_ROW_HEIGHT}px`,
        padding: "0 4px 0 0",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
    },
    filterList: {
        position: "relative",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "0 4px",
    },
    filterListContent: {
        position: "relative",
        width: "100%",
    },
    filterOption: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        cursor: "pointer",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    filterCheckbox: {
        minWidth: 0,
        minHeight: "22px",
        height: "22px",
        width: "100%",
        fontSize: "12px",
        "& .fui-Checkbox__indicator": {
            width: "12px",
            height: "12px",
            fontSize: "10px",
            flexShrink: 0,
        },
        "& .fui-Checkbox__label": {
            minWidth: 0,
            width: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    filterOptionLabel: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        width: "100%",
    },
    filterOptionName: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    filterCount: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "11px",
        flexShrink: 0,
        paddingRight: "4px",
    },
    selectedSummary: {
        flex: "0 0 auto",
        whiteSpace: "nowrap",
    },
    actionCell: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
    },
    searchHighlight: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
    },
    groupHeaderRow: {
        backgroundColor: "var(--vscode-sideBarSectionHeader-background)",
        color: "var(--vscode-sideBarSectionHeader-foreground)",
        boxSizing: "border-box",
        borderBottom: "1px solid var(--vscode-sideBarSectionHeader-border)",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    groupHeaderCell: {
        width: "100%",
        height: "100%",
        padding: 0,
    },
    groupHeaderButton: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 8px",
        width: "100%",
        height: "100%",
        background: "transparent",
        border: "none",
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
        textAlign: "left",
        userSelect: "none",
    },
    groupHeaderLabel: {
        fontWeight: 600,
    },
    groupHeaderCount: {
        opacity: 0.75,
    },
    groupHeaderChevron: {
        display: "flex",
        alignItems: "center",
    },
});

interface Props {
    onDiffSelected: (id: number) => void;
    selectedDiffId: number;
    groupBy: SchemaCompareGroupBy;
    onGroupByChange: (value: SchemaCompareGroupBy) => void;
    onNavigableDiffIdsChange: (ids: number[]) => void;
}

export const SchemaDifferences = React.forwardRef<HTMLDivElement, Props>(
    (
        { onDiffSelected, selectedDiffId, groupBy, onGroupByChange, onNavigableDiffIdsChange },
        ref,
    ) => {
        const classes = useStyles();
        const context = React.useContext(schemaCompareContext);
        const differences = context.differences;
        const [diffInclusionLevel, setDiffInclusionLevel] = React.useState<
            "allIncluded" | "allExcluded" | "mixed"
        >("allIncluded");
        const [filterText, setFilterText] = React.useState("");
        const [filterOpen, setFilterOpen] = React.useState(false);
        const [selectedSchemas, setSelectedSchemas] = React.useState<ReadonlySet<string>>(
            new Set(),
        );
        const [selectedObjectTypes, setSelectedObjectTypes] = React.useState<ReadonlySet<string>>(
            new Set(),
        );
        const virtualizedListRef = React.useRef<{
            scrollToItem: (
                index: number,
                align?: "auto" | "smart" | "center" | "end" | "start",
            ) => void;
        } | null>(undefined as unknown as null);
        const previouslyScrolledDiffId = React.useRef<number | undefined>(undefined);

        const resizableRef = React.useRef<HTMLDivElement | null>(
            undefined as unknown as HTMLDivElement | null,
        );
        const [height, setHeight] = React.useState(300);
        const [width, setWidth] = React.useState(0);

        React.useImperativeHandle(ref, () => resizableRef.current!);

        React.useEffect(() => {
            const container = resizableRef.current;
            if (!container) {
                return;
            }

            const updateDimensions = () => {
                setHeight(container.clientHeight);
                setWidth(container.clientWidth);
            };
            const frameId = requestAnimationFrame(updateDimensions);

            const observer = new ResizeObserver(updateDimensions);
            observer.observe(container);
            return () => {
                cancelAnimationFrame(frameId);
                observer.disconnect();
            };
        }, []);

        React.useEffect(() => {
            let allIncluded = true;
            let allExcluded = true;
            let someIncluded = false;
            for (const diffEntry of differences) {
                if (!diffEntry.included) {
                    allIncluded = false;
                }

                if (diffEntry.included) {
                    allExcluded = false;
                }
            }

            if (!allIncluded && !allExcluded) {
                someIncluded = true;
            }

            if (someIncluded) {
                setDiffInclusionLevel("mixed");
            } else if (allIncluded) {
                setDiffInclusionLevel("allIncluded");
            } else {
                setDiffInclusionLevel("allExcluded");
            }
        }, [differences]);

        const formatName = (nameParts: string[]): string => {
            if (!nameParts || nameParts.length === 0) {
                return "";
            }

            return nameParts.join(".");
        };

        const getSchemaName = (difference: DiffEntry): string => {
            const nameParts = difference.sourceValue ?? difference.targetValue ?? [];
            return nameParts.length > 1 ? nameParts[0] : "";
        };

        const schemaOptions = React.useMemo<FilterOption[]>(() => {
            const counts = new Map<string, number>();
            differences.forEach((difference) => {
                const schema = getSchemaName(difference);
                if (schema) {
                    counts.set(schema, (counts.get(schema) ?? 0) + 1);
                }
            });
            return [...counts.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, count]) => ({ key, label: key, count }));
        }, [differences]);

        const objectTypeOptions = React.useMemo<FilterOption[]>(() => {
            const counts = new Map<string, number>();
            differences.forEach((difference) => {
                if (difference.name) {
                    counts.set(difference.name, (counts.get(difference.name) ?? 0) + 1);
                }
            });
            return [...counts.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, count]) => ({ key, label: key, count }));
        }, [differences]);

        const toggleFilterValue = (
            value: string,
            allValues: string[],
            setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
        ) => {
            setter((current) => {
                const updated = new Set(current);
                if (updated.has(value)) {
                    updated.delete(value);
                } else {
                    updated.add(value);
                }
                return updated.size === allValues.length ? new Set() : updated;
            });
        };

        const handleIncludeExcludeNode = (diffEntry: DiffEntry, include: boolean) => {
            if (diffEntry.position !== undefined) {
                void context.includeExcludeNode(diffEntry.position, diffEntry, include);
            }
        };

        const emptyCell = <DataGridCell />;

        const columns: TableColumnDefinition<Row>[] = [
            createTableColumn<Row>({
                columnId: "type",
                renderHeaderCell: () => loc.schemaCompare.type,
                renderCell: (item) => {
                    if (item.kind !== "diff") return emptyCell;
                    return (
                        <DataGridCell>
                            <Text truncate className={classes.hideTextOverflow}>
                                {highlightText(item.name, filterText, classes.searchHighlight)}
                            </Text>
                        </DataGridCell>
                    );
                },
            }),
            createTableColumn<Row>({
                columnId: "sourceName",
                renderHeaderCell: () => loc.schemaCompare.sourceName,
                renderCell: (item) => {
                    if (item.kind !== "diff") return emptyCell;
                    return (
                        <DataGridCell>
                            <Text truncate className={classes.hideTextOverflow}>
                                {highlightText(
                                    formatName(item.sourceValue),
                                    filterText,
                                    classes.searchHighlight,
                                )}
                            </Text>
                        </DataGridCell>
                    );
                },
            }),
            createTableColumn<Row>({
                columnId: "include",
                renderHeaderCell: () => {
                    if (context.isIncludeExcludeAllInProgress) {
                        return (
                            <div className={classes.includeCell}>
                                <Spinner
                                    size="extra-tiny"
                                    aria-label={
                                        loc.schemaCompare.includeExcludeAllOperationInProgress
                                    }
                                    className={classes.alignSpinner}
                                />
                            </div>
                        );
                    }

                    return (
                        <div className={classes.includeCell}>
                            <Checkbox
                                checked={
                                    diffInclusionLevel === "allIncluded"
                                        ? true
                                        : diffInclusionLevel === "mixed"
                                          ? "mixed"
                                          : false
                                }
                                onChange={(_event, data) =>
                                    void context.includeExcludeAllNodes(data.checked === true)
                                }
                                disabled={context.pendingDifferenceIds.size > 0}
                            />
                        </div>
                    );
                },
                renderCell: (item) => {
                    if (item.kind !== "diff") return emptyCell;
                    const isPending =
                        item.position !== undefined &&
                        context.pendingDifferenceIds.has(item.position);
                    return (
                        <DataGridCell className={classes.includeCell}>
                            {isPending ? (
                                <Spinner
                                    size="extra-tiny"
                                    aria-label={loc.schemaCompare.updatingDifferenceSelection}
                                />
                            ) : (
                                <Checkbox
                                    checked={item.included}
                                    onChange={(event, data) => {
                                        event.stopPropagation();
                                        handleIncludeExcludeNode(item, data.checked === true);
                                    }}
                                    disabled={context.isIncludeExcludeAllInProgress}
                                />
                            )}
                        </DataGridCell>
                    );
                },
            }),
            createTableColumn<Row>({
                columnId: "action",
                renderHeaderCell: () => loc.schemaCompare.action,
                renderCell: (item) => {
                    if (item.kind !== "diff") return emptyCell;
                    return (
                        <DataGridCell>
                            <div className={classes.actionCell}>
                                <span
                                    className={mergeClasses(
                                        classes.summaryIndicator,
                                        getActionIndicatorClass(item.updateAction, classes),
                                    )}
                                    aria-hidden
                                />
                                <Text truncate className={classes.hideTextOverflow}>
                                    {highlightText(
                                        getLabelForAction(item.updateAction),
                                        filterText,
                                        classes.searchHighlight,
                                    )}
                                </Text>
                            </div>
                        </DataGridCell>
                    );
                },
            }),
            createTableColumn<Row>({
                columnId: "targetName",
                renderHeaderCell: () => loc.schemaCompare.targetName,
                renderCell: (item) => {
                    if (item.kind !== "diff") return emptyCell;
                    return (
                        <DataGridCell>
                            <Text truncate className={classes.hideTextOverflow}>
                                {highlightText(
                                    formatName(item.targetValue),
                                    filterText,
                                    classes.searchHighlight,
                                )}
                            </Text>
                        </DataGridCell>
                    );
                },
            }),
        ];

        const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());

        React.useEffect(() => {
            setCollapsedGroups(new Set());
        }, [groupBy]);

        const toggleGroupCollapsed = (key: string) => {
            setCollapsedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
                return next;
            });
        };

        const items = React.useMemo<Row[]>(() => {
            if (differences.length === 0) return [];

            const normalizedFilter = filterText.trim().toLocaleLowerCase();
            const diffs: DiffRow[] = differences
                .map((item, index) => ({
                    kind: "diff" as const,
                    ...item,
                    position: index,
                }))
                .filter((item) => {
                    if (selectedSchemas.size > 0 && !selectedSchemas.has(getSchemaName(item))) {
                        return false;
                    }
                    if (selectedObjectTypes.size > 0 && !selectedObjectTypes.has(item.name)) {
                        return false;
                    }
                    if (!normalizedFilter) {
                        return true;
                    }

                    const searchableText = [
                        item.name,
                        formatName(item.sourceValue),
                        formatName(item.targetValue),
                        getLabelForAction(item.updateAction),
                    ]
                        .join(" ")
                        .toLocaleLowerCase();
                    return searchableText.includes(normalizedFilter);
                });

            if (groupBy === "none") return diffs;

            // Group keys are stable identifiers (enum values or raw names), not
            // localized strings, so grouping survives language changes.
            const getKey = (entry: DiffEntry): string => {
                switch (groupBy) {
                    case "type":
                        return entry.name ?? "";
                    case "action":
                        return String(entry.updateAction);
                    case "schema":
                        return entry.sourceValue?.[0] ?? entry.targetValue?.[0] ?? "";
                    default:
                        return "";
                }
            };

            const getLabel = (key: string): string =>
                groupBy === "action" ? getLabelForAction(Number(key)) : key;

            const groups = new Map<string, DiffRow[]>();
            for (const d of diffs) {
                const key = getKey(d);
                const existing = groups.get(key);
                if (existing) {
                    existing.push(d);
                } else {
                    groups.set(key, [d]);
                }
            }

            const keys = Array.from(groups.keys());
            if (groupBy === "action") {
                const actionOrder: SchemaUpdateAction[] = [
                    SchemaUpdateAction.Delete,
                    SchemaUpdateAction.Change,
                    SchemaUpdateAction.Add,
                ];
                keys.sort((a, b) => {
                    const ai = actionOrder.indexOf(Number(a));
                    const bi = actionOrder.indexOf(Number(b));
                    if (ai === -1 && bi === -1) return a.localeCompare(b);
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                });
            } else {
                keys.sort((a, b) => a.localeCompare(b));
            }

            const result: Row[] = [];
            for (const key of keys) {
                const children = groups.get(key)!;
                const collapsed = collapsedGroups.has(key);
                result.push({
                    kind: "group",
                    key,
                    label: getLabel(key),
                    count: children.length,
                    collapsed,
                });
                if (!collapsed) {
                    result.push(...children);
                }
            }
            return result;
        }, [
            collapsedGroups,
            differences,
            filterText,
            groupBy,
            selectedObjectTypes,
            selectedSchemas,
        ]);

        React.useEffect(() => {
            onNavigableDiffIdsChange(
                items.flatMap((item) =>
                    item.kind === "diff" && item.position !== undefined ? [item.position] : [],
                ),
            );
        }, [items, onNavigableDiffIdsChange]);

        React.useEffect(() => {
            if (previouslyScrolledDiffId.current === selectedDiffId) {
                return;
            }

            previouslyScrolledDiffId.current = selectedDiffId;
            const selectedRowIndex = items.findIndex(
                (item) => item.kind === "diff" && item.position === selectedDiffId,
            );
            if (selectedRowIndex >= 0) {
                virtualizedListRef.current?.scrollToItem(selectedRowIndex, "smart");
            }
        }, [items, selectedDiffId]);

        const toggleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, diffEntry: DiffRow) => {
            if (e.key === "Enter") {
                if (diffEntry.position !== undefined) {
                    onDiffSelected(diffEntry.position);
                }
                e.preventDefault();
            }
        };

        const renderRow: RowRenderer<Row> = ({ item, rowId }, style) => {
            if (item.kind === "group") {
                const Chevron = item.collapsed ? ChevronRightRegular : ChevronDownRegular;
                return (
                    <div key={rowId} role="row" style={style} className={classes.groupHeaderRow}>
                        <div role="gridcell" className={classes.groupHeaderCell}>
                            <button
                                type="button"
                                aria-expanded={!item.collapsed}
                                className={classes.groupHeaderButton}
                                onClick={() => toggleGroupCollapsed(item.key)}>
                                <span className={classes.groupHeaderChevron}>
                                    <Chevron />
                                </span>
                                <Text
                                    truncate
                                    className={mergeClasses(
                                        classes.hideTextOverflow,
                                        classes.groupHeaderLabel,
                                    )}>
                                    {item.label}
                                </Text>
                                <Text className={classes.groupHeaderCount}>({item.count})</Text>
                            </button>
                        </div>
                    </div>
                );
            }

            return (
                <DataGridRow<Row>
                    key={rowId}
                    aria-selected={item.position === selectedDiffId}
                    className={item.position === selectedDiffId ? classes.selectedRow : undefined}
                    style={style}
                    onClick={() => {
                        if (item.position !== undefined) {
                            onDiffSelected(item.position);
                        }
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => toggleKeyDown(e, item)}>
                    {({ renderCell }) => <>{renderCell(item)}</>}
                </DataGridRow>
            );
        };

        const includeColumnWidth = 60;
        const columnPadding = 16;
        // Balance the two columns on each side so Include starts at the grid's midpoint.
        const sideContentWidth = Math.max(
            (width - includeColumnWidth - columnPadding) / 2 - columnPadding * 2,
            300,
        );
        const typeAndActionWidth = Math.max(100, Math.min(200, sideContentWidth * 0.3));
        const nameWidth = Math.max(200, sideContentWidth - typeAndActionWidth);

        const columnSizingOptions: TableColumnSizingOptions = {
            type: {
                minWidth: 100,
                defaultWidth: typeAndActionWidth,
            },
            sourceName: {
                minWidth: 200,
                defaultWidth: nameWidth,
            },
            include: {
                minWidth: 60,
                defaultWidth: 60,
            },
            action: {
                minWidth: 100,
                defaultWidth: typeAndActionWidth,
            },
            targetName: {
                minWidth: 200,
                defaultWidth: nameWidth,
            },
        };

        const { totalCount, selectedCount, addCount, changeCount, deleteCount } =
            React.useMemo(() => {
                let selectedCount = 0;
                let addCount = 0;
                let changeCount = 0;
                let deleteCount = 0;

                for (const difference of differences) {
                    if (difference.included) {
                        selectedCount++;
                    }

                    switch (difference.updateAction) {
                        case SchemaUpdateAction.Add:
                            addCount++;
                            break;
                        case SchemaUpdateAction.Change:
                            changeCount++;
                            break;
                        case SchemaUpdateAction.Delete:
                            deleteCount++;
                            break;
                    }
                }

                return {
                    totalCount: differences.length,
                    selectedCount,
                    addCount,
                    changeCount,
                    deleteCount,
                };
            }, [differences]);
        const activeFilterCount = selectedSchemas.size + selectedObjectTypes.size;

        return (
            <div className={classes.resizableContainer} ref={resizableRef}>
                <div className={classes.summaryBar}>
                    <Text className={classes.differencesSummary} weight="semibold">
                        {loc.schemaCompare.differencesSummary(totalCount)}
                    </Text>
                    <Text className={classes.actionSummary}>
                        <span
                            className={mergeClasses(classes.summaryIndicator, classes.addIndicator)}
                            aria-hidden
                        />
                        {loc.schemaCompare.addedDifferencesSummary(addCount)}
                    </Text>
                    <Text className={classes.actionSummary}>
                        <span
                            className={mergeClasses(
                                classes.summaryIndicator,
                                classes.changeIndicator,
                            )}
                            aria-hidden
                        />
                        {loc.schemaCompare.changedDifferencesSummary(changeCount)}
                    </Text>
                    <Text className={classes.actionSummary}>
                        <span
                            className={mergeClasses(
                                classes.summaryIndicator,
                                classes.deleteIndicator,
                            )}
                            aria-hidden
                        />
                        {loc.schemaCompare.deletedDifferencesSummary(deleteCount)}
                    </Text>
                    <div className={classes.filterControls}>
                        <Input
                            className={classes.filterInput}
                            size="small"
                            contentBefore={<Search16Regular />}
                            contentAfter={
                                filterText ? (
                                    <Button
                                        appearance="transparent"
                                        size="small"
                                        icon={<Dismiss16Regular />}
                                        aria-label={loc.common.clear}
                                        onClick={() => setFilterText("")}
                                        style={{ minWidth: "auto", padding: 0 }}
                                    />
                                ) : undefined
                            }
                            value={filterText}
                            onChange={(_event, data) => setFilterText(data.value)}
                            placeholder={loc.schemaCompare.filterObjects}
                            aria-label={loc.schemaCompare.filterObjects}
                        />
                        <Popover
                            withArrow
                            positioning="below-end"
                            open={filterOpen}
                            onOpenChange={(_event, data) => setFilterOpen(data.open)}>
                            <PopoverTrigger disableButtonEnhancement>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<Filter16Regular />}
                                    className={mergeClasses(
                                        classes.filterButton,
                                        activeFilterCount > 0 && classes.filterButtonActive,
                                    )}
                                    aria-label={loc.schemaCompare.filterDifferences}>
                                    <span className={classes.filterButtonContent}>
                                        {loc.schemaCompare.filterDifferences}
                                        {activeFilterCount > 0 && (
                                            <CounterBadge
                                                size="small"
                                                count={activeFilterCount}
                                                color="brand"
                                            />
                                        )}
                                    </span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverSurface className={classes.filterSurface}>
                                <div className={classes.filterPopupHeader}>
                                    <Text className={classes.filterPopupTitle}>
                                        {loc.schemaCompare.filterDifferences}
                                    </Text>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<Dismiss12Regular />}
                                        className={classes.filterCloseButton}
                                        aria-label={loc.common.close}
                                        onClick={() => setFilterOpen(false)}
                                    />
                                </div>
                                <div className={classes.filterDivider} />
                                <div className={classes.filterPopupBody}>
                                    <div className={classes.filterSection}>
                                        <Text className={classes.filterSectionTitle}>
                                            {loc.schemaCompare.schema}
                                        </Text>
                                        <div className={classes.filterSelectAllRow}>
                                            <Checkbox
                                                className={classes.filterCheckbox}
                                                checked={selectedSchemas.size === 0}
                                                label={
                                                    <span className={classes.filterOptionLabel}>
                                                        <span>{loc.schemaCompare.allSchemas}</span>
                                                        <span className={classes.filterCount}>
                                                            {schemaOptions.length}
                                                        </span>
                                                    </span>
                                                }
                                                onChange={() => setSelectedSchemas(new Set())}
                                            />
                                        </div>
                                        <VirtualizedFilterOptions
                                            options={schemaOptions}
                                            selected={selectedSchemas}
                                            onToggle={(key) =>
                                                toggleFilterValue(
                                                    key,
                                                    schemaOptions.map((option) => option.key),
                                                    setSelectedSchemas,
                                                )
                                            }
                                        />
                                    </div>
                                    <div className={classes.filterSection}>
                                        <Text className={classes.filterSectionTitle}>
                                            {loc.schemaCompare.objectType}
                                        </Text>
                                        <div className={classes.filterSelectAllRow}>
                                            <Checkbox
                                                className={classes.filterCheckbox}
                                                checked={selectedObjectTypes.size === 0}
                                                label={
                                                    <span className={classes.filterOptionLabel}>
                                                        <span>
                                                            {loc.schemaCompare.allObjectTypes}
                                                        </span>
                                                        <span className={classes.filterCount}>
                                                            {objectTypeOptions.length}
                                                        </span>
                                                    </span>
                                                }
                                                onChange={() => setSelectedObjectTypes(new Set())}
                                            />
                                        </div>
                                        <VirtualizedFilterOptions
                                            options={objectTypeOptions}
                                            selected={selectedObjectTypes}
                                            onToggle={(key) =>
                                                toggleFilterValue(
                                                    key,
                                                    objectTypeOptions.map((option) => option.key),
                                                    setSelectedObjectTypes,
                                                )
                                            }
                                        />
                                    </div>
                                    {activeFilterCount > 0 && (
                                        <Button
                                            appearance="secondary"
                                            size="small"
                                            onClick={() => {
                                                setSelectedSchemas(new Set());
                                                setSelectedObjectTypes(new Set());
                                            }}>
                                            {loc.schemaCompare.clearFilters}
                                        </Button>
                                    )}
                                </div>
                            </PopoverSurface>
                        </Popover>
                        <Menu
                            checkedValues={{ [GROUP_BY_MENU_NAME]: [groupBy] }}
                            onCheckedValueChange={(_event, data) => {
                                const next = data.checkedItems[0] as
                                    | SchemaCompareGroupBy
                                    | undefined;
                                if (next) {
                                    onGroupByChange(next);
                                }
                            }}>
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<TextBulletListTree16Regular />}
                                    aria-label={loc.common.groupBy}
                                    title={loc.schemaCompare.groupDifferencesBy}>
                                    {loc.common.groupBy}
                                </Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItemRadio name={GROUP_BY_MENU_NAME} value="none">
                                        {loc.common.none}
                                    </MenuItemRadio>
                                    <MenuDivider />
                                    <MenuItemRadio name={GROUP_BY_MENU_NAME} value="action">
                                        {loc.schemaCompare.action}
                                    </MenuItemRadio>
                                    <MenuItemRadio name={GROUP_BY_MENU_NAME} value="schema">
                                        {loc.schemaCompare.schema}
                                    </MenuItemRadio>
                                    <MenuItemRadio name={GROUP_BY_MENU_NAME} value="type">
                                        {loc.schemaCompare.type}
                                    </MenuItemRadio>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </div>
                    <Text className={classes.selectedSummary}>
                        {loc.schemaCompare.selectedDifferencesSummary(selectedCount, totalCount)}
                    </Text>
                </div>
                {width > 0 && (
                    <DataGrid
                        items={items}
                        columns={columns}
                        focusMode="composite"
                        resizableColumns={true}
                        columnSizingOptions={columnSizingOptions}
                        getRowId={(item) => {
                            const row = item as Row;
                            return row.kind === "group"
                                ? `group:${row.key}`
                                : `diff:${row.position ?? ""}`;
                        }}
                        size="extra-small">
                        <DataGridHeader className={classes.dataGridHeader}>
                            <DataGridRow>
                                {({ renderHeaderCell }) => (
                                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                                )}
                            </DataGridRow>
                        </DataGridHeader>
                        <DataGridBody<Row>
                            itemSize={30}
                            height={Math.max(height - 76, 0)}
                            width={"100%"}
                            listProps={{ ref: virtualizedListRef } as never}>
                            {renderRow}
                        </DataGridBody>
                    </DataGrid>
                )}
            </div>
        );
    },
);

export default SchemaDifferences;
