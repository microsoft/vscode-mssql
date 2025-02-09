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
    Tab,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableColumnSizingOptions,
    TableHeader,
    TableHeaderCell,
    TableRow,
    TabList,
    TabValue,
    Text,
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import {
    IColumn,
    IEntity,
    ISchema,
} from "../../../sharedInterfaces/schemaDesigner";
import { useEffect, useMemo, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    editor: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    editorPanel: {
        flex: "1",
        overflow: "hidden",
    },
    buttonStickyContainer: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "right",
        gap: "5px",
    },
    tablePanel: {
        display: "flex",
        flexDirection: "column",
        padding: "5px 0px",
        gap: "5px",
        overflow: "hidden",
        maxHeight: "calc(100% - 10px)",
    },
    tablePanelRow: {
        display: "flex",
        flexDirection: "row",
        flex: "1",
        gap: "5px",
        padding: "0px 5px",
        marginBottom: "5px",
    },
    dataTypeDropdown: {
        minWidth: "110px",
        maxWidth: "110px",
        "> button": {
            textOverflow: "ellipsis",
        },
    },
});

export const SchemaDesignerEntityEditor = (props: {
    entity: IEntity;
    schema: ISchema;
    resolveEntity: (entity: IEntity) => void;
}) => {
    if (!props.entity || !props.schema) {
        return undefined;
    }
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });

    const [selectedTabValue, setSelectedTabValue] = useState<TabValue>("table");
    const [selectedSchema, setSelectedSchema] = useState<string[]>([
        props.entity.schema,
    ]);
    const [schemaName, setSchemaName] = useState<string>(props.entity.schema);
    const [tableName, setTableName] = useState<string>(props.entity.name);
    const [tableColumns, setTableColumns] = useState<IColumn[]>(
        props.entity.columns,
    );
    const datatypes = useMemo(
        () => getUniqueDatatypes(props.schema),
        [props.schema],
    );
    // Storing column names inputs for focusing
    const columnInputRefs = useRef<Array<HTMLInputElement | null>>([]);

    const columnsTableColumns: TableColumnDefinition<IColumn>[] = [
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
            renderHeaderCell: () => (
                <Text>{locConstants.schemaDesigner.delete}</Text>
            ),
        }),
    ];

    const [columnSizingOptions, _setColumnSizingOptions] =
        useState<TableColumnSizingOptions>({
            name: {
                defaultWidth: 110,
                minWidth: 100,
                idealWidth: 110,
            },
            type: {
                defaultWidth: 110,
                minWidth: 100,
                idealWidth: 110,
            },
            primaryKey: {
                defaultWidth: 30,
                minWidth: 30,
                idealWidth: 30,
            },
            delete: {
                defaultWidth: 30,
                minWidth: 30,
                idealWidth: 30,
            },
        });

    const items: IColumn[] = tableColumns;

    const [columns] =
        useState<TableColumnDefinition<IColumn>[]>(columnsTableColumns);

    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
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

    useEffect(() => {
        setTableColumns(props.entity.columns);
        setTableName(props.entity.name);
        setSchemaName(props.entity.schema);
    }, [props.entity, props.resolveEntity]);

    function renderCell(column: IColumn, columnId: string, index: number) {
        switch (columnId) {
            case "name":
                return (
                    <Input
                        size="small"
                        style={{
                            minWidth: "110px",
                            maxWidth: "110px",
                            textOverflow: "ellipsis",
                        }}
                        ref={(ref) => {
                            columnInputRefs.current[index] = ref;
                        }}
                        value={column.name}
                        onChange={(_e, d) => {
                            const newColumns = [...tableColumns];
                            newColumns[index].name = d.value;
                            setTableColumns(newColumns);
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
                        onOptionSelect={(_e, data) => {
                            if (!data.optionText) {
                                return;
                            }
                            const newColumns = [...tableColumns];
                            newColumns[index].dataType = data.optionText;
                            setTableColumns(newColumns);
                        }}
                        className={classes.dataTypeDropdown}
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
                            const newColumns = [...tableColumns];
                            newColumns[index].isPrimaryKey =
                                d.checked as boolean;
                            setTableColumns(newColumns);
                        }}
                    />
                );
            case "delete":
                return (
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        onClick={() => {
                            const newColumns = [...tableColumns];
                            newColumns.splice(index, 1);
                            setTableColumns(newColumns);
                        }}
                    />
                );
            default:
                return <Text>{columnId}</Text>;
        }
    }

    function tablePanel() {
        return (
            <div className={classes.tablePanel}>
                {/* Row for schema and table name */}
                <div className={classes.tablePanelRow}>
                    <Field style={{ flex: "1" }}>
                        <Label>{locConstants.schemaDesigner.schema}</Label>
                        <Dropdown
                            size="small"
                            value={schemaName}
                            selectedOptions={selectedSchema}
                            multiselect={false}
                            onOptionSelect={(_e, data) => {
                                if (!data.optionText) {
                                    return;
                                }
                                setSchemaName(data.optionText);
                                setSelectedSchema([data.optionText]);
                            }}
                            style={{
                                minWidth: "auto",
                            }}
                        >
                            {getUniqueSchemaNames(props.schema).map(
                                (schema) => (
                                    <Option key={schema} value={schema}>
                                        {schema}
                                    </Option>
                                ),
                            )}
                        </Dropdown>
                    </Field>
                    <Field style={{ flex: "1" }}>
                        <Label>{locConstants.schemaDesigner.name}</Label>
                        <Input
                            autoFocus
                            size="small"
                            value={tableName}
                            onChange={(_e, d) => {
                                setTableName(d.value);
                            }}
                        />
                    </Field>
                </div>
                {/* Row for new column button */}
                <div className={classes.tablePanelRow}>
                    <Text
                        style={{
                            lineHeight: "22px",
                        }}
                    >
                        {locConstants.schemaDesigner.columns}
                    </Text>
                    <Button
                        size="small"
                        appearance="secondary"
                        icon={<AddRegular />}
                        onClick={() => {
                            const newColumns = [...tableColumns];
                            newColumns.push({
                                name: getNextColumnName(tableColumns),
                                dataType: datatypes[0],
                                isPrimaryKey: false,
                                isIdentity: false,
                            });
                            setTableColumns(newColumns);
                            // Focus on the new row
                            setTimeout(() => {
                                if (columnInputRefs.current.length > 0) {
                                    columnInputRefs.current[
                                        columnInputRefs.current.length - 1
                                    ]?.focus();
                                }
                            }, 100);
                        }}
                    >
                        {locConstants.schemaDesigner.newColumn}
                    </Button>
                </div>
                {/* Columns table */}
                <div style={{ flex: "1", overflow: "auto" }}>
                    <Table
                        {...keyboardNavAttr}
                        as="table"
                        size="extra-small"
                        {...columnSizing_unstable.getTableProps()}
                        ref={tableRef}
                    >
                        <TableHeader>
                            <TableRow>
                                {columnsTableColumns.map((column) => (
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
                                    {columns.map((column) => {
                                        return (
                                            <TableCell
                                                {...columnSizing_unstable.getTableCellProps(
                                                    column.columnId,
                                                )}
                                                key={column.columnId}
                                            >
                                                {renderCell(
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
    }
    return (
        <div className={classes.editor}>
            <TabList
                size="small"
                selectedValue={selectedTabValue}
                onTabSelect={(_e, data) => setSelectedTabValue(data.value)}
            >
                <Tab value="table">{locConstants.schemaDesigner.table}</Tab>
                <Tab value="foreignKeys">
                    {locConstants.schemaDesigner.foreignKey}
                </Tab>
            </TabList>
            <div className={classes.editorPanel}>
                {selectedTabValue === "table" && tablePanel()}
                {selectedTabValue === "foreignKeys" && (
                    <div>{locConstants.schemaDesigner.foreignKey}</div>
                )}
            </div>
            <div className={classes.buttonStickyContainer}>
                <Button
                    size="small"
                    appearance="primary"
                    onClick={() => {
                        props.resolveEntity({
                            name: tableName,
                            schema: schemaName,
                            columns: tableColumns,
                        });
                    }}
                >
                    {locConstants.schemaDesigner.save}
                </Button>
                <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => {
                        props.resolveEntity({
                            name: props.entity.name,
                            schema: props.entity.schema,
                            columns: props.entity.columns,
                        });
                    }}
                >
                    {locConstants.schemaDesigner.cancel}
                </Button>
            </div>
        </div>
    );
};

function getUniqueSchemaNames(schema: ISchema): string[] {
    const schemaNames: Set<string> = new Set<string>();
    schema.entities.forEach((entity) => {
        schemaNames.add(entity.schema);
    });
    return Array.from(schemaNames);
}

function getUniqueDatatypes(schema: ISchema): string[] {
    const datatypes: Set<string> = new Set<string>();
    schema.entities.forEach((entity) => {
        entity.columns.forEach((column) => {
            datatypes.add(column.dataType);
        });
    });
    return Array.from(datatypes);
}

function getNextColumnName(existingColumns: IColumn[]): string {
    let index = 1;
    let columnName = `Column_${index}`;
    while (existingColumns.some((column) => column.name === columnName)) {
        index++;
        columnName = `Column_${index}`;
    }
    return columnName;
}

function getUniqueTableNames(schema: ISchema): string[] {
    const tableNames: string[] = [];
    schema.entities.forEach((entity) => {
        if (!tableNames.includes(entity.name)) {
            tableNames.push(entity.name);
        }
    });
    return tableNames;
}

function getTableColumnMap(schema: ISchema): Map<string, string[]> {
    const tableColumnMap = new Map<string, string[]>();
    schema.entities.forEach((entity) => {
        tableColumnMap.set(
            entity.name,
            entity.columns.map((col) => col.name),
        );
    });
    return tableColumnMap;
}
