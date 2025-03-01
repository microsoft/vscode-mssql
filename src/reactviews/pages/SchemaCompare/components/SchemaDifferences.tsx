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

type DiffItem = {
    id: number;
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

    let items: DiffItem[] = [];
    if (compareResult?.success)
        items = compareResult.differences.map(
            (item, index) =>
                ({
                    id: index,
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
                    getRowId={(item: DiffItem) => item.id}
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
                    <DataGridBody<DiffItem> itemSize={5} height={200}>
                        {({ item, rowId }) => (
                            <DataGridRow<DiffItem>
                                key={rowId}
                                onClick={() => onDiffSelected(item.id)}
                            >
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
