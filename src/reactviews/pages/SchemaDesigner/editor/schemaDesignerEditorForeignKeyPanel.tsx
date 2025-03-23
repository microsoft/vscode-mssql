/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    CardHeader,
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
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import { v4 as uuidv4 } from "uuid";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    getAllTables,
    getNextForeignKeyName,
    getTableFromDisplayName,
} from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import { SearchableDropdown } from "../../../common/searchableDropdown.component";
import * as FluentIcons from "@fluentui/react-icons";

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
    tablePanelRow: {
        display: "flex",
        flexDirection: "row",
        flex: "1",
        gap: "5px",
        padding: "0px 5px",
    },
});

export const SchemaDesignerEditorForeignKeyPanel = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);

    const allTables = useMemo(() => {
        if (!context.schemaDesigner) {
            return [];
        }
        return getAllTables(
            context.schemaDesigner.schema,
            context.selectedTable,
        );
    }, [context.selectedTable]);
    const foreignKeyNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastForeignKeyNameInputIndex, setLastForeignKeyNameInputIndex] =
        useState<number>(-1);

    useEffect(() => {
        if (context.selectedTable) {
            setLastForeignKeyNameInputIndex(-1);
        }
    }, [context.selectedTable]);

    useEffect(() => {
        if (lastForeignKeyNameInputIndex >= 0) {
            foreignKeyNameInputRefs.current[
                lastForeignKeyNameInputIndex
            ]?.focus();
        }
    }, [lastForeignKeyNameInputIndex]);

    if (!context.schemaDesigner) {
        return undefined;
    }

    const renderForeignKeyCard = (
        fk: SchemaDesigner.ForeignKey,
        index: number,
    ) => {
        const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
        const foreignKeyMappingColumnDefinition: TableColumnDefinition<{
            columnName: string;
            foreignKeyColumnName: string;
        }>[] = [
            createTableColumn({
                columnId: "columnName",
                renderHeaderCell: () => (
                    <Text>{locConstants.schemaDesigner.columnName}</Text>
                ),
            }),
            createTableColumn({
                columnId: "foreignKeyColumnName",
                renderHeaderCell: () => (
                    <Text>{locConstants.schemaDesigner.foreignColumn}</Text>
                ),
            }),
            createTableColumn({
                columnId: "delete",
                renderHeaderCell: () => <Text></Text>,
            }),
        ];
        const [
            foreignKeyMappingSizingOptions,
            _setForeignKeyMappingSizingOptions,
        ] = useState<TableColumnSizingOptions>({
            columnName: {
                defaultWidth: 150,
                minWidth: 150,
                idealWidth: 150,
            },
            foreignKeyColumnName: {
                defaultWidth: 150,
                minWidth: 150,
                idealWidth: 150,
            },
            delete: {
                defaultWidth: 30,
                minWidth: 30,
                idealWidth: 30,
            },
        });
        const foreignKeyMappingTableItems: {
            columnName: string;
            foreignKeyColumnName: string;
        }[] = fk.columns.map((columnName, index) => ({
            columnName: columnName,
            foreignKeyColumnName: fk.referencedColumns[index],
        }));
        const [foreignKeyMappingColumns] = useState<
            TableColumnDefinition<{
                columnName: string;
                foreignKeyColumnName: string;
            }>[]
        >(foreignKeyMappingColumnDefinition);

        const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
            {
                columns: foreignKeyMappingColumns,
                items: foreignKeyMappingTableItems,
            },
            [
                useTableColumnSizing_unstable({
                    columnSizingOptions: foreignKeyMappingSizingOptions,
                    autoFitColumns: false,
                    containerWidthOffset: 20,
                }),
            ],
        );

        function renderColumnTableCell(
            fk: SchemaDesigner.ForeignKey,
            columnId: string,
            fkIndex: number,
            mappingIndex: number,
        ) {
            switch (columnId) {
                case "columnName":
                    return (
                        <SearchableDropdown
                            placeholder="Search Schema"
                            options={
                                context.selectedTable.columns.map((column) => ({
                                    displayName: column.name,
                                    value: column.name,
                                })) ?? []
                            }
                            selectedOption={{
                                text: fk.columns[mappingIndex],
                                value: fk.columns[mappingIndex],
                            }}
                            onSelect={(selected) => {
                                const newForeignKeys = [
                                    ...context.selectedTable.foreignKeys,
                                ];
                                newForeignKeys[fkIndex].columns[mappingIndex] =
                                    selected.value;
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                            style={{
                                minWidth: "150px",
                                maxWidth: "150px",
                            }}
                            size="small"
                        ></SearchableDropdown>
                    );
                case "foreignKeyColumnName":
                    return (
                        <SearchableDropdown
                            placeholder="Search Schema"
                            options={
                                getTableFromDisplayName(
                                    context.schemaDesigner?.schema!,
                                    `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                                ).columns.map((column) => ({
                                    displayName: column.name,
                                    value: column.name,
                                })) ?? []
                            }
                            selectedOption={{
                                text: fk.referencedColumns[mappingIndex],
                                value: fk.referencedColumns[mappingIndex],
                            }}
                            onSelect={(selected) => {
                                const newForeignKeys = [
                                    ...context.selectedTable.foreignKeys,
                                ];
                                newForeignKeys[fkIndex].referencedColumns[
                                    mappingIndex
                                ] = selected.value;
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                            style={{
                                minWidth: "150px",
                                maxWidth: "150px",
                            }}
                            size="small"
                        ></SearchableDropdown>
                    );
                case "delete":
                    return (
                        <Button
                            appearance="subtle"
                            icon={<DeleteRegular />}
                            onClick={() => {
                                const newForeignKeys = [
                                    ...context.selectedTable.foreignKeys,
                                ];

                                newForeignKeys[fkIndex].columns.splice(
                                    mappingIndex,
                                    1,
                                );
                                newForeignKeys[
                                    fkIndex
                                ].referencedColumns.splice(mappingIndex, 1);
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                        ></Button>
                    );
                default:
                    return undefined;
            }
        }
        return (
            <Card
                style={{
                    marginBottom: "10px",
                    borderColor: "var(--vscode-badge-background)",
                    backgroundColor: "var(--vscode-editor-background)",
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
                                    ...context.selectedTable.foreignKeys,
                                ];
                                newForeignKeys.splice(index, 1);
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                        ></Button>
                    }
                ></CardHeader>
                <div className={classes.tablePanelRow}>
                    <Field style={{ flex: 1 }} size="small">
                        <Label>{locConstants.schemaDesigner.name}</Label>
                        <Input
                            size="small"
                            value={
                                context.selectedTable.foreignKeys[index].name
                            }
                            ref={(ref) => {
                                foreignKeyNameInputRefs.current[index] = ref;
                            }}
                            onChange={(_e, d) => {
                                const newEdges = [
                                    ...context.selectedTable.foreignKeys,
                                ];
                                newEdges[index].name = d.value;
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newEdges,
                                });
                            }}
                        />
                    </Field>
                </div>
                <div className={classes.tablePanelRow}>
                    <Field style={{ flex: 1 }} size="small">
                        <Label>{locConstants.schemaDesigner.targetTable}</Label>
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
                                    ...context.selectedTable.foreignKeys,
                                ];
                                const entity = getTableFromDisplayName(
                                    context.schemaDesigner?.schema!,
                                    data.optionText,
                                );
                                newForeignKeys[index].referencedTableName =
                                    entity.name;
                                newForeignKeys[index].referencedSchemaName =
                                    entity.schema;
                                newForeignKeys[index].referencedColumns = [
                                    entity.columns[0].name,
                                ];
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                            style={{
                                minWidth: "auto",
                            }}
                        >
                            {allTables
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
                <Button
                    icon={<FluentIcons.AddRegular />}
                    style={{
                        width: "fit-content",
                    }}
                    onClick={() => {
                        const newForeignKeys = [
                            ...context.selectedTable.foreignKeys,
                        ];
                        newForeignKeys[index].columns.push(
                            context.selectedTable.columns[0].name,
                        );
                        newForeignKeys[index].referencedColumns.push(
                            getTableFromDisplayName(
                                context.schemaDesigner?.schema!,
                                `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                            ).columns[0].name,
                        );
                        context.setSelectedTable({
                            ...context.selectedTable,
                            foreignKeys: newForeignKeys,
                        });
                    }}
                >
                    {locConstants.schemaDesigner.newColumnMapping}
                </Button>
                {/* <div className={classes.tablePanelRow}>
                    <Field style={{ flex: 1 }}>
                        <Label>
                            {locConstants.schemaDesigner.sourceColumn}
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
                                    ...context.selectedTable.foreignKeys,
                                ];
                                newForeignKeys[index].columns = [
                                    data.optionText,
                                ];
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                            style={{
                                minWidth: "auto",
                            }}
                        >
                            {context.selectedTable.columns
                                .slice()
                                .sort((a, b) => {
                                    return a.name
                                        .toLowerCase()
                                        .localeCompare(b.name.toLowerCase());
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
                            {locConstants.schemaDesigner.foreignColumn}
                        </Label>
                        <Dropdown
                            size="small"
                            value={fk.referencedColumns[0]}
                            selectedOptions={[fk.referencedColumns[0]]}
                            multiselect={false}
                            onOptionSelect={(_e, data) => {
                                if (!data.optionText) {
                                    return;
                                }
                                const newForeignKeys = [
                                    ...context.selectedTable.foreignKeys,
                                ];
                                newForeignKeys[index].referencedColumns = [
                                    data.optionText,
                                ];
                                context.setSelectedTable({
                                    ...context.selectedTable,
                                    foreignKeys: newForeignKeys,
                                });
                            }}
                            style={{
                                minWidth: "auto",
                            }}
                        >
                            {getTableFromDisplayName(
                                context.schemaDesigner?.schema!,
                                `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                            )
                                .columns.slice()
                                .sort((a, b) => {
                                    return a.name
                                        .toLowerCase()
                                        .localeCompare(b.name.toLowerCase());
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
                </div> */}
                <Table
                    {...keyboardNavAttr}
                    as="table"
                    size="extra-small"
                    {...columnSizing_unstable.getTableProps()}
                    ref={tableRef}
                >
                    <TableHeader>
                        <TableRow>
                            {foreignKeyMappingColumnDefinition.map((column) => (
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
                        {getRows().map((_row, fkIndex) => (
                            <TableRow key={index}>
                                {foreignKeyMappingColumns.map((column) => {
                                    return (
                                        <TableCell
                                            {...columnSizing_unstable.getTableCellProps(
                                                column.columnId,
                                            )}
                                            key={column.columnId}
                                        >
                                            {renderColumnTableCell(
                                                fk,
                                                column.columnId as string,
                                                index,
                                                fkIndex,
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>
        );
    };

    return (
        <div className={classes.tablePanel}>
            <Button
                icon={<AddRegular />}
                style={{
                    width: "200px",
                }}
                onClick={() => {
                    const firstTable = allTables[0];
                    const newForeignKey: SchemaDesigner.ForeignKey = {
                        id: uuidv4(),
                        name: getNextForeignKeyName(
                            context.selectedTable.foreignKeys,
                        ),
                        columns: [context.selectedTable.columns[0].name],
                        referencedSchemaName: firstTable.schema,
                        referencedTableName: firstTable.name,
                        referencedColumns: [firstTable.columns[0].name],
                        onDeleteAction: SchemaDesigner.OnAction.CASCADE,
                        onUpdateAction: SchemaDesigner.OnAction.CASCADE,
                    };
                    const newForeignKeys = [
                        ...context.selectedTable.foreignKeys,
                        newForeignKey,
                    ];
                    context.setSelectedTable({
                        ...context.selectedTable,
                        foreignKeys: newForeignKeys,
                    });
                    setLastForeignKeyNameInputIndex(newForeignKeys.length - 1);
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
                {context.selectedTable.foreignKeys.map((fk, index) => {
                    return renderForeignKeyCard(fk, index);
                })}
            </div>
        </div>
    );
};
