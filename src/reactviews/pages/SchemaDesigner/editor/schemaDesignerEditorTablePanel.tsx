/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    createTableColumn,
    Field,
    InfoLabel,
    Input,
    Label,
    makeStyles,
    Popover,
    PopoverSurface,
    PopoverTrigger,
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
import {
    fillColumnDefaults,
    getAllTables,
    getNextColumnName,
    isLengthBasedType,
    isPrecisionBasedType,
} from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SearchableDropdown } from "../../../common/searchableDropdown.component";

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
            createTableColumn({
                columnId: "menu",
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
            menu: {
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

    const getColumnAdvancedOptionsState = (
        column: SchemaDesigner.Column,
        index: number,
    ) => {
        return (
            <>
                <Field>
                    <Checkbox
                        size="medium"
                        checked={column.isNullable}
                        onChange={(_e, d) => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].isIdentity = d.checked as boolean;
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                        label={"Allow NULL"}
                    />
                </Field>
                <Field>
                    <Checkbox
                        size="medium"
                        checked={column.isUnique}
                        onChange={(_e, d) => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].isUnique = d.checked as boolean;
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                        label={"Unique"}
                    />
                </Field>
                <Field>
                    <Checkbox
                        size="medium"
                        checked={column.isIdentity}
                        onChange={(_e, d) => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].isIdentity = d.checked as boolean;
                            if (d.checked) {
                                newColumns[index].identitySeed = 1;
                                newColumns[index].identityIncrement = 1;
                            }
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                        label={"Identity"}
                    />
                </Field>
                {isLengthBasedType(column.dataType) && (
                    <Field
                        label={{
                            children: (
                                <InfoLabel
                                    size="small"
                                    info={"Max length of the column"}
                                >
                                    {"Max Length"}
                                </InfoLabel>
                            ),
                        }}
                    >
                        <Input
                            size="small"
                            type="number"
                            value={column.maxLength.toString()}
                            onChange={(_e, d) => {
                                const newColumns = [
                                    ...context.selectedTable.columns,
                                ];
                                newColumns[index].maxLength = parseInt(
                                    d.value,
                                ) as number;
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    columns: newColumns,
                                });
                            }}
                        />
                    </Field>
                )}
                {isPrecisionBasedType(column.dataType) && (
                    <>
                        <Field
                            label={{
                                children: (
                                    <InfoLabel
                                        size="small"
                                        info={"Precision of the column"}
                                    >
                                        {"Precision"}
                                    </InfoLabel>
                                ),
                            }}
                        >
                            <Input
                                size="small"
                                type="number"
                                value={column.precision.toString()}
                                onChange={(_e, d) => {
                                    const newColumns = [
                                        ...context.selectedTable.columns,
                                    ];
                                    newColumns[index].precision = parseInt(
                                        d.value,
                                    ) as number;
                                    context.setSelectedTable({
                                        ...context.selectedTable,
                                        columns: newColumns,
                                    });
                                }}
                            />
                        </Field>
                        <Field
                            label={{
                                children: (
                                    <InfoLabel
                                        size="small"
                                        info={"Scale of the column"}
                                    >
                                        {"Scale"}
                                    </InfoLabel>
                                ),
                            }}
                        >
                            <Input
                                size="small"
                                type="number"
                                value={column.scale.toString()}
                                onChange={(_e, d) => {
                                    const newColumns = [
                                        ...context.selectedTable.columns,
                                    ];
                                    newColumns[index].scale = parseInt(
                                        d.value,
                                    ) as number;
                                    context.setSelectedTable({
                                        ...context.selectedTable,
                                        columns: newColumns,
                                    });
                                }}
                            />
                        </Field>
                    </>
                )}
            </>
        );
    };

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
                    <SearchableDropdown
                        placeholder="Search Schema"
                        options={datatypes.map((datatype) => ({
                            displayName: datatype,
                            value: datatype,
                        }))}
                        selectedOption={{
                            text: column.dataType,
                            value: column.dataType,
                        }}
                        onSelect={(selected) => {
                            const newColumns = [
                                ...context.selectedTable.columns,
                            ];
                            newColumns[index].dataType = selected.value;
                            newColumns[index] = fillColumnDefaults(
                                newColumns[index],
                            );
                            context.setSelectedTable({
                                ...context.selectedTable,
                                columns: newColumns,
                            });
                        }}
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                        }}
                        size="small"
                    ></SearchableDropdown>
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
            case "menu":
                const id = "schema-designer-menu-" + column.id;
                return (
                    <Popover
                        trapFocus
                        positioning={{
                            position: "below",
                        }}
                    >
                        <PopoverTrigger disableButtonEnhancement>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<FluentIcons.MoreHorizontalRegular />}
                            ></Button>
                        </PopoverTrigger>

                        <PopoverSurface aria-labelledby={id}>
                            <div>
                                <h3 id={id}>Advanced options</h3>
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "5px",
                                }}
                            >
                                {getColumnAdvancedOptionsState(column, index)}
                            </div>
                        </PopoverSurface>
                    </Popover>
                );
            default:
                return <Text>{columnId}</Text>;
        }
    }

    return (
        <div className={classes.tablePanel}>
            <Field>
                <Label>{locConstants.schemaDesigner.schema}</Label>
                <SearchableDropdown
                    placeholder="Search Schema"
                    options={context.schemaNames.map((schema) => ({
                        displayName: schema,
                        value: schema,
                    }))}
                    selectedOption={{
                        text: context.selectedTable.schema,
                        value: context.selectedTable.schema,
                    }}
                    onSelect={(selected) => {
                        context.setSelectedTable({
                            ...context.selectedTable,
                            schema: selected.value,
                        });
                    }}
                ></SearchableDropdown>
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
                        dataType: "int",
                        isPrimaryKey: newColumns.length === 0,
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
