/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import {
    Button,
    Checkbox,
    createTableColumn,
    Dropdown,
    Input,
    makeStyles,
    Option,
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
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileHeader } from "./flatFileHeader";
import { ChangeColumnSettingsParams } from "../../../models/contracts/flatFile";
import { FlatFileSummary } from "./flatFileSummary";
import { FlatFilePreviewTable } from "./flatFilePreviewTable";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    button: {
        height: "32px",
        width: "120px",
        margin: "5px",
    },

    bottomDiv: {
        bottom: 0,
        paddingBottom: "25px",
    },

    tableDiv: {
        overflow: "auto",
        position: "relative",
        width: "85%",
        margin: "20px",
    },

    table: {
        tableLayout: "fixed",
        width: "100%",
        height: "100%",
        maxWidth: "100%",
        overflow: "auto",
    },

    tableHeader: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        opacity: 1,
    },

    tableHeaderCell: {
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground6,
        opacity: 1,
        maxWidth: "400px",
    },

    tableBodyCell: {
        overflow: "hidden",
    },

    cellText: {
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        width: "100%",
    },

    columnText: {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: "center",
        display: "block",
    },

    cellCenter: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: 0,
    },

    headerCenter: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        width: "100%",
    },

    headerItems: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "4px",
        padding: "4px",
    },

    dropdown: {
        width: "100%",
        textAlign: "left",
        boxSizing: "border-box",
        minWidth: "60px",
    },
});

type Item = {
    rowId: string;
    cells: Cell[];
};

type Cell = {
    columnId: TableColumnId;
    value: string | boolean;
    type: string;
};

export const FlatFileColumnSettings = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

    if (!context || !state) return;

    const [showNext, setShowNext] = useState<boolean>(false);
    const [showPrevious, setShowPrevious] = useState<boolean>(false);
    const [columnChanges, setColumnChanges] = useState<Record<number, ChangeColumnSettingsParams>>(
        {},
    );

    const INPUT_TYPE = "input";
    const CHECKBOX_TYPE = "checkbox";
    const DROPDOWN_TYPE = "dropdown";
    const NEW_PRIMARY_KEY_COL_INDEX = 2;
    const NEW_NULLABLE_COL_INDEX = 3;

    const dataTypeCategoryValues = [
        { name: "bigint", displayName: "bigint" },
        { name: "binary(50)", displayName: "binary(50)" },
        { name: "bit", displayName: "bit" },
        { name: "char(10)", displayName: "char(10)" },
        { name: "date", displayName: "date" },
        { name: "datetime", displayName: "datetime" },
        { name: "datetime2(7)", displayName: "datetime2(7)" },
        { name: "datetimeoffset(7)", displayName: "datetimeoffset(7)" },
        { name: "decimal(18, 10)", displayName: "decimal(18, 10)" },
        { name: "float", displayName: "float" },
        { name: "geography", displayName: "geography" },
        { name: "geometry", displayName: "geometry" },
        { name: "hierarchyid", displayName: "hierarchyid" },
        { name: "int", displayName: "int" },
        { name: "money", displayName: "money" },
        { name: "nchar(10)", displayName: "nchar(10)" },
        { name: "ntext", displayName: "ntext" },
        { name: "numeric(18, 0)", displayName: "numeric(18, 0)" },
        { name: "nvarchar(50)", displayName: "nvarchar(50)" },
        { name: "nvarchar(MAX)", displayName: "nvarchar(MAX)" },
        { name: "real", displayName: "real" },
        { name: "smalldatetime", displayName: "smalldatetime" },
        { name: "smallint", displayName: "smallint" },
        { name: "smallmoney", displayName: "smallmoney" },
        { name: "sql_variant", displayName: "sql_variant" },
        { name: "text", displayName: "text" },
        { name: "time(7)", displayName: "time(7)" },
        { name: "timestamp", displayName: "timestamp" },
        { name: "tinyint", displayName: "tinyint" },
        { name: "uniqueidentifier", displayName: "uniqueidentifier" },
        { name: "varbinary(50)", displayName: "varbinary(50)" },
        { name: "varbinary(MAX)", displayName: "varbinary(MAX)" },
        { name: "varchar(50)", displayName: "varchar(50)" },
        { name: "varchar(MAX)", displayName: "varchar(MAX)" },
    ];
    const columnInfo = [
        { header: locConstants.flatFileImport.columnName, inputType: INPUT_TYPE },
        { header: locConstants.flatFileImport.dataType, inputType: DROPDOWN_TYPE },
        { header: locConstants.flatFileImport.primaryKey, inputType: CHECKBOX_TYPE },
        { header: locConstants.flatFileImport.allowNulls, inputType: CHECKBOX_TYPE },
    ];

    // Indices 2 and 3 correspond to the checkbox columns,
    // which require special handling for the "Select All" functionality.
    const [checkedStates, setCheckedStates] = useState<Record<number, boolean[]>>({
        [NEW_PRIMARY_KEY_COL_INDEX]: state.tablePreview?.columnInfo.map(() => false) || [],
        [NEW_NULLABLE_COL_INDEX]: state.tablePreview?.columnInfo.map(() => false) || [],
    });

    const columns: TableColumnDefinition<Item>[] = useMemo(
        () =>
            columnInfo.map((column, index) =>
                createTableColumn<Item>({
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

    const items: Item[] = useMemo(() => {
        return (
            state.tablePreview?.columnInfo.map((row, rowIndex) => {
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
                ] as Cell[];
                return { rowId: `row-${rowIndex}`, cells };
            }) || []
        );
    }, [state.tablePreview?.columnInfo, columns]);

    const columnSizingOptions: TableColumnSizingOptions = useMemo(() => {
        return {
            [columns[0].columnId]: {
                defaultWidth: 100,
                minWidth: 50,
                idealWidth: 100,
            },
            [columns[1].columnId]: {
                defaultWidth: 100,
                minWidth: 60,
                idealWidth: 100,
            },
            [columns[2].columnId]: {
                defaultWidth: 60,
                minWidth: 20,
                idealWidth: 60,
            },
            [columns[3].columnId]: {
                defaultWidth: 60,
                minWidth: 20,
                idealWidth: 60,
            },
        };
    }, [columns]);

    const tableFeatures = useTableFeatures<Item>(
        {
            columns,
            items,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 20,
            }),
        ],
    );

    const renderCell = (cell: Cell, colIndex: number, rowIndex: number) => {
        switch (cell.type) {
            case INPUT_TYPE:
                return (
                    <Input
                        size="small"
                        defaultValue={cell.value.toString()}
                        onChange={(_event, data) =>
                            handleColumnChange(colIndex, "newName", data?.value || "")
                        }
                    />
                );

            case DROPDOWN_TYPE:
                return (
                    <Dropdown
                        size="small"
                        defaultValue={cell.value.toString()}
                        className={classes.dropdown}
                        onOptionSelect={(_event, data) =>
                            handleColumnChange(colIndex, "newDataType", data.optionValue as string)
                        }>
                        {dataTypeCategoryValues.map((option) => (
                            <Option key={option.name} text={option.displayName}>
                                {option.displayName}
                            </Option>
                        ))}
                    </Dropdown>
                );

            case CHECKBOX_TYPE:
                return (
                    <Checkbox
                        checked={checkedStates[colIndex][rowIndex]}
                        onChange={(_event, data) => {
                            const changedField =
                                colIndex === NEW_PRIMARY_KEY_COL_INDEX
                                    ? "newInPrimaryKey"
                                    : "newNullable";
                            handleColumnChange(colIndex, changedField, data.checked || false);
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
    ) => {
        if (!columnChanges[updatedItemIndex]) {
            const originalColumn = state.tablePreview?.columnInfo[updatedItemIndex];
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

        if (updatedField === "newInPrimaryKey" || updatedField === "newNullable") {
            const colIndex =
                updatedField === "newInPrimaryKey"
                    ? NEW_PRIMARY_KEY_COL_INDEX
                    : NEW_NULLABLE_COL_INDEX;
            const isChecked = Boolean(newValue);
            const updatedCheckedStates = { ...checkedStates };
            updatedCheckedStates[colIndex][updatedItemIndex] = isChecked;
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

            state.tablePreview?.columnInfo.forEach((col, rowIndex) => {
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

    const handleSubmit = () => {
        context.setColumnChanges(Object.values(columnChanges));
        setShowNext(true);
    };

    return showPrevious ? (
        <FlatFilePreviewTable />
    ) : showNext ? (
        <FlatFileSummary />
    ) : (
        <div className={classes.outerDiv}>
            <FlatFileHeader
                headerText={locConstants.flatFileImport.importFile}
                stepText={locConstants.flatFileImport.stepThree}
            />

            <div className={classes.tableDiv}>
                <Table
                    className={classes.table}
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

            <div className={classes.bottomDiv}>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => setShowPrevious(true)}
                    appearance="secondary">
                    {locConstants.common.previous}
                </Button>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => handleSubmit()}
                    appearance="primary">
                    {locConstants.flatFileImport.importData}
                </Button>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => context.dispose()}
                    appearance="secondary">
                    {locConstants.common.cancel}
                </Button>
            </div>
        </div>
    );
};
