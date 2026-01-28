/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Input,
    makeStyles,
    Option,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileHeader } from "./flatFileHeader";
import { ChangeColumnSettingsParams } from "../../../models/contracts/flatFile";
import { FlatFileSummary } from "./flatFileSummary";

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
        width: "160px",
        margin: "20px",
    },
    bottomDiv: {
        bottom: 0,
        paddingBottom: "50px",
    },

    tableDiv: {
        overflow: "auto",
        maxHeight: "60vh",
        tableLayout: "fixed",
        position: "relative",
        margin: "20px",
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
    },

    tableBodyCell: {
        overflow: "hidden",
    },

    cellText: {
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    columnText: {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    operationText: {
        whiteSpace: "wrap",
        margin: "20px",
    },
});

export const FlatFileColumnSettings = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

    if (!context || !state) return;

    const [showNext, setShowNext] = useState<boolean>(false);
    const [columnChanges, setColumnChanges] = useState<Record<number, ChangeColumnSettingsParams>>(
        {},
    );

    const INPUT_TYPE = "input";
    const CHECKBOX_TYPE = "checkbox";
    const DROPDOWN_TYPE = "dropdown";

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

    const columns = [
        { header: locConstants.flatFileImport.columnName, inputType: INPUT_TYPE },
        { header: locConstants.flatFileImport.dataType, inputType: DROPDOWN_TYPE },
        { header: locConstants.flatFileImport.primaryKey, inputType: CHECKBOX_TYPE },
        { header: locConstants.flatFileImport.allowNulls, inputType: CHECKBOX_TYPE },
    ];

    const handleColumnChange = (
        updatedColumnIndex: number,
        updatedField: string,
        newValue: string | boolean,
    ) => {
        if (!columnChanges[updatedColumnIndex]) {
            const originalColumn = state.tablePreview?.columnInfo[updatedColumnIndex];
            columnChanges[updatedColumnIndex] = {
                index: updatedColumnIndex,
                newName: originalColumn?.name,
                newDataType: originalColumn?.sqlType,
                newNullable: originalColumn?.isNullable,
                newIsPrimaryKey: originalColumn?.isInPrimaryKey || false,
            };
        }
        const updatedColumn = { ...columnChanges[updatedColumnIndex], [updatedField]: newValue };
        const updatedColumns = { ...columnChanges, [updatedColumnIndex]: updatedColumn };
        setColumnChanges(updatedColumns);
    };

    const handleSubmit = () => {
        context.setColumnChanges(Object.values(columnChanges));
        setShowNext(true);
    };

    return showNext ? (
        <FlatFileSummary />
    ) : (
        <div className={classes.outerDiv}>
            <FlatFileHeader
                headerText={locConstants.flatFileImport.importFile}
                stepText={locConstants.flatFileImport.stepThree}
            />

            <div className={classes.tableDiv}>
                <Table>
                    <TableHeader className={classes.tableHeader}>
                        <TableRow>
                            {columns.map((column, index) => (
                                <TableHeaderCell
                                    key={column.header}
                                    className={classes.tableHeaderCell}>
                                    <Text className={classes.columnText}>{column.header}</Text>
                                    {column.inputType === CHECKBOX_TYPE && (
                                        <Checkbox id={`select-all-${index}`} />
                                    )}
                                </TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {state.tablePreview?.columnInfo.map((colInfo, index) => (
                            <TableRow key={index}>
                                <TableCell className={classes.tableBodyCell}>
                                    <Input
                                        className={classes.cellText}
                                        defaultValue={colInfo.name}
                                        onChange={(_event, data) => {
                                            handleColumnChange(index, "newName", data?.value || "");
                                        }}
                                    />
                                </TableCell>
                                <TableCell className={classes.tableBodyCell}>
                                    <Dropdown
                                        defaultValue={colInfo.sqlType}
                                        onOptionSelect={(_event, data) => {
                                            handleColumnChange(
                                                index,
                                                "newDataType",
                                                data.optionValue as string,
                                            );
                                        }}>
                                        {dataTypeCategoryValues.map((option) => (
                                            <Option key={option.name} text={option.displayName}>
                                                {option.displayName}
                                            </Option>
                                        ))}
                                    </Dropdown>
                                </TableCell>
                                <TableCell className={classes.tableBodyCell}>
                                    <Checkbox
                                        defaultChecked={false}
                                        onChange={(_event, data) => {
                                            handleColumnChange(
                                                index,
                                                "newIsPrimaryKey",
                                                data.checked || false,
                                            );
                                        }}
                                    />
                                </TableCell>
                                <TableCell className={classes.tableBodyCell}>
                                    <Checkbox
                                        defaultChecked={colInfo.isNullable}
                                        onChange={(_event, data) => {
                                            handleColumnChange(
                                                index,
                                                "newNullable",
                                                data.checked || false,
                                            );
                                        }}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <div className={classes.bottomDiv}>
                <hr style={{ background: tokens.colorNeutralBackground2 }} />
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => handleSubmit()}
                    appearance="primary">
                    {locConstants.flatFileImport.importData}
                </Button>
            </div>
        </div>
    );
};
