/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    createTableColumn,
    Dropdown,
    Field,
    Input,
    Label,
    makeStyles,
    Option,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableColumnSizingOptions,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import * as FluentIcons from "@fluentui/react-icons";
import { v4 as uuidv4 } from "uuid";
import { getAllTables, getNextColumnName } from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const useStyles = makeStyles({
    tablePanel: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "10px",
        gap: "10px",
    },
});

export const SchemaDesignerEditorTablePanel = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });

    const columnNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastColumnNameInputIndex, setLastColumnNameInputIndex] =
        useState<number>(-1);
    const datatypes = useMemo(() => context.datatypes, [context.datatypes]);
    const allTables = useMemo(() => {
        if (!context.schemaDesigner?.schema) {
            return [];
        }
        return getAllTables(
            context.schemaDesigner.schema,
            context.selectedTable,
        );
    }, [context.selectedTable]);
    const columnsTableColumnDefinitions: TableColumnDefinition<SchemaDesigner.Column>[] =
        [
            createTableColumn({
                columnId: "name",
                renderHeaderCell: () => (
                    <Text>{locConstants.schemaDesigner.name}</Text>
                ),
            }),
            createTableColumn({
                columnId: "type",
                renderHeaderCell: () => (
                    <Text>{locConstants.schemaDesigner.dataType}</Text>
                ),
            }),
            createTableColumn({
                columnId: "primaryKey",
                renderHeaderCell: () => (
                    <Text>{locConstants.schemaDesigner.primaryKey}</Text>
                ),
            }),
            createTableColumn({
                columnId: "delete",
                renderHeaderCell: () => <Text></Text>,
            }),
        ];
    const [columnsTableSizingOptions, _setColumnsTableSizingOptions] =
        useState<TableColumnSizingOptions>({
            name: {
                defaultWidth: 150,
                minWidth: 150,
                idealWidth: 150,
            },
            type: {
                defaultWidth: 150,
                minWidth: 150,
                idealWidth: 150,
            },
            primaryKey: {
                defaultWidth: 70,
                minWidth: 70,
                idealWidth: 70,
            },
            delete: {
                defaultWidth: 30,
                minWidth: 30,
                idealWidth: 30,
            },
        });
    const columnsTableItems: SchemaDesigner.Column[] =
        context.selectedTable.columns;

    const [columnsTableColumns] = useState<
        TableColumnDefinition<SchemaDesigner.Column>[]
    >(columnsTableColumnDefinitions);
    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns: columnsTableColumns,
            items: columnsTableItems,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions: columnsTableSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 20,
            }),
        ],
    );
    useEffect(() => {
        setLastColumnNameInputIndex(-1);
    }, [context.selectedTable]);

    useEffect(() => {
        if (lastColumnNameInputIndex >= 0) {
            columnNameInputRefs.current[lastColumnNameInputIndex]?.focus();
        }
    }, [lastColumnNameInputIndex]);

    function getColumnDeleteButtonState(
        column: SchemaDesigner.Column,
    ): boolean {
        // If there is an incoming or outgoing foreign key with this column, disable delete
        const doesColumnHaveForeignKey =
            context.selectedTable.foreignKeys.filter((fk) =>
                fk.columns.includes(column.name),
            ).length > 0;

        // If this column is a referenced column in any foreign key, disable delete
        const isColumnAlsoAReferencedColumn =
            allTables.filter((table) => {
                return table.foreignKeys.some((fk) =>
                    fk.referencedColumns.includes(column.name),
                );
            }).length > 0;

        return doesColumnHaveForeignKey || isColumnAlsoAReferencedColumn;
    }

    function renderColumnTableCell(
        column: SchemaDesigner.Column,
        columnId: string,
        index: number,
    ) {
        switch (columnId) {
            case "name":
                return (
                    <Input
                        size="small"
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                            textOverflow: "ellipsis",
                        }}
                        ref={(ref) => {
                            columnNameInputRefs.current[index] = ref;
                        }}
                        value={column.name}
                        onChange={(_e, d) => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].name = d.value;
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                    />
                );
            case "type":
                return (
                    <Dropdown
                        size="small"
                        value={column.dataType}
                        selectedOptions={[column.dataType]}
                        multiselect={false}
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                        }}
                        onOptionSelect={(_e, data) => {
                            if (!data.optionText) {
                                return;
                            }
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].dataType = data.optionText;
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                    >
                        {datatypes.map((type) => (
                            <Option key={type} value={type}>
                                {type}
                            </Option>
                        ))}
                    </Dropdown>
                );
            case "primaryKey":
                return (
                    <Checkbox
                        size="medium"
                        checked={column.isPrimaryKey}
                        onChange={(_e, d) => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].isPrimaryKey =
                                d.checked as boolean;
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                    />
                );
            case "delete":
                return (
                    <Button
                        size="small"
                        appearance="subtle"
                        disabled={getColumnDeleteButtonState(column)}
                        icon={<FluentIcons.DeleteRegular />}
                        onClick={() => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns.splice(index, 1);
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                    />
                );
            default:
                return <Text>{columnId}</Text>;
        }
    }

    return (
        <div className={classes.tablePanel}>
            <Field>
                <Label>{locConstants.schemaDesigner.schema}</Label>
                <Dropdown
                    value={context.selectedTable.schema}
                    selectedOptions={[context.selectedTable.schema]}
                    multiselect={false}
                    onOptionSelect={(_e, data) => {
                        if (!data.optionText) {
                            return;
                        }
                        context.setSelectedTable({
                            ...context.selectedTable,
                            schema: data.optionText,
                        });
                    }}
                    style={{
                        minWidth: "auto",
                    }}
                >
                    {context.schemaNames.map((schema) => (
                        <Option key={schema} value={schema}>
                            {schema}
                        </Option>
                    ))}
                </Dropdown>
            </Field>
            <Field>
                <Label>{locConstants.schemaDesigner.name}</Label>
                <Input
                    autoFocus
                    value={context.selectedTable.name}
                    onChange={(_e, d) => {
                        context.setSelectedTable({
                            ...context.selectedTable,
                            name: d.value,
                        });
                    }}
                />
            </Field>
            <Button
                appearance="secondary"
                icon={<FluentIcons.AddRegular />}
                onClick={() => {
                    const newColumns = [...context.selectedTable.columns];
                    newColumns.push({
                        id: uuidv4(),
                        name: getNextColumnName(newColumns),
                        dataType: datatypes[0],
                        isPrimaryKey: false,
                        isIdentity: false,
                        isNullable: true,
                        isUnique: false,
                        maxLength: 0,
                        precision: 0,
                        scale: 0,
                        collation: "",
                        identitySeed: 1,
                        identityIncrement: 1,
                    });
                    context.setSelectedTable({
                        ...context.selectedTable,
                        columns: newColumns,
                    });
                    setLastColumnNameInputIndex(newColumns.length - 1);
                }}
                style={{
                    width: "fit-content",
                }}
            >
                {locConstants.schemaDesigner.newColumn}
            </Button>
            <div
                style={{
                    flex: "1",
                    overflowY: "auto",
                    overflowX: "hidden",
                }}
            >
                <Table
                    {...keyboardNavAttr}
                    as="table"
                    size="extra-small"
                    {...columnSizing_unstable.getTableProps()}
                    ref={tableRef}
                >
                    <TableHeader>
                        <TableRow>
                            {columnsTableColumnDefinitions.map((column) => (
                                <TableHeaderCell
                                    {...columnSizing_unstable.getTableHeaderCellProps(
                                        column.columnId,
                                    )}
                                    key={column.columnId}
                                >
                                    {column.renderHeaderCell()}
                                </TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {getRows().map((row, index) => (
                            <TableRow key={index}>
                                {columnsTableColumns.map((column) => {
                                    return (
                                        <TableCell
                                            {...columnSizing_unstable.getTableCellProps(
                                                column.columnId,
                                            )}
                                            key={column.columnId}
                                        >
                                            {renderColumnTableCell(
                                                row.item,
                                                column.columnId as string,
                                                index,
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};
