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
} from "@fluentui/react-components";
import {
    DataGridBody,
    DataGrid,
    DataGridRow,
    DataGridCell,
    RowRenderer,
} from "@fluentui-contrib/react-data-grid-react-window";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { DiffEntry } from "vscode-mssql";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { useResizable } from "../../../hooks/useResizable";
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
        overflow: "hidden",
    },
    resizer: {
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "8px",
        cursor: "ns-resize",
        backgroundColor: "transparent",
        zIndex: 10,
        "&:hover": {
            backgroundColor: "var(--vscode-scrollbarSlider-hoverBackground)",
            opacity: 0.5,
        },
        "&:active": {
            backgroundColor: "var(--vscode-scrollbarSlider-activeBackground)",
            opacity: 0.7,
        },
    },
    resizerHandle: {
        height: "3px",
        width: "40px",
        margin: "2px auto",
        borderRadius: "1px",
        backgroundColor: "var(--vscode-scrollbarSlider-background)",
        opacity: 0.5,
    },
    hideTextOverflow: {
        overflow: "hidden",
        whiteSpace: "nowrap",
    },
    alignSpinner: {
        marginLeft: "8px",
    },
    dataGridHeader: {
        backgroundColor: "var(--vscode-keybindingTable-headerBackground)",
    },
    groupHeaderRow: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 8px",
        cursor: "pointer",
        backgroundColor: "var(--vscode-sideBarSectionHeader-background)",
        color: "var(--vscode-sideBarSectionHeader-foreground)",
        userSelect: "none",
        boxSizing: "border-box",
        borderBottom: "1px solid var(--vscode-sideBarSectionHeader-border)",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
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
    siblingRef?: React.RefObject<HTMLDivElement | null>;
    groupBy: SchemaCompareGroupBy;
}

export const SchemaDifferences = React.forwardRef<HTMLDivElement, Props>(
    ({ onDiffSelected, selectedDiffId, siblingRef, groupBy }, ref) => {
        const classes = useStyles();
        const context = React.useContext(schemaCompareContext);
        const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
        const isIncludeExcludeAllOperationInProgress = useSchemaCompareSelector(
            (s) => s.isIncludeExcludeAllOperationInProgress,
        );
        const compareResult = schemaCompareResult;
        const [diffInclusionLevel, setDiffInclusionLevel] = React.useState<
            "allIncluded" | "allExcluded" | "mixed"
        >("allIncluded");

        // Use the resizable hook
        const {
            ref: resizableRef,
            height,
            resizerProps,
        } = useResizable({
            initialHeight: 300,
            minHeight: 150,
            maxHeight: 800,
            siblingRef,
        });

        // Expose resizableRef via forwarded ref
        React.useImperativeHandle(ref, () => resizableRef.current!);

        React.useEffect(() => {
            let allIncluded = true;
            let allExcluded = true;
            let someIncluded = false;
            for (const diffEntry of compareResult.differences) {
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
        }, [schemaCompareResult]);

        const formatName = (nameParts: string[]): string => {
            if (!nameParts || nameParts.length === 0) {
                return "";
            }

            return nameParts.join(".");
        };

        const handleIncludeExcludeNode = (diffEntry: DiffEntry, include: boolean) => {
            if (diffEntry.position !== undefined) {
                context.includeExcludeNode(diffEntry.position, diffEntry, include);
            }
        };

        const handleIncludeExcludeAllNodes = () => {
            if (diffInclusionLevel === "allExcluded" || diffInclusionLevel === "mixed") {
                context.includeExcludeAllNodes(true /* include all */);
            } else {
                context.includeExcludeAllNodes(false /* exclude all */);
            }
        };

        const getLabelForAction = (action: SchemaUpdateAction): string => {
            let actionLabel = "";
            switch (action) {
                case SchemaUpdateAction.Add:
                    actionLabel = loc.schemaCompare.add;
                    break;
                case SchemaUpdateAction.Change:
                    actionLabel = loc.schemaCompare.change;
                    break;
                case SchemaUpdateAction.Delete:
                    actionLabel = loc.schemaCompare.delete;
                    break;
            }

            return actionLabel;
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
                                {item.name}
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
                                {formatName(item.sourceValue)}
                            </Text>
                        </DataGridCell>
                    );
                },
            }),
            createTableColumn<Row>({
                columnId: "include",
                renderHeaderCell: () => {
                    if (isIncludeExcludeAllOperationInProgress) {
                        return (
                            <div>
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
                        <Checkbox
                            checked={
                                diffInclusionLevel === "allIncluded"
                                    ? true
                                    : diffInclusionLevel === "mixed"
                                      ? "mixed"
                                      : false
                            }
                            onClick={() => handleIncludeExcludeAllNodes()}
                            onKeyDown={toggleAllKeydown}
                        />
                    );
                },
                renderCell: (item) => {
                    if (item.kind !== "diff") return emptyCell;
                    return (
                        <DataGridCell>
                            <Checkbox
                                checked={item.included}
                                onClick={() => handleIncludeExcludeNode(item, !item.included)}
                                disabled={isIncludeExcludeAllOperationInProgress}
                            />
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
                            <Text truncate className={classes.hideTextOverflow}>
                                {getLabelForAction(item.updateAction as number)}
                            </Text>
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
                                {formatName(item.targetValue)}
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

        const getGroupKey = (entry: DiffEntry): string => {
            switch (groupBy) {
                case "type":
                    return entry.name ?? "";
                case "action":
                    return getLabelForAction(entry.updateAction as number);
                case "schema":
                    return entry.sourceValue?.[0] ?? entry.targetValue?.[0] ?? "";
                case "none":
                    return "";
            }
        };

        const actionSortOrder = [
            loc.schemaCompare.delete,
            loc.schemaCompare.change,
            loc.schemaCompare.add,
        ];

        const sortGroupKeys = (keys: string[]): string[] => {
            if (groupBy === "action") {
                return [...keys].sort((a, b) => {
                    const ai = actionSortOrder.indexOf(a);
                    const bi = actionSortOrder.indexOf(b);
                    if (ai === -1 && bi === -1) return a.localeCompare(b);
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                });
            }
            return [...keys].sort((a, b) => a.localeCompare(b));
        };

        let items: Row[] = [];
        if (compareResult?.success) {
            const diffs: DiffRow[] = compareResult.differences.map((item, index) => ({
                kind: "diff",
                ...item,
                position: index,
            }));

            if (groupBy === "none") {
                items = diffs;
            } else {
                const groups = new Map<string, DiffRow[]>();
                for (const d of diffs) {
                    const key = getGroupKey(d);
                    const existing = groups.get(key);
                    if (existing) {
                        existing.push(d);
                    } else {
                        groups.set(key, [d]);
                    }
                }

                for (const key of sortGroupKeys(Array.from(groups.keys()))) {
                    const children = groups.get(key)!;
                    const collapsed = collapsedGroups.has(key);
                    items.push({
                        kind: "group",
                        key,
                        label: key,
                        count: children.length,
                        collapsed,
                    });
                    if (!collapsed) {
                        items.push(...children);
                    }
                }
            }
        }

        const toggleAllKeydown = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === " ") {
                handleIncludeExcludeAllNodes();
                e.preventDefault();
            }
        };

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
                    <div
                        key={rowId}
                        role="row"
                        aria-expanded={!item.collapsed}
                        tabIndex={0}
                        style={style}
                        className={classes.groupHeaderRow}
                        onClick={() => toggleGroupCollapsed(item.key)}
                        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                            if (e.key === "Enter" || e.key === " ") {
                                toggleGroupCollapsed(item.key);
                                e.preventDefault();
                            }
                        }}>
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
                    </div>
                );
            }

            return (
                <DataGridRow<Row>
                    key={rowId}
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

        const columnSizingOptions: TableColumnSizingOptions = {
            type: {
                minWidth: 100,
            },
            sourceName: {
                minWidth: 200,
                defaultWidth: 350,
            },
            include: {
                minWidth: 60,
                defaultWidth: 60,
            },
            action: {
                minWidth: 100,
            },
            targetName: {
                minWidth: 200,
            },
        };

        return (
            <div
                className={classes.resizableContainer}
                ref={resizableRef}
                style={{ height: `${height}px` }}>
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
                    <DataGridBody<Row> itemSize={30} height={height - 40} width={"100%"}>
                        {renderRow}
                    </DataGridBody>
                </DataGrid>

                <div {...resizerProps} className={classes.resizer}>
                    <div className={classes.resizerHandle} />
                </div>
            </div>
        );
    },
);

export default SchemaDifferences;
