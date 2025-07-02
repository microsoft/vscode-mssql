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
    MessageBar,
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
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import { v4 as uuidv4 } from "uuid";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { foreignKeyUtils, namingUtils, tableUtils } from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../shared/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import { SearchableDropdown } from "../../../common/searchableDropdown.component";
import * as FluentIcons from "@fluentui/react-icons";
import {
    FOREIGN_KEY_ERROR_PREFIX,
    SchemaDesignerEditorContext,
} from "./schemaDesignerEditorDrawer";

const useStyles = makeStyles({
    panel: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "10px",
        gap: "10px",
    },
    row: {
        display: "flex",
        flexDirection: "row",
        flex: "1",
        gap: "5px",
        padding: "0px 5px",
    },
    cardStyle: {
        marginBottom: "10px",
    },
    actionButton: {
        width: "fit-content",
    },
    scrollContainer: {
        flex: "1",
        overflow: "auto",
        padding: "5px",
    },
    newForeignKeyButton: {
        width: "200px",
    },
    mappingTableContainer: {
        backgroundColor: "var(--vscode-editorGroupHeader-tabsBackground)",
        padding: "10px",
    },
});

// Column mapping component for the foreign key
const ColumnMappingTable = ({
    foreignKey,
    foreignKeyIndex,
    selectedTable,
    updateForeignKey,
}: {
    foreignKey: SchemaDesigner.ForeignKey;
    foreignKeyIndex: number;
    selectedTable: SchemaDesigner.Table;
    updateForeignKey: (index: number, updatedForeignKey: SchemaDesigner.ForeignKey) => void;
}) => {
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });

    // Define columns for the mapping table
    const columnDefinitions: TableColumnDefinition<{
        columnName: string;
        foreignKeyColumnName: string;
    }>[] = [
        createTableColumn({
            columnId: "columnName",
            renderHeaderCell: () => <Text>{locConstants.schemaDesigner.columnName}</Text>,
        }),
        createTableColumn({
            columnId: "foreignKeyColumnName",
            renderHeaderCell: () => <Text>{locConstants.schemaDesigner.foreignColumn}</Text>,
        }),
        createTableColumn({
            columnId: "delete",
            renderHeaderCell: () => <Text></Text>,
        }),
    ];

    const [columnSizingOptions] = useState<TableColumnSizingOptions>({
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

    const tableItems = foreignKey.columns.map((columnName, index) => ({
        columnName,
        foreignKeyColumnName: foreignKey.referencedColumns[index],
    }));

    const [tableColumns] = useState<
        TableColumnDefinition<{
            columnName: string;
            foreignKeyColumnName: string;
        }>[]
    >(columnDefinitions);

    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns: tableColumns,
            items: tableItems,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 20,
            }),
        ],
    );

    // Get the target table based on the foreign key reference
    const context = useContext(SchemaDesignerEditorContext);
    const targetTable = useMemo(() => {
        if (!context.schema) return { columns: [] };
        return tableUtils.getTableFromDisplayName(
            context.schema,
            `${foreignKey.referencedSchemaName}.${foreignKey.referencedTableName}`,
        );
    }, [context.schema, foreignKey.referencedSchemaName, foreignKey.referencedTableName]);

    // Handle rendering of different cell types
    const renderCell = (columnId: TableColumnId, mappingIndex: number) => {
        switch (columnId) {
            case "columnName":
                return (
                    <SearchableDropdown
                        placeholder="Search Schema"
                        options={selectedTable.columns.map((column) => ({
                            displayName: column.name,
                            value: column.name,
                        }))}
                        selectedOption={{
                            text: foreignKey.columns[mappingIndex],
                            value: foreignKey.columns[mappingIndex],
                        }}
                        onSelect={(selected) => {
                            const updatedColumns = [...foreignKey.columns];
                            updatedColumns[mappingIndex] = selected.value;

                            updateForeignKey(foreignKeyIndex, {
                                ...foreignKey,
                                columns: updatedColumns,
                            });
                        }}
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                        }}
                        size="small"
                    />
                );

            case "foreignKeyColumnName":
                return (
                    <SearchableDropdown
                        placeholder="Search Schema"
                        options={targetTable.columns.map((column) => ({
                            displayName: column.name,
                            value: column.name,
                        }))}
                        selectedOption={{
                            text: foreignKey.referencedColumns[mappingIndex],
                            value: foreignKey.referencedColumns[mappingIndex],
                        }}
                        onSelect={(selected) => {
                            const updatedReferencedColumns = [...foreignKey.referencedColumns];
                            updatedReferencedColumns[mappingIndex] = selected.value;

                            updateForeignKey(foreignKeyIndex, {
                                ...foreignKey,
                                referencedColumns: updatedReferencedColumns,
                            });
                        }}
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                        }}
                        size="small"
                    />
                );

            case "delete":
                return (
                    <Button
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        onClick={() => {
                            const updatedColumns = [...foreignKey.columns];
                            const updatedReferencedColumns = [...foreignKey.referencedColumns];

                            updatedColumns.splice(mappingIndex, 1);
                            updatedReferencedColumns.splice(mappingIndex, 1);

                            updateForeignKey(foreignKeyIndex, {
                                ...foreignKey,
                                columns: updatedColumns,
                                referencedColumns: updatedReferencedColumns,
                            });
                        }}
                    />
                );

            default:
                return null;
        }
    };

    return (
        <Table
            {...keyboardNavAttr}
            as="table"
            size="extra-small"
            {...columnSizing_unstable.getTableProps()}
            ref={tableRef}>
            <TableHeader>
                <TableRow>
                    {columnDefinitions.map((column) => (
                        <TableHeaderCell
                            {...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
                            key={column.columnId}>
                            {column.renderHeaderCell()}
                        </TableHeaderCell>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {getRows().map((_row, mappingIndex) => (
                    <TableRow key={`mapping-${mappingIndex}`}>
                        {columnDefinitions.map((column) => (
                            <TableCell
                                {...columnSizing_unstable.getTableCellProps(column.columnId)}
                                key={column.columnId}>
                                {renderCell(column.columnId, mappingIndex)}
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

// Foreign Key Card component
const ForeignKeyCard = ({
    foreignKey,
    index,
    allTables,
    onDelete,
    onUpdate,
    lastAddedForeignKeyIndex,
}: {
    foreignKey: SchemaDesigner.ForeignKey;
    index: number;
    allTables: SchemaDesigner.Table[];
    onDelete: (index: number) => void;
    onUpdate: (index: number, updatedForeignKey: SchemaDesigner.ForeignKey) => void;
    lastAddedForeignKeyIndex: number;
}) => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerEditorContext);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [warningMessage, setWarningMessage] = useState<string>("");

    useEffect(() => {
        if (index === lastAddedForeignKeyIndex) {
            inputRef.current?.focus();
        }
    }, [index, lastAddedForeignKeyIndex]);

    // Add a mapping between source and target columns
    const addColumnMapping = () => {
        if (!context.schema) return;

        const updatedForeignKey = { ...foreignKey };

        // Get default source and target columns
        const sourceColumn = context.table.columns[0]?.name || "";

        const targetTable = tableUtils.getTableFromDisplayName(
            context.schema,
            `${foreignKey.referencedSchemaName}.${foreignKey.referencedTableName}`,
        );
        const targetColumn = targetTable.columns[0]?.name || "";

        // Add the new mapping
        updatedForeignKey.columns.push(sourceColumn);
        updatedForeignKey.referencedColumns.push(targetColumn);

        onUpdate(index, updatedForeignKey);
    };

    useEffect(() => {
        const error = context.errors[`${FOREIGN_KEY_ERROR_PREFIX}${foreignKey.id}`];
        if (error) {
            setErrorMessage(error);
        } else {
            setErrorMessage("");
        }
        const warning = context.warnings[`${FOREIGN_KEY_ERROR_PREFIX}${foreignKey.id}`];
        if (warning) {
            setWarningMessage(warning);
        } else {
            setWarningMessage("");
        }
    }, [context.errors]);

    return (
        <Card className={classes.cardStyle} key={`fk-card-${index}`}>
            <CardHeader
                header={<Text>{locConstants.schemaDesigner.foreignKeyIndex(index + 1)}</Text>}
                action={
                    <Button
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        onClick={() => onDelete(index)}
                    />
                }
            />

            {/* Error Message */}
            {errorMessage && <MessageBar intent="error">{errorMessage}</MessageBar>}

            {/* Warning Message */}
            {warningMessage && <MessageBar intent="warning">{warningMessage}</MessageBar>}

            {/* Foreign Key Name */}
            <div className={classes.row}>
                <Field style={{ flex: 1 }} size="small">
                    <Label>{locConstants.schemaDesigner.name}</Label>
                    <Input
                        size="small"
                        value={foreignKey.name}
                        ref={inputRef}
                        onChange={(_e, data) => {
                            onUpdate(index, {
                                ...foreignKey,
                                name: data.value,
                            });
                        }}
                    />
                </Field>
            </div>

            {/* Target Table Selection */}
            <div className={classes.row}>
                <Field style={{ flex: 1 }} size="small">
                    <Label>{locConstants.schemaDesigner.targetTable}</Label>
                    <SearchableDropdown
                        options={allTables
                            .sort((a, b) => {
                                const displayNameA = `${a.schema}.${a.name}`;
                                const displayNameB = `${b.schema}.${b.name}`;
                                return displayNameA
                                    .toLowerCase()
                                    .localeCompare(displayNameB.toLowerCase());
                            })
                            .map((table) => ({
                                displayName: `${table.schema}.${table.name}`,
                                value: `${table.schema}.${table.name}`,
                            }))}
                        selectedOption={{
                            text: `${foreignKey.referencedSchemaName}.${foreignKey.referencedTableName}`,
                            value: `${foreignKey.referencedSchemaName}.${foreignKey.referencedTableName}`,
                        }}
                        onSelect={(selected) => {
                            if (!selected.value || !context.schema) return;
                            const targetTable = tableUtils.getTableFromDisplayName(
                                context.schema,
                                selected.value,
                            );
                            // When target table changes, update reference info and reset column mappings
                            const defaultTargetColumn = targetTable.columns[0]?.name || "";
                            onUpdate(index, {
                                ...foreignKey,
                                referencedTableName: targetTable.name,
                                referencedSchemaName: targetTable.schema,
                                referencedColumns: [defaultTargetColumn],
                                columns: [context.table.columns[0]?.name || ""],
                            });
                        }}
                        style={{ minWidth: "auto" }}
                        size="small"
                    />
                </Field>
            </div>

            {/* On Delete and Update Action */}
            <div className={classes.row}>
                <Field style={{ flex: 1 }} size="small">
                    <Label>{locConstants.schemaDesigner.onDelete}</Label>
                    <Dropdown
                        size="small"
                        value={foreignKeyUtils.convertOnActionToString(foreignKey.onDeleteAction)}
                        selectedOptions={[
                            foreignKeyUtils.convertOnActionToString(foreignKey.onDeleteAction),
                        ]}
                        multiselect={false}
                        onOptionSelect={(_e, data) => {
                            onUpdate(index, {
                                ...foreignKey,
                                onDeleteAction: foreignKeyUtils.convertStringToOnAction(
                                    data.optionValue as string,
                                ),
                            });
                        }}
                        style={{ minWidth: "auto" }}>
                        {foreignKeyUtils.getOnActionOptions().map((action, actionIndex) => (
                            <Option
                                key={`on-delete-option-${actionIndex}-${foreignKey.id}`}
                                value={action.label}>
                                {action.label}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
                <Field style={{ flex: 1 }} size="small">
                    <Label>{locConstants.schemaDesigner.onUpdate}</Label>
                    <Dropdown
                        size="small"
                        value={foreignKeyUtils.convertOnActionToString(foreignKey.onUpdateAction)}
                        selectedOptions={[
                            foreignKeyUtils.convertOnActionToString(foreignKey.onUpdateAction),
                        ]}
                        multiselect={false}
                        onOptionSelect={(_e, data) => {
                            onUpdate(index, {
                                ...foreignKey,
                                onUpdateAction: foreignKeyUtils.convertStringToOnAction(
                                    data.optionValue as string,
                                ),
                            });
                        }}
                        style={{ minWidth: "auto" }}>
                        {foreignKeyUtils.getOnActionOptions().map((action, actionIndex) => (
                            <Option
                                key={`on-update-option--${actionIndex}-${foreignKey.id}`}
                                value={action.label}>
                                {action.label}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            </div>

            <div className={classes.mappingTableContainer}>
                {/* Add Column Mapping Button */}
                <Button
                    icon={<FluentIcons.AddRegular />}
                    className={classes.actionButton}
                    onClick={addColumnMapping}
                    size="small">
                    {locConstants.schemaDesigner.newColumnMapping}
                </Button>

                {/* Column Mapping Table */}
                <ColumnMappingTable
                    foreignKey={foreignKey}
                    foreignKeyIndex={index}
                    selectedTable={context.table}
                    updateForeignKey={onUpdate}
                />
            </div>
        </Card>
    );
};

export const SchemaDesignerEditorForeignKeyPanel = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerEditorContext);
    const foreignKeyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastAddedForeignKeyIndex, setLastAddedForeignKeyIndex] = useState<number>(-1);

    // Get all available tables for foreign key references
    const availableTables = useMemo(() => {
        if (!context.schema) return [];
        return tableUtils.getAllTables(context.schema, context.table);
    }, [context.table]);

    // Reset focus when the selected table changes
    useEffect(() => {
        if (context.table) {
            setLastAddedForeignKeyIndex(-1);
        }
    }, [context.table]);

    // Focus on the newly added foreign key's name input
    useEffect(() => {
        if (lastAddedForeignKeyIndex >= 0) {
            foreignKeyInputRefs.current[lastAddedForeignKeyIndex]?.focus();
        }
    }, [lastAddedForeignKeyIndex]);

    if (!context.table) {
        return undefined;
    }

    const addForeignKey = () => {
        if (!availableTables.length) return;

        const firstTable = availableTables[0];
        const newForeignKey: SchemaDesigner.ForeignKey = {
            id: uuidv4(),
            name: namingUtils.getNextForeignKeyName(
                context.table.foreignKeys,
                context.schema.tables,
            ),
            columns: [context.table.columns[0]?.name || ""],
            referencedSchemaName: firstTable.schema,
            referencedTableName: firstTable.name,
            referencedColumns: [firstTable.columns[0]?.name || ""],
            onDeleteAction: SchemaDesigner.OnAction.CASCADE,
            onUpdateAction: SchemaDesigner.OnAction.CASCADE,
        };

        const updatedForeignKeys = [...context.table.foreignKeys, newForeignKey];

        context.setTable({
            ...context.table,
            foreignKeys: updatedForeignKeys,
        });

        setLastAddedForeignKeyIndex(updatedForeignKeys.length - 1);
    };

    // Delete a foreign key
    const deleteForeignKey = (index: number) => {
        const updatedForeignKeys = [...context.table.foreignKeys];
        updatedForeignKeys.splice(index, 1);

        context.setTable({
            ...context.table,
            foreignKeys: updatedForeignKeys,
        });
    };

    // Update a foreign key
    const updateForeignKey = (index: number, updatedForeignKey: SchemaDesigner.ForeignKey) => {
        const updatedForeignKeys = [...context.table.foreignKeys];
        updatedForeignKeys[index] = updatedForeignKey;

        context.setTable({
            ...context.table,
            foreignKeys: updatedForeignKeys,
        });
    };

    return (
        <div className={classes.panel}>
            <Button
                icon={<AddRegular />}
                className={classes.newForeignKeyButton}
                onClick={addForeignKey}>
                {locConstants.schemaDesigner.newForeignKey}
            </Button>

            <div className={classes.scrollContainer}>
                {context.table.foreignKeys.map((foreignKey, index) => (
                    <ForeignKeyCard
                        key={`foreign-key-${foreignKey.id}`}
                        foreignKey={foreignKey}
                        index={index}
                        allTables={availableTables}
                        onDelete={deleteForeignKey}
                        onUpdate={updateForeignKey}
                        lastAddedForeignKeyIndex={lastAddedForeignKeyIndex}
                    />
                ))}
            </div>
        </div>
    );
};
