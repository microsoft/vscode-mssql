/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { FixedSizeList as List, ListChildComponentProps } from "react-window";
import {
    useScrollbarWidth,
    useFluent,
    createTableColumn,
    useTableFeatures,
    useTableSelection,
    TableRowData as RowStateBase,
    TableColumnDefinition,
    Checkbox,
    makeStyles,
    Spinner,
    useArrowNavigationGroup,
    DataGrid,
    DataGridHeader,
    DataGridRow,
    DataGridHeaderCell,
    DataGridBody,
    DataGridCell,
    TableCellLayout,
} from "@fluentui/react-components";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { DiffEntry } from "vscode-mssql";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useResizable } from "../../../hooks/useResizable";

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
});

interface TableRowData extends RowStateBase<DiffEntry> {
    onClick: (e: React.MouseEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    selected: boolean;
    appearance: "brand" | "none";
}

interface ReactWindowRenderFnProps extends ListChildComponentProps {
    data: TableRowData[];
}

interface Props {
    onDiffSelected: (id: number) => void;
    selectedDiffId: number;
    siblingRef?: React.RefObject<HTMLDivElement>;
}

export const SchemaDifferences = React.forwardRef<HTMLDivElement, Props>(
    ({ onDiffSelected, selectedDiffId, siblingRef }, ref) => {
        const classes = useStyles();
        const { targetDocument } = useFluent();
        const scrollbarWidth = useScrollbarWidth({ targetDocument });
        const context = React.useContext(schemaCompareContext);
        const compareResult = context.state.schemaCompareResult;
        const [diffInclusionLevel, setDiffInclusionLevel] = React.useState<
            "allIncluded" | "allExcluded" | "mixed"
        >("allIncluded");
        const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });

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

        // Add a reference to the List component
        const listRef = React.useRef<List>(null);

        // Use an effect to scroll to the selected row when selectedDiffId changes
        React.useEffect(() => {
            if (selectedDiffId >= 0 && listRef.current) {
                listRef.current.scrollToItem(selectedDiffId, "center");
            }
        }, [selectedDiffId]);

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
        }, [context.state.schemaCompareResult]);

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

        const columns: TableColumnDefinition<DiffEntry>[] = [
            createTableColumn<DiffEntry>({
                columnId: "type",
                renderHeaderCell: () => loc.schemaCompare.type,
                renderCell: (item) => {
                    return <TableCellLayout>{item.name}</TableCellLayout>;
                },
            }),
            createTableColumn<DiffEntry>({
                columnId: "sourceName",
                renderHeaderCell: () => loc.schemaCompare.sourceName,
                renderCell: (item) => {
                    return <TableCellLayout>{formatName(item.sourceValue)}</TableCellLayout>;
                },
            }),
            createTableColumn<DiffEntry>({
                columnId: "include",
                renderHeaderCell: () => {
                    if (context.state.isIncludeExcludeAllOperationInProgress) {
                        return (
                            <Spinner
                                size="extra-tiny"
                                aria-label={loc.schemaCompare.includeExcludeAllOperationInProgress}
                            />
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
                    return (
                        <TableCellLayout>
                            <Checkbox
                                checked={item.included}
                                onClick={() => handleIncludeExcludeNode(item, !item.included)}
                            />
                        </TableCellLayout>
                    );
                },
            }),
            createTableColumn<DiffEntry>({
                columnId: "action",
                renderHeaderCell: () => loc.schemaCompare.action,
                renderCell: (item) => {
                    return (
                        <TableCellLayout>
                            {getLabelForAction(item.updateAction as number)}
                        </TableCellLayout>
                    );
                },
            }),
            createTableColumn<DiffEntry>({
                columnId: "targetName",
                renderHeaderCell: () => loc.schemaCompare.targetName,
                renderCell: (item) => {
                    return <TableCellLayout>{formatName(item.targetValue)}</TableCellLayout>;
                },
            }),
        ];

        let items: DiffEntry[] = [];
        if (compareResult?.success) {
            items = compareResult.differences.map(
                (item, index) =>
                    ({
                        position: index,
                        ...item,
                    }) as DiffEntry,
            );
        }

        const {
            getRows,
            selection: { toggleRow },
        } = useTableFeatures(
            {
                columns,
                items,
            },
            [
                useTableSelection({
                    selectionMode: "multiselect",
                }),
            ],
        );

        const rows: TableRowData[] = getRows((row) => {
            const selected = row.item.included;
            return {
                ...row,
                onClick: (e: React.MouseEvent) => toggleRow(e, row.rowId),
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === " ") {
                        e.preventDefault();
                        toggleRow(e, row.rowId);
                    }
                },
                selected,
                appearance: selected ? ("brand" as const) : ("none" as const),
            };
        });

        const toggleAllKeydown = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === " ") {
                handleIncludeExcludeAllNodes();
                e.preventDefault();
            }
        };

        const toggleKeyDown = (
            e: React.KeyboardEvent<HTMLDivElement>,
            diffEntry: DiffEntry,
            include: boolean,
        ) => {
            if (e.key === "Enter") {
                if (diffEntry.position !== undefined) {
                    onDiffSelected(diffEntry.position);
                }
                e.preventDefault();
            }
            if (e.key === " ") {
                handleIncludeExcludeNode(diffEntry, include);
                e.preventDefault();
            }
        };

        return (
            <div
                className={classes.resizableContainer}
                ref={resizableRef}
                style={{ height: `${height}px` }}>
                <DataGrid
                    items={items}
                    columns={columns}
                    getRowId={(item) => (item as DiffEntry).position?.toString() ?? ""}>
                    <DataGridHeader>
                        <DataGridRow>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<DiffEntry>>
                        {({ item, rowId }) => (
                            <DataGridRow<DiffEntry> key={rowId}>
                                {({ renderCell }) => (
                                    <DataGridCell>{renderCell(item)}</DataGridCell>
                                )}
                            </DataGridRow>
                        )}
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
