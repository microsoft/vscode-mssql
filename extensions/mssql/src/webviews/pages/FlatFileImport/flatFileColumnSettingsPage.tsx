/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useMemo, useState } from "react";
import {
    Checkbox,
    createTableColumn,
    Input,
    makeStyles,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableColumnId,
    TableColumnSizingOptions,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { ColumnChanges } from "../../../sharedInterfaces/flatFileImport";
import { useFlatFileSelector } from "./flatFileSelector";
import { getDataTypeOptions } from "./flatFileDataTypeUtils";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        padding: "12px",
        boxSizing: "border-box",
    },

    tableDiv: {
        maxWidth: "100%",
        maxHeight: "650px",
        minWidth: "250px",
        overflow: "auto",
        boxSizing: "border-box",
        scrollbarGutter: "stable",
        marginTop: "10px",
        marginBottom: "10px",
        width: "100%",
    },

    table: {
        width: "100%",
        borderCollapse: "collapse",
        maxWidth: "100%",
    },

    tableHeader: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        boxSizing: "border-box",
        width: "100%",
    },

    tableHeaderCell: {
        backgroundColor: tokens.colorNeutralBackground6,
        fontSize: "12px",
        fontWeight: 600,
        boxSizing: "border-box",
        width: "100%",
    },

    tableBodyCell: {
        maxHeight: "20px",
        verticalAlign: "middle",
        boxSizing: "border-box",
        width: "100%",
    },

    cellText: {
        fontSize: "12px",
        lineHeight: 1.4,
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "block",
        width: "100%",
    },

    columnText: {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
        width: "100%",
        whiteSpace: "nowrap",
    },

    cellCenter: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "22px",
        width: "100%",
        minWidth: 0,
    },

    headerCenter: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minWidth: 0,
    },

    headerItems: {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: 0,
        minWidth: "30px",
        width: "100%",
    },

    dropdown: {
        width: "100%",
        minWidth: "60px",
        height: "24px",
    },

    input: {
        width: "100%",
        minWidth: "60px",
        height: "24px",

        "& input": {
            height: "100%",
            padding: "0 6px",
            fontSize: "11px",
        },
    },

    checkbox: {
        padding: 0,

        "& svg": {
            width: "14px",
            height: "14px",
        },
    },
});

type FlatFileTableItem = {
    rowId: string;
    cells: FlatFileTableCell[];
};

type FlatFileTableCell = {
    columnId: TableColumnId;
    value: string | boolean;
    type: string;
};

interface FlatFileColumnSettingsPageProps {
    initialColumnChanges?: ColumnChanges[];
    onColumnChangesChanged?: (columnChanges: ColumnChanges[]) => void;
}

export const FlatFileColumnSettingsPage = ({
    initialColumnChanges,
    onColumnChangesChanged,
}: FlatFileColumnSettingsPageProps) => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
    const context = useContext(FlatFileContext);

    if (!context) return null;

    const tablePreview = useFlatFileSelector((s) => s.tablePreview);

    const INPUT_TYPE = "input";
    const CHECKBOX_TYPE = "checkbox";
    const DROPDOWN_TYPE = "dropdown";
    const NEW_PRIMARY_KEY_COL_INDEX = 2;
    const NEW_NULLABLE_COL_INDEX = 3;

    const columnInfo = [
        { header: locConstants.flatFileImport.columnName, inputType: INPUT_TYPE },
        { header: locConstants.flatFileImport.dataType, inputType: DROPDOWN_TYPE },
        { header: locConstants.flatFileImport.primaryKey, inputType: CHECKBOX_TYPE },
        { header: locConstants.flatFileImport.allowNulls, inputType: CHECKBOX_TYPE },
    ];

    const initialColumnChangeMap = useMemo(
        () =>
            (initialColumnChanges ?? []).reduce<Record<number, ColumnChanges>>((acc, change) => {
                acc[change.index] = change;
                return acc;
            }, {}),
        [initialColumnChanges],
    );

    const [columnChanges, setColumnChanges] =
        useState<Record<number, ColumnChanges>>(initialColumnChangeMap);

    // Indices 2 and 3 correspond to the checkbox columns,
    // which require special handling for the "Select All" functionality.
    const [checkedStates, setCheckedStates] = useState<Record<number, boolean[]>>({
        [NEW_PRIMARY_KEY_COL_INDEX]:
            tablePreview?.columnInfo.map((column, index) =>
                Boolean(initialColumnChangeMap[index]?.newInPrimaryKey ?? column.isInPrimaryKey),
            ) || [],
        [NEW_NULLABLE_COL_INDEX]:
            tablePreview?.columnInfo.map((column, index) =>
                Boolean(initialColumnChangeMap[index]?.newNullable ?? column.isNullable),
            ) || [],
    });

    useEffect(() => {
        onColumnChangesChanged?.(Object.values(columnChanges));
    }, [columnChanges, onColumnChangesChanged]);

    const columns: TableColumnDefinition<FlatFileTableItem>[] = useMemo(
        () =>
            columnInfo.map((column, index) =>
                createTableColumn<FlatFileTableItem>({
                    columnId: column.header,
                    renderHeaderCell: () => (
                        <div className={classes.headerCenter}>
                            <div className={classes.headerItems}>
                                <Text className={classes.columnText}>{column.header}</Text>
                                {column.inputType === CHECKBOX_TYPE && (
                                    <Checkbox
                                        id={`select-all-${index}`}
                                        checked={
                                            checkedStates[index]?.every((isChecked) => isChecked) ||
                                            false
                                        }
                                        onChange={(_, data) => {
                                            const changedField =
                                                index === NEW_PRIMARY_KEY_COL_INDEX
                                                    ? "newInPrimaryKey"
                                                    : "newNullable";
                                            handleSelectAllChange(
                                                index,
                                                changedField,
                                                Boolean(data.checked),
                                            );
                                        }}
                                        disabled={
                                            index === NEW_NULLABLE_COL_INDEX &&
                                            checkedStates[NEW_PRIMARY_KEY_COL_INDEX].every(
                                                (isChecked) => isChecked,
                                            )
                                        } // Disable "Select All" for "Allow Nulls" if "Primary Key" is all checked
                                    />
                                )}
                            </div>
                        </div>
                    ),
                }),
            ),
        [checkedStates],
    );

    const items: FlatFileTableItem[] = useMemo(() => {
        return (
            tablePreview?.columnInfo.map((row, rowIndex) => {
                const cells = [
                    { columnId: columns[0]?.columnId ?? "", value: row.name, type: INPUT_TYPE },
                    {
                        columnId: columns[1]?.columnId ?? "",
                        value: row.sqlType,
                        type: DROPDOWN_TYPE,
                    },
                    {
                        columnId: columns[2]?.columnId ?? "",
                        value: row.isInPrimaryKey,
                        type: CHECKBOX_TYPE,
                    },
                    {
                        columnId: columns[3]?.columnId ?? "",
                        value: row.isNullable,
                        type: CHECKBOX_TYPE,
                    },
                ] as FlatFileTableCell[];
                return { rowId: `row-${rowIndex}`, cells };
            }) || []
        );
    }, [tablePreview?.columnInfo, columns]);

    const columnSizingOptions: TableColumnSizingOptions = useMemo(() => {
        return {
            [columns[0].columnId]: {
                defaultWidth: 100,
                minWidth: 50,
            },
            [columns[1].columnId]: {
                defaultWidth: 100,
                minWidth: 60,
            },
            [columns[2].columnId]: {
                defaultWidth: 65,
                minWidth: 30,
            },
            [columns[3].columnId]: {
                defaultWidth: 60,
                minWidth: 30,
            },
        };
    }, [columns]);

    const tableFeatures = useTableFeatures<FlatFileTableItem>(
        {
            columns,
            items,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
            }),
        ],
    );

    const renderCell = (cell: FlatFileTableCell, colIndex: number, rowIndex: number) => {
        switch (cell.type) {
            case INPUT_TYPE:
                return (
                    <Input
                        size="small"
                        className={classes.input}
                        defaultValue={cell.value.toString()}
                        onChange={(_event, data) =>
                            handleColumnChange(rowIndex, "newName", data?.value || "")
                        }
                    />
                );

            case DROPDOWN_TYPE:
                return (
                    <div className={classes.dropdown}>
                        <SearchableDropdown
                            size="small"
                            style={{ width: "100%", minWidth: "60px", height: "24px" }}
                            options={getDataTypeOptions(tablePreview!.columnInfo[rowIndex]).map(
                                (option) => ({
                                    value: option.name,
                                    text: option.displayName,
                                }),
                            )}
                            selectedOption={{
                                value: cell.value.toString(),
                                text: cell.value.toString(),
                            }}
                            ariaLabel={locConstants.flatFileImport.dataType}
                            onSelect={(option) =>
                                handleColumnChange(rowIndex, "newDataType", option.value)
                            }
                        />
                    </div>
                );

            case CHECKBOX_TYPE:
                return (
                    <Checkbox
                        className={classes.checkbox}
                        checked={checkedStates[colIndex][rowIndex]}
                        onChange={(_event, data) => {
                            const changedField =
                                colIndex === NEW_PRIMARY_KEY_COL_INDEX
                                    ? "newInPrimaryKey"
                                    : "newNullable";
                            handleColumnChange(
                                rowIndex,
                                changedField,
                                data.checked || false,
                                colIndex,
                            );
                        }}
                        disabled={
                            colIndex === NEW_NULLABLE_COL_INDEX &&
                            checkedStates[NEW_PRIMARY_KEY_COL_INDEX][rowIndex]
                        } // Disable "Allow Nulls" if "Primary Key" is checked
                    />
                );

            default:
                return null;
        }
    };

    const handleColumnChange = (
        updatedItemIndex: number,
        updatedField: string,
        newValue: string | boolean,
        colCheckboxIndex?: number,
    ) => {
        if (!columnChanges[updatedItemIndex]) {
            const originalColumn = tablePreview?.columnInfo[updatedItemIndex];
            columnChanges[updatedItemIndex] = {
                index: updatedItemIndex,
                newName: originalColumn?.name,
                newDataType: originalColumn?.sqlType,
                newNullable: originalColumn?.isNullable,
                newInPrimaryKey: originalColumn?.isInPrimaryKey || false,
            };
        }
        const updatedColumn = { ...columnChanges[updatedItemIndex], [updatedField]: newValue };
        const updatedColumns = { ...columnChanges, [updatedItemIndex]: updatedColumn };
        setColumnChanges(updatedColumns);

        if (colCheckboxIndex !== undefined) {
            const isChecked = Boolean(newValue);
            const updatedCheckedStates = { ...checkedStates };
            updatedCheckedStates[colCheckboxIndex][updatedItemIndex] = isChecked;
            setCheckedStates(updatedCheckedStates);
        }
    };

    const handleSelectAllChange = (colIndex: number, updatedField: string, isChecked: boolean) => {
        const updatedCheckedStates = { ...checkedStates };
        const allChecked = items.map(() => Boolean(isChecked));
        updatedCheckedStates[colIndex] = allChecked;
        setCheckedStates(updatedCheckedStates);

        // Update columnChanges for all rows in the column
        setColumnChanges((prev) => {
            const updated = { ...prev };

            tablePreview?.columnInfo.forEach((col, rowIndex) => {
                if (!updated[rowIndex]) {
                    updated[rowIndex] = {
                        index: rowIndex,
                        newName: col.name,
                        newDataType: col.sqlType,
                        newNullable: col.isNullable,
                        newInPrimaryKey: col.isInPrimaryKey || false,
                    };
                }

                updated[rowIndex] = {
                    ...updated[rowIndex],
                    [updatedField]: isChecked,
                };
            });

            return updated;
        });
    };

    return (
        <div className={classes.outerDiv}>
            <div className={classes.tableDiv}>
                <Table
                    {...keyboardNavAttr}
                    as="table"
                    className={classes.table}
                    size="extra-small"
                    ref={tableFeatures.tableRef}
                    {...tableFeatures.columnSizing_unstable.getTableProps()}>
                    <TableHeader className={classes.tableHeader}>
                        <TableRow>
                            {columns.map((column) => (
                                <TableHeaderCell
                                    key={column.columnId}
                                    className={classes.tableHeaderCell}
                                    {...tableFeatures.columnSizing_unstable.getTableHeaderCellProps(
                                        column.columnId,
                                    )}>
                                    {column.renderHeaderCell()}
                                </TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tableFeatures.getRows().map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                                {row.item.cells.map((cell, colIndex) => (
                                    <TableCell
                                        key={colIndex}
                                        className={classes.tableBodyCell}
                                        {...tableFeatures.columnSizing_unstable.getTableCellProps(
                                            cell.columnId,
                                        )}>
                                        <div className={classes.cellCenter}>
                                            {renderCell(cell, colIndex, rowIndex)}
                                        </div>
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};
