/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Checkbox,
    createTableColumn,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableHeader,
    TableHeaderCell,
    TableRow,
} from "@fluentui/react-components";
import { FixedSizeList as List } from "react-window";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { DiffEntry } from "vscode-mssql";

type DiffItem = DiffEntry & {
    id: number;
};

interface Props {
    onDiffSelected: (id: number) => void;
}

const SchemaDifferences = ({ onDiffSelected }: Props) => {
    const context = useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;

    const formatName = (nameParts: string[]): string => {
        if (!nameParts || nameParts.length === 0) {
            return "";
        }

        return nameParts.join(".");
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

    const handleIncludeExcludeNode = (diffEntry: DiffItem, include: boolean) => {
        context.includeExcludeNode(diffEntry.id, diffEntry, include);
    };

    let items: DiffEntry[] = [];
    if (compareResult?.success)
        items = compareResult.differences.map(
            (item, index) =>
                ({
                    id: index,
                    ...item,
                }) as DiffItem,
        );

    const columns: TableColumnDefinition<DiffItem>[] = [
        createTableColumn<DiffItem>({
            columnId: "type",
            renderHeaderCell: () => loc.schemaCompare.type,
            renderCell: (item) => {
                return <TableCell>{item.name}</TableCell>;
            },
        }),
        createTableColumn<DiffItem>({
            columnId: "sourceName",
            renderHeaderCell: () => loc.schemaCompare.sourceName,
            renderCell: (item) => {
                return <TableCell>{formatName(item.sourceValue)}</TableCell>;
            },
        }),
        createTableColumn<DiffItem>({
            columnId: "include",
            renderHeaderCell: () => loc.schemaCompare.include,
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
        createTableColumn<DiffItem>({
            columnId: "action",
            renderHeaderCell: () => loc.schemaCompare.action,
            renderCell: (item) => {
                return <TableCell>{getLabelForAction(item.updateAction as number)}</TableCell>;
            },
        }),
        createTableColumn<DiffItem>({
            columnId: "targetName",
            renderHeaderCell: () => loc.schemaCompare.targetName,
            renderCell: (item) => {
                return <TableCell>{formatName(item.targetValue)}</TableCell>;
            },
        }),
    ];

    const RenderRow = ({ index, style }: any) => {
        const item = items[index];

        return (
            <TableRow
                aria-rowindex={index + 2}
                style={style}
                key={index}
                // onKeyDown={onKeyDown}
                onClick={() => onDiffSelected(index)}
                // appearance={appearance}
            >
                {columns.map((column) => column.renderCell(item as DiffItem))}
            </TableRow>
        );
    };

    return (
        <>
            {compareResult?.success && (
                <Table
                    noNativeElements
                    aria-label="Table with schema differences"
                    aria-rowCount={compareResult.differences.length}
                    style={{ minWidth: "550px" }}>
                    <TableHeader>
                        <TableRow aria-rowindex={1}>
                            {columns.map((column) => (
                                <TableHeaderCell>{column.renderHeaderCell()}</TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <List
                            height={200}
                            itemCount={items.length}
                            itemSize={45}
                            width={"100%"}
                            itemData={items}>
                            {RenderRow}
                        </List>
                    </TableBody>
                </Table>
            )}
        </>
    );
};

export default SchemaDifferences;
