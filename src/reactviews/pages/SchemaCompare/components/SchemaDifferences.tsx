/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Checkbox,
    createTableColumn,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    TableCellLayout,
    TableColumnDefinition,
} from "@fluentui/react-components";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";

type DiffItem = {
    type: string;
    sourceValue: string;
    included: boolean;
    updateAction: string;
    targetValue: string;
};

const columns: TableColumnDefinition<DiffItem>[] = [
    createTableColumn<DiffItem>({
        columnId: "type",
        renderHeaderCell: () => "Type",
        renderCell: (item) => {
            return <TableCellLayout>{item.type}</TableCellLayout>;
        },
    }),
    createTableColumn<DiffItem>({
        columnId: "sourceName",
        renderHeaderCell: () => "Source Name",
        renderCell: (item) => {
            return <TableCellLayout>{item.sourceValue}</TableCellLayout>;
        },
    }),
    createTableColumn<DiffItem>({
        columnId: "include",
        renderHeaderCell: () => "Include",
        renderCell: (item) => {
            return (
                <TableCellLayout>
                    <Checkbox checked={item.included} />
                </TableCellLayout>
            );
        },
    }),
    createTableColumn<DiffItem>({
        columnId: "action",
        renderHeaderCell: () => "Action",
        renderCell: (item) => {
            return <TableCellLayout>{item.updateAction}</TableCellLayout>;
        },
    }),
    createTableColumn<DiffItem>({
        columnId: "targetName",
        renderHeaderCell: () => "Target Name",
        renderCell: (item) => {
            return <TableCellLayout>{item.targetValue}</TableCellLayout>;
        },
    }),
];

const SchemaDifferences = () => {
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
                actionLabel = "Add";
                break;
            case SchemaUpdateAction.Change:
                actionLabel = "Change";
                break;
            case SchemaUpdateAction.Delete:
                actionLabel = "Delete";
                break;
        }

        return actionLabel;
    };

    const items: DiffItem[] =
        compareResult?.success &&
        compareResult.differences.map(
            (item) =>
                ({
                    type: item.name,
                    sourceValue: formatName(item.sourceValue),
                    included: true,
                    updateAction: getLabelForAction(
                        item.updateAction as number,
                    ),
                    targetValue: formatName(item.targetValue),
                }) as DiffItem,
        );

    return (
        <>
            {compareResult?.success && (
                <DataGrid
                    items={items}
                    columns={columns}
                    getRowId={(item) => item.sourceValue || item.targetValue}
                    focusMode="composite"
                    style={{ minWidth: "550px" }}
                >
                    <DataGridHeader>
                        <DataGridRow>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell>
                                    {renderHeaderCell()}
                                </DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<DiffItem>>
                        {({ item, rowId }) => (
                            <DataGridRow<DiffItem> key={rowId}>
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
