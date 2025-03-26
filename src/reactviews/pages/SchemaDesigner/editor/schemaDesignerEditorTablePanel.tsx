/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    createTableColumn,
    Divider,
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
import { locConstants } from "../../../common/locConstants";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import * as FluentIcons from "@fluentui/react-icons";
import { v4 as uuidv4 } from "uuid";
import {
    fillColumnDefaults,
    getAllTables,
    getNextColumnName,
    isLengthBasedType,
    isPrecisionBasedType,
    tableNameValidationError,
} from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SearchableDropdown } from "../../../common/searchableDropdown.component";
import { SchemaDesignerEditorContext } from "./schemaDesignerEditorDrawer";

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
    scrollContainer: {
        flex: "1",
        overflowY: "auto",
        overflowX: "hidden",
    },
    newColumnButton: {
        width: "fit-content",
    },
    advancedOptionsContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
    },
    fullWidthDivider: {
        width: "100vh",
    },
    columnInput: {
        minWidth: "150px",
        maxWidth: "150px",
        textOverflow: "ellipsis",
    },
});

// Component for handling advanced column options
const ColumnAdvancedOptions = ({
    column,
    index,
    updateColumn,
}: {
    column: SchemaDesigner.Column;
    index: number;
    updateColumn: (index: number, updatedColumn: SchemaDesigner.Column) => void;
}) => {
    const classes = useStyles();

    return (
        <div className={classes.advancedOptionsContainer}>
            <Field>
                <Checkbox
                    size="medium"
                    checked={column.isNullable}
                    onChange={(_e, data) => {
                        updateColumn(index, {
                            ...column,
                            isNullable: data.checked as boolean,
                        });
                    }}
                    label="Allow NULL"
                />
            </Field>
            <Field>
                <Checkbox
                    size="medium"
                    checked={column.isUnique}
                    onChange={(_e, data) => {
                        updateColumn(index, {
                            ...column,
                            isUnique: data.checked as boolean,
                        });
                    }}
                    label="Unique"
                />
            </Field>
            <Field>
                <Checkbox
                    size="medium"
                    checked={column.isIdentity}
                    onChange={(_e, data) => {
                        const updatedColumn = {
                            ...column,
                            isIdentity: data.checked as boolean,
                        };

                        if (data.checked) {
                            updatedColumn.identitySeed = 1;
                            updatedColumn.identityIncrement = 1;
                        }

                        updateColumn(index, updatedColumn);
                    }}
                    label="Identity"
                />
            </Field>

            {isLengthBasedType(column.dataType) && (
                <Field
                    label={{
                        children: (
                            <InfoLabel
                                size="small"
                                info="Max length of the column"
                            >
                                Max Length
                            </InfoLabel>
                        ),
                    }}
                >
                    <Input
                        size="small"
                        type="number"
                        value={column.maxLength.toString()}
                        onChange={(_e, data) => {
                            updateColumn(index, {
                                ...column,
                                maxLength: parseInt(data.value),
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
                                    info="Precision of the column"
                                >
                                    Precision
                                </InfoLabel>
                            ),
                        }}
                    >
                        <Input
                            size="small"
                            type="number"
                            value={column.precision.toString()}
                            onChange={(_e, data) => {
                                updateColumn(index, {
                                    ...column,
                                    precision: parseInt(data.value),
                                });
                            }}
                        />
                    </Field>
                    <Field
                        label={{
                            children: (
                                <InfoLabel
                                    size="small"
                                    info="Scale of the column"
                                >
                                    Scale
                                </InfoLabel>
                            ),
                        }}
                    >
                        <Input
                            size="small"
                            type="number"
                            value={column.scale.toString()}
                            onChange={(_e, data) => {
                                updateColumn(index, {
                                    ...column,
                                    scale: parseInt(data.value),
                                });
                            }}
                        />
                    </Field>
                </>
            )}
        </div>
    );
};

// Component for the columns table
const ColumnsTable = ({
    columns,
    updateColumn,
    deleteColumn,
    columnNameInputRefs,
    datatypes,
    isColumnDeletable,
}: {
    columns: SchemaDesigner.Column[];
    updateColumn: (index: number, updatedColumn: SchemaDesigner.Column) => void;
    deleteColumn: (index: number) => void;
    columnNameInputRefs: React.RefObject<Array<HTMLInputElement | null>>;
    datatypes: string[];
    isColumnDeletable: (column: SchemaDesigner.Column) => boolean;
}) => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });

    // Define table columns
    const columnDefinitions = [
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

    // Column sizing
    const [columnSizingOptions] = useState<TableColumnSizingOptions>({
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

    // Configure table
    const [tableColumns] =
        useState<TableColumnDefinition<SchemaDesigner.Column>[]>(
            columnDefinitions,
        );
    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns: tableColumns,
            items: columns,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions,
                autoFitColumns: false,
                containerWidthOffset: 20,
            }),
        ],
    );

    // Render cell content based on column id
    const renderCell = (
        column: SchemaDesigner.Column,
        columnId: TableColumnId,
        index: number,
    ) => {
        switch (columnId) {
            case "name":
                return (
                    <Input
                        size="small"
                        className={classes.columnInput}
                        ref={(ref) => {
                            if (columnNameInputRefs.current) {
                                columnNameInputRefs.current[index] = ref;
                            }
                        }}
                        value={column.name}
                        onChange={(_e, data) => {
                            updateColumn(index, {
                                ...column,
                                name: data.value,
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
                            const updatedColumn = {
                                ...column,
                                dataType: selected.value,
                            };
                            updateColumn(
                                index,
                                fillColumnDefaults(updatedColumn),
                            );
                        }}
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                        }}
                        size="small"
                    />
                );

            case "primaryKey":
                return (
                    <Checkbox
                        size="medium"
                        checked={column.isPrimaryKey}
                        onChange={(_e, data) => {
                            updateColumn(index, {
                                ...column,
                                isPrimaryKey: data.checked as boolean,
                            });
                        }}
                    />
                );

            case "delete":
                return (
                    <Button
                        size="small"
                        appearance="subtle"
                        disabled={!isColumnDeletable(column)}
                        icon={<FluentIcons.DeleteRegular />}
                        onClick={() => deleteColumn(index)}
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
                            />
                        </PopoverTrigger>

                        <PopoverSurface aria-labelledby={id}>
                            <div>
                                <h3 id={id}>Advanced options</h3>
                            </div>

                            <ColumnAdvancedOptions
                                column={column}
                                index={index}
                                updateColumn={updateColumn}
                            />
                        </PopoverSurface>
                    </Popover>
                );

            default:
                return <Text>{columnId}</Text>;
        }
    };

    return (
        <Table
            {...keyboardNavAttr}
            as="table"
            size="extra-small"
            {...columnSizing_unstable.getTableProps()}
            ref={tableRef}
        >
            <TableHeader>
                <TableRow>
                    {columnDefinitions.map((column) => (
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
            <Divider className={classes.fullWidthDivider} />
            <TableBody>
                {getRows().map((row, index) => (
                    <TableRow key={index}>
                        {tableColumns.map((column) => (
                            <TableCell
                                {...columnSizing_unstable.getTableCellProps(
                                    column.columnId,
                                )}
                                key={column.columnId}
                            >
                                {renderCell(row.item, column.columnId, index)}
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

// Main component
export const SchemaDesignerEditorTablePanel = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerEditorContext);
    const columnNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastColumnNameInputIndex, setLastColumnNameInputIndex] =
        useState<number>(-1);

    // Memoized values
    const datatypes = useMemo(() => context.dataTypes, [context.dataTypes]);
    const allTables = useMemo(() => {
        return getAllTables(context.schema, context.table);
    }, [context.schema, context.table]);

    // Reset focus when selected table changes
    useEffect(() => {
        setLastColumnNameInputIndex(-1);
    }, [context.table]);

    // Focus on newly added column
    useEffect(() => {
        if (lastColumnNameInputIndex >= 0) {
            columnNameInputRefs.current[lastColumnNameInputIndex]?.focus();
        }
    }, [lastColumnNameInputIndex]);

    // Check if a column can be deleted
    const isColumnDeletable = (column: SchemaDesigner.Column) => {
        // If there is an incoming or outgoing foreign key with this column, disable delete
        const hasRelatedForeignKey = context.table.foreignKeys.some((fk) =>
            fk.columns.includes(column.name),
        );

        // If this column is a referenced column in any foreign key, disable delete
        const isReferencedInForeignKey = allTables.some((table) =>
            table.foreignKeys.some((fk) =>
                fk.referencedColumns.includes(column.name),
            ),
        );

        return !hasRelatedForeignKey && !isReferencedInForeignKey;
    };

    // Add a new column
    const addColumn = () => {
        const newColumns = [...context.table.columns];
        newColumns.push({
            id: uuidv4(),
            name: getNextColumnName(newColumns),
            dataType: "int",
            isPrimaryKey: newColumns.length === 0, // First column is primary key by default
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

        context.setTable({
            ...context.table,
            columns: newColumns,
        });

        setLastColumnNameInputIndex(newColumns.length - 1);
    };

    // Update column at specified index
    const updateColumn = (
        index: number,
        updatedColumn: SchemaDesigner.Column,
    ) => {
        const newColumns = [...context.table.columns];
        newColumns[index] = updatedColumn;

        context.setTable({
            ...context.table,
            columns: newColumns,
        });
    };

    // Delete column at specified index
    const deleteColumn = (index: number) => {
        const newColumns = [...context.table.columns];
        newColumns.splice(index, 1);

        context.setTable({
            ...context.table,
            columns: newColumns,
        });
    };

    // Update table schema
    const updateTableSchema = (schema: string) => {
        context.setTable({
            ...context.table,
            schema: schema,
        });
    };

    // Update table name
    const updateTableName = (name: string) => {
        context.setTable({
            ...context.table,
            name: name,
        });
        const error = tableNameValidationError(context.schema, context.table);
        if (error) {
            context.setErrors({
                ...context.errors,
                name: error,
            });
        } else {
            const newErrors = { ...context.errors };
            delete newErrors.name;
            context.setErrors(newErrors);
        }
    };

    if (!context.table) {
        return undefined;
    }

    return (
        <div className={classes.panel}>
            {/* Schema Selection */}
            <Field>
                <Label>{locConstants.schemaDesigner.schema}</Label>
                <SearchableDropdown
                    placeholder="Search Schema"
                    options={context.schemas.map((schema) => ({
                        displayName: schema,
                        value: schema,
                    }))}
                    selectedOption={{
                        text: context.table.schema,
                        value: context.table.schema,
                    }}
                    onSelect={(selected) => updateTableSchema(selected.value)}
                />
            </Field>

            {/* Table Name */}
            <Field validationMessage={context.errors.name}>
                <Label>{locConstants.schemaDesigner.name}</Label>
                <Input
                    autoFocus
                    value={context.table.name}
                    onChange={(_e, data) => updateTableName(data.value)}
                />
            </Field>

            {/* Add Column Button */}
            <Button
                appearance="secondary"
                icon={<FluentIcons.AddRegular />}
                className={classes.newColumnButton}
                onClick={addColumn}
            >
                {locConstants.schemaDesigner.newColumn}
            </Button>

            {/* Columns Table */}
            <div className={classes.scrollContainer}>
                <ColumnsTable
                    columns={context.table.columns}
                    updateColumn={updateColumn}
                    deleteColumn={deleteColumn}
                    columnNameInputRefs={columnNameInputRefs}
                    datatypes={datatypes}
                    isColumnDeletable={isColumnDeletable}
                />
            </div>
        </div>
    );
};
