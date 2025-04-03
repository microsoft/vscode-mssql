/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { FixedSizeList as List, ListChildComponentProps } from "react-window";
import {
    useScrollbarWidth,
    useFluent,
    TableBody,
    TableCell,
    TableRow,
    Table,
    TableHeader,
    TableHeaderCell,
    // TableSelectionCell,
    createTableColumn,
    useTableFeatures,
    useTableSelection,
    TableRowData as RowStateBase,
    TableColumnDefinition,
    Checkbox,
} from "@fluentui/react-components";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { DiffEntry } from "vscode-mssql";
import { schemaCompareContext } from "../SchemaCompareStateProvider";

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
}

export const SchemaDifferences = ({ onDiffSelected }: Props) => {
    const { targetDocument } = useFluent();
    const scrollbarWidth = useScrollbarWidth({ targetDocument });
    const context = React.useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;

    const formatName = (nameParts: string[]): string => {
        if (!nameParts || nameParts.length === 0) {
            return "";
        }

        return nameParts.join(".");
    };

    const handleIncludeExcludeNode = (diffEntry: DiffEntry, include: boolean) => {
        context.includeExcludeNode(diffEntry!.position, diffEntry, include);
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
            renderCell: (item) => {
                return <TableCell>{item.name}</TableCell>;
            },
        }),
        createTableColumn<DiffEntry>({
            columnId: "sourceName",
            renderCell: (item) => {
                return <TableCell>{formatName(item.sourceValue)}</TableCell>;
            },
        }),
        createTableColumn<DiffEntry>({
            columnId: "include",
            renderCell: (item) => {
                return (
                    <TableCell>
                        <Checkbox
                            checked={item.included}
                            onClick={() => handleIncludeExcludeNode(item, !item.included)}
                        />
                    </TableCell>
                );
            },
        }),
        createTableColumn<DiffEntry>({
            columnId: "action",
            renderCell: (item) => {
                return <TableCell>{getLabelForAction(item.updateAction as number)}</TableCell>;
            },
        }),
        createTableColumn<DiffEntry>({
            columnId: "targetName",
            renderCell: (item) => {
                return <TableCell>{formatName(item.targetValue)}</TableCell>;
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
        selection: { allRowsSelected, someRowsSelected, toggleAllRows, toggleRow, isRowSelected },
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

    const toggleAllKeydown = React.useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === " ") {
                toggleAllRows(e);
                e.preventDefault();
            }
        },
        [toggleAllRows],
    );

    const RenderRow = ({ index, style, data }: ReactWindowRenderFnProps) => {
        const { item, selected, appearance, onClick, onKeyDown } = data[index];
        return (
            <TableRow
                aria-rowindex={index + 2}
                style={style}
                key={item.position}
                onKeyDown={onKeyDown}
                onClick={() => onDiffSelected(index)}
                appearance={appearance}>
                {/* <TableSelectionCell
                    checked={selected}
                    checkboxIndicator={{ "aria-label": "Select row" }}
                /> */}
                <TableCell>{item.name}</TableCell>
                <TableCell>{formatName(item.sourceValue)}</TableCell>
                <TableCell>
                    <Checkbox
                        checked={item.included}
                        onClick={() => handleIncludeExcludeNode(item, !item.included)}
                    />
                </TableCell>
                <TableCell>{getLabelForAction(item.updateAction as number)}</TableCell>
                <TableCell>{formatName(item.targetValue)}</TableCell>
            </TableRow>
        );
    };

    return (
        <Table
            noNativeElements
            aria-label="Table with selection"
            aria-rowcount={rows.length}
            style={{ minWidth: "650px" }}>
            <TableHeader>
                <TableRow aria-rowindex={1}>
                    {/* <TableSelectionCell
                        checked={allRowsSelected ? true : someRowsSelected ? "mixed" : false}
                        onClick={toggleAllRows}
                        onKeyDown={toggleAllKeydown}
                        checkboxIndicator={{ "aria-label": "Select all rows" }}
                    /> */}
                    <TableHeaderCell>{loc.schemaCompare.type}</TableHeaderCell>
                    <TableHeaderCell>{loc.schemaCompare.sourceName}</TableHeaderCell>
                    <TableHeaderCell>
                        <Checkbox
                            checked={allRowsSelected ? true : someRowsSelected ? "mixed" : false}
                        />
                    </TableHeaderCell>
                    <TableHeaderCell>{loc.schemaCompare.action}</TableHeaderCell>
                    <TableHeaderCell>{loc.schemaCompare.targetName}</TableHeaderCell>
                    {/** Scrollbar alignment for the header */}
                    <div role="presentation" style={{ width: scrollbarWidth }} />
                </TableRow>
            </TableHeader>
            <TableBody>
                <List
                    height={200}
                    itemCount={items.length}
                    itemSize={45}
                    width={"100%"}
                    itemData={rows}>
                    {RenderRow}
                </List>
            </TableBody>
        </Table>
    );
};

export default SchemaDifferences;
