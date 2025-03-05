/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    CardHeader,
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
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useEffect, useMemo, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import * as azdataGraph from "azdataGraph";
import { v4 as uuidv4 } from "uuid";

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
        borderTop: "1px solid var(--vscode-badge-background)",
        paddingTop: "5px",
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
    },
    dataTypeDropdown: {
        minWidth: "110px",
        maxWidth: "110px",
        "> button": {
            textOverflow: "ellipsis",
        },
    },
    foreignKeyContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        padding: "5px",
        borderTop: "1px solid",
    },
});

export const SchemaDesignerTableEditor = (props: {
    table: SchemaDesigner.Table;
    schema: SchemaDesigner.Schema;
    schemaDesigner: azdataGraph.SchemaDesigner | undefined;
    onClose: () => void;
}) => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });

    const [selectedTabValue, setSelectedTabValue] = useState<TabValue>("table");
    const [selectedSchema, setSelectedSchema] = useState<string[]>([]);
    const [schemaName, setSchemaName] = useState<string>("");
    const [tableName, setTableName] = useState<string>("");
    const [nameValidation, _setNameValidation] = useState<string>("");
    const [tableColumns, setTableColumns] = useState<SchemaDesigner.Column[]>(
        [],
    );
    const [tableForeignKeys, setTableForeignKeys] = useState<
        SchemaDesigner.ForeignKey[]
    >([]);
    const datatypes = useMemo(
        () => getUniqueDatatypes(props.schema),
        [props.schema],
    );

    const entityNameRef = useRef<HTMLInputElement | null>(null);

    // Storing column names inputs for focusing
    const columnNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastColumnNameInputIndex, setLastColumnNameInputIndex] =
        useState<number>(-1);

    const foreignKeyNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastForeignKeyNameInputIndex, setLastForeignKeyNameInputIndex] =
        useState<number>(-1);

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
                renderHeaderCell: () => (
                    <Text>{locConstants.schemaDesigner.delete}</Text>
                ),
            }),
        ];

    function getColumnDeleteButtonState(
        column: SchemaDesigner.Column,
    ): boolean {
        // If there is an incoming or outgoing foreign key with this column, disable delete
        const doesColumnHaveForeignKey =
            tableForeignKeys.filter((fk) => fk.columns.includes(column.name))
                .length > 0;

        const isColumnAlsoAReferencedColumn =
            getAllEntities(props.schema, props.table).filter((table) => {
                return table.foreignKeys.some((fk) =>
                    fk.referencedColumns.includes(column.name),
                );
            }).length > 0;

        return doesColumnHaveForeignKey || isColumnAlsoAReferencedColumn;
    }

    const [columnsTableSizingOptions, _setColumnsTableSizingOptions] =
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

    const columnsTableItems: SchemaDesigner.Column[] = tableColumns;

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
        setSelectedTabValue("table");
        if (props.table) {
            setTableColumns(JSON.parse(JSON.stringify(props.table.columns)));
            setTableName(props.table.name);
            setSchemaName(props.table.schema);
            setTableForeignKeys(props.table.foreignKeys.slice());
            setSelectedSchema([props.table.schema]);
            setLastColumnNameInputIndex(-1);
            setLastForeignKeyNameInputIndex(-1);
        }
        if (entityNameRef.current) {
            entityNameRef.current?.focus();
        }
    }, [props.table, props.schemaDesigner]);

    useEffect(() => {
        if (lastColumnNameInputIndex >= 0) {
            columnNameInputRefs.current[lastColumnNameInputIndex]?.focus();
        }
    }, [lastColumnNameInputIndex]);

    useEffect(() => {
        if (lastForeignKeyNameInputIndex >= 0) {
            foreignKeyNameInputRefs.current[
                lastForeignKeyNameInputIndex
            ]?.focus();
        }
    }, [lastForeignKeyNameInputIndex]);

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
                            minWidth: "110px",
                            maxWidth: "110px",
                            textOverflow: "ellipsis",
                        }}
                        ref={(ref) => {
                            columnNameInputRefs.current[index] = ref;
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
                        disabled={getColumnDeleteButtonState(column)}
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
                    <Field
                        style={{ flex: "1" }}
                        validationMessage={nameValidation}
                        validationState={nameValidation ? "error" : undefined}
                    >
                        <Label>{locConstants.schemaDesigner.name}</Label>
                        <Input
                            autoFocus
                            size="small"
                            ref={entityNameRef}
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
                                id: uuidv4(),
                                name: getNextColumnName(tableColumns),
                                dataType: datatypes[0],
                                isPrimaryKey: false,
                                isIdentity: false,
                                isNullable: true,
                                isUnique: false,
                            });
                            setTableColumns(newColumns);
                            setLastColumnNameInputIndex(newColumns.length - 1);
                        }}
                    >
                        {locConstants.schemaDesigner.newColumn}
                    </Button>
                </div>
                {/* Columns table */}
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
    }

    function foreignKeyPanel() {
        return (
            <div className={classes.tablePanel}>
                <Button
                    size="small"
                    style={{
                        maxWidth: "150px",
                        minHeight: "24px",
                        marginBottom: "5px",
                    }}
                    icon={<AddRegular />}
                    onClick={() => {
                        const firstTable = getAllEntities(
                            props.schema,
                            props.table,
                        )[0];
                        const newForeignKey: SchemaDesigner.ForeignKey = {
                            id: uuidv4(),
                            name: getNextForeignKeyName(tableForeignKeys),
                            columns: [tableColumns[0].name],
                            referencedSchemaName: firstTable.schema,
                            referencedTableName: firstTable.name,
                            referencedColumns: [firstTable.columns[0].name],
                            onDeleteAction: SchemaDesigner.OnAction.CASCADE,
                            onUpdateAction: SchemaDesigner.OnAction.CASCADE,
                        };
                        const newForeignKeys = [
                            ...tableForeignKeys,
                            newForeignKey,
                        ];
                        setTableForeignKeys(newForeignKeys);
                        setLastForeignKeyNameInputIndex(
                            newForeignKeys.length - 1,
                        );
                    }}
                >
                    {locConstants.schemaDesigner.newForeignKey}
                </Button>
                <div
                    style={{
                        flex: "1",
                        overflow: "auto",
                        padding: "5px",
                    }}
                >
                    {tableForeignKeys.map((fk, index) => {
                        return (
                            <Card
                                style={{
                                    marginBottom: "10px",
                                    borderColor:
                                        "var(--vscode-badge-background)",
                                }}
                                key={`${fk.name}-${index}`}
                            >
                                <CardHeader
                                    header={
                                        <Text>
                                            {locConstants.schemaDesigner.foreignKeyIndex(
                                                index + 1,
                                            )}
                                        </Text>
                                    }
                                    action={
                                        <Button
                                            appearance="subtle"
                                            icon={<DeleteRegular />}
                                            onClick={() => {
                                                const newForeignKeys = [
                                                    ...tableForeignKeys,
                                                ];
                                                newForeignKeys.splice(index, 1);
                                                setTableForeignKeys(
                                                    newForeignKeys,
                                                );
                                            }}
                                        ></Button>
                                    }
                                ></CardHeader>
                                <div className={classes.tablePanelRow}>
                                    <Field style={{ flex: 1 }} size="small">
                                        <Label>
                                            {locConstants.schemaDesigner.name}
                                        </Label>
                                        <Input
                                            size="small"
                                            value={tableForeignKeys[index].name}
                                            ref={(ref) => {
                                                foreignKeyNameInputRefs.current[
                                                    index
                                                ] = ref;
                                            }}
                                            onChange={(_e, d) => {
                                                const newEdges = [
                                                    ...tableForeignKeys,
                                                ];
                                                newEdges[index].name = d.value;
                                                setTableForeignKeys(newEdges);
                                            }}
                                        />
                                    </Field>
                                </div>
                                <div className={classes.tablePanelRow}>
                                    <Field style={{ flex: 1 }} size="small">
                                        <Label>
                                            {
                                                locConstants.schemaDesigner
                                                    .targetTable
                                            }
                                        </Label>
                                        <Dropdown
                                            size="small"
                                            value={`${fk.referencedSchemaName}.${fk.referencedTableName}`}
                                            selectedOptions={[
                                                `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                                            ]}
                                            multiselect={false}
                                            onOptionSelect={(_e, data) => {
                                                if (!data.optionText) {
                                                    return;
                                                }
                                                const newForeignKeys = [
                                                    ...tableForeignKeys,
                                                ];
                                                const entity =
                                                    getEntityFromDisplayName(
                                                        props.schema,
                                                        data.optionText,
                                                    );
                                                newForeignKeys[
                                                    index
                                                ].referencedTableName =
                                                    entity.name;
                                                newForeignKeys[
                                                    index
                                                ].referencedSchemaName =
                                                    entity.schema;
                                                newForeignKeys[
                                                    index
                                                ].referencedColumns = [
                                                    entity.columns[0].name,
                                                ];
                                                setTableForeignKeys(
                                                    newForeignKeys,
                                                );
                                            }}
                                            style={{
                                                minWidth: "auto",
                                            }}
                                        >
                                            {getAllEntities(
                                                props.schema,
                                                props.table,
                                            )
                                                .slice()
                                                .sort((a, b) => {
                                                    const displayNameA = `${a.schema}.${a.name}`;
                                                    const displayNameB = `${b.schema}.${b.name}`;
                                                    return displayNameA
                                                        .toLowerCase()
                                                        .localeCompare(
                                                            displayNameB.toLowerCase(),
                                                        );
                                                })
                                                .map((table) => {
                                                    const displayName = `${table.schema}.${table.name}`;
                                                    return (
                                                        <Option
                                                            key={table.name}
                                                            value={displayName}
                                                        >
                                                            {displayName}
                                                        </Option>
                                                    );
                                                })}
                                        </Dropdown>
                                    </Field>
                                </div>
                                <div className={classes.tablePanelRow}>
                                    <Field style={{ flex: 1 }}>
                                        <Label>
                                            {
                                                locConstants.schemaDesigner
                                                    .sourceColumn
                                            }
                                        </Label>
                                        <Dropdown
                                            size="small"
                                            value={fk.columns[0]}
                                            selectedOptions={[fk.columns[0]]}
                                            multiselect={false}
                                            onOptionSelect={(_e, data) => {
                                                if (!data.optionText) {
                                                    return;
                                                }
                                                const newForeignKeys = [
                                                    ...tableForeignKeys,
                                                ];
                                                newForeignKeys[index].columns =
                                                    [data.optionText];
                                                setTableForeignKeys(
                                                    newForeignKeys,
                                                );
                                            }}
                                            style={{
                                                minWidth: "auto",
                                            }}
                                        >
                                            {tableColumns
                                                .slice()
                                                .sort((a, b) => {
                                                    return a.name
                                                        .toLowerCase()
                                                        .localeCompare(
                                                            b.name.toLowerCase(),
                                                        );
                                                })
                                                .map((column) => (
                                                    <Option
                                                        key={column.name}
                                                        value={column.name}
                                                    >
                                                        {column.name}
                                                    </Option>
                                                ))}
                                        </Dropdown>
                                    </Field>
                                    <Field style={{ flex: 1 }}>
                                        <Label>
                                            {
                                                locConstants.schemaDesigner
                                                    .foreignColumn
                                            }
                                        </Label>
                                        <Dropdown
                                            size="small"
                                            value={fk.referencedColumns[0]}
                                            selectedOptions={[
                                                fk.referencedColumns[0],
                                            ]}
                                            multiselect={false}
                                            onOptionSelect={(_e, data) => {
                                                if (!data.optionText) {
                                                    return;
                                                }
                                                const newForeignKeys = [
                                                    ...tableForeignKeys,
                                                ];
                                                newForeignKeys[
                                                    index
                                                ].referencedColumns = [
                                                    data.optionText,
                                                ];
                                                setTableForeignKeys(
                                                    newForeignKeys,
                                                );
                                            }}
                                            style={{
                                                minWidth: "auto",
                                            }}
                                        >
                                            {getEntityFromDisplayName(
                                                props.schema,
                                                `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                                            )
                                                .columns.slice()
                                                .sort((a, b) => {
                                                    return a.name
                                                        .toLowerCase()
                                                        .localeCompare(
                                                            b.name.toLowerCase(),
                                                        );
                                                })
                                                .map((column) => (
                                                    <Option
                                                        key={column.name}
                                                        value={column.name}
                                                    >
                                                        {column.name}
                                                    </Option>
                                                ))}
                                        </Dropdown>
                                    </Field>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (!props.table || !props.schema) {
        return undefined;
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
                    {locConstants.schemaDesigner.foreignKeys}
                </Tab>
            </TabList>
            <div className={classes.editorPanel}>
                {selectedTabValue === "table" && tablePanel()}
                {selectedTabValue === "foreignKeys" && foreignKeyPanel()}
            </div>
            <div className={classes.buttonStickyContainer}>
                <Button
                    size="small"
                    appearance="primary"
                    onClick={() => {
                        if (props.schemaDesigner) {
                            props.schemaDesigner.updateActiveCellStateTable({
                                id: props.table.id,
                                name: tableName,
                                schema: schemaName,
                                columns: tableColumns,
                                foreignKeys: tableForeignKeys,
                            });
                        }
                        props.onClose();
                    }}
                >
                    {locConstants.schemaDesigner.save}
                </Button>
                <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => {
                        props.onClose();
                    }}
                >
                    {locConstants.schemaDesigner.cancel}
                </Button>
            </div>
        </div>
    );
};

function getUniqueSchemaNames(schema: SchemaDesigner.Schema): string[] {
    const schemaNames: Set<string> = new Set<string>();
    schema.tables.forEach((entity) => {
        schemaNames.add(entity.schema);
    });
    return Array.from(schemaNames).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
    );
}

function getUniqueDatatypes(schema: SchemaDesigner.Schema): string[] {
    const datatypes: Set<string> = new Set<string>();
    schema.tables.forEach((table) => {
        table.columns.forEach((column) => {
            datatypes.add(column.dataType);
        });
    });
    return Array.from(datatypes).sort();
}

function getNextColumnName(existingColumns: SchemaDesigner.Column[]): string {
    let index = 1;
    let columnName = `column_${index}`;
    while (existingColumns.some((column) => column.name === columnName)) {
        index++;
        columnName = `column_${index}`;
    }
    return columnName;
}

function getNextForeignKeyName(
    existingEdges: SchemaDesigner.ForeignKey[],
): string {
    let index = 1;
    let foreignKeyName = `FK_${index}`;
    while (existingEdges.some((edge) => edge.name === foreignKeyName)) {
        index++;
        foreignKeyName = `FK_${index}`;
    }
    return foreignKeyName;
}

function getAllEntities(
    schema: SchemaDesigner.Schema,
    currentEntity: SchemaDesigner.Table,
): SchemaDesigner.Table[] {
    return schema.tables
        .filter(
            (entity) =>
                entity.schema !== currentEntity.schema ||
                entity.name !== currentEntity.name,
        )
        .sort();
}

function getEntityFromDisplayName(
    schema: SchemaDesigner.Schema,
    displayName: string,
): SchemaDesigner.Table {
    return schema.tables.find(
        (entity) => `${entity.schema}.${entity.name}` === displayName,
    )!;
}
