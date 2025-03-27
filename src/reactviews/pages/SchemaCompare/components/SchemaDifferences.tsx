/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
} from "@fluentui-contrib/react-data-grid-react-window";
import {
    Checkbox,
    createTableColumn,
    TableCellLayout,
    TableColumnDefinition,
} from "@fluentui/react-components";
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

    const handleIncludeExcludeNode = (
        diffEntry: DiffItem,
        include: boolean,
    ) => {
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
                return <TableCellLayout>{item.name}</TableCellLayout>;
            },
        }),
        createTableColumn<DiffItem>({
            columnId: "sourceName",
            renderHeaderCell: () => loc.schemaCompare.sourceName,
            renderCell: (item) => {
                return (
                    <TableCellLayout>
                        {formatName(item.sourceValue)}
                    </TableCellLayout>
                );
            },
        }),
        createTableColumn<DiffItem>({
            columnId: "include",
            renderHeaderCell: () => loc.schemaCompare.include,
            renderCell: (item) => {
                return (
                    <TableCellLayout>
                        <Checkbox
                            checked={item.included}
                            onClick={() =>
                                handleIncludeExcludeNode(item, !item.included)
                            }
                        />
                    </TableCellLayout>
                );
            },
        }),
        createTableColumn<DiffItem>({
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
        createTableColumn<DiffItem>({
            columnId: "targetName",
            renderHeaderCell: () => loc.schemaCompare.targetName,
            renderCell: (item) => {
                return (
                    <TableCellLayout>
                        {formatName(item.targetValue)}
                    </TableCellLayout>
                );
            },
        }),
    ];

    return (
        <>
            {compareResult?.success && (
                <DataGrid
                    items={items}
                    columns={columns}
                    getRowId={(item: DiffItem) => item.id}
                    focusMode="composite"
                    style={{ minWidth: "550px" }}>
                    <DataGridHeader>
                        <DataGridRow>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell>
                                    {renderHeaderCell()}
                                </DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<DiffItem> itemSize={5} height={200}>
                        {({ item, rowId }) => (
                            <DataGridRow<DiffItem>
                                key={rowId}
                                onClick={() => onDiffSelected(item.id)}>
                                {({ renderCell }) => (
                                    <DataGridCell>
                                        {renderCell(item)}
                                    </DataGridCell>
                                )}
                            </DataGridRow>
                        )}
                    </DataGridBody>
                </DataGrid>
            )}
        </>
    );
};

export default SchemaDifferences;
