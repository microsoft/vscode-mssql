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
    TableColumnId,
    TableColumnSizingOptions,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    Textarea,
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import * as FluentIcons from "@fluentui/react-icons";
import { v4 as uuidv4 } from "uuid";
import { columnUtils, namingUtils, tableUtils } from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SearchableDropdown } from "../../../common/searchableDropdown.component";
import { SchemaDesignerEditorContext, TABLE_NAME_ERROR_KEY } from "./schemaDesignerEditorDrawer";

const useStyles = makeStyles({
    panel: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "5px",
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
    const context = useContext(SchemaDesignerEditorContext);

    // Define table columns
    const columnDefinitions = [
        createTableColumn({
            columnId: "name",
            renderHeaderCell: () => <Text>{locConstants.schemaDesigner.name}</Text>,
        }),
        createTableColumn({
            columnId: "type",
            renderHeaderCell: () => <Text>{locConstants.schemaDesigner.dataType}</Text>,
        }),
        createTableColumn({
            columnId: "primaryKey",
            renderHeaderCell: () => <Text>{locConstants.schemaDesigner.primaryKey}</Text>,
        }),
        createTableColumn({
            columnId: "delete",
            renderHeaderCell: () => <Text></Text>,
        }),
        createTableColumn({
            columnId: "menu",
            renderHeaderCell: () => <Text></Text>,
        }),
        createTableColumn({
            columnId: "error",
            renderHeaderCell: () => <></>,
        }),
    ];

    // Column sizing
    const [columnSizingOptions] = useState<TableColumnSizingOptions>({
        error: {
            defaultWidth: 18,
            minWidth: 18,
            idealWidth: 18,
        },
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
            defaultWidth: 20,
            minWidth: 20,
            idealWidth: 20,
        },
        menu: {
            defaultWidth: 20,
            minWidth: 20,
            idealWidth: 20,
        },
    });

    // Configure table
    const [tableColumns] =
        useState<TableColumnDefinition<SchemaDesigner.Column>[]>(columnDefinitions);
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

    const renderAdvancedOptions = (column: SchemaDesigner.Column, index: number) => {
        const options = columnUtils.getAdvancedOptions(column);
        return (
            <div className={classes.advancedOptionsContainer}>
                {options.map((option) => {
                    switch (option.type) {
                        case "checkbox":
                            return (
                                <Field key={option.label}>
                                    <Checkbox
                                        size="medium"
                                        checked={column[option.columnProperty] as boolean}
                                        onChange={(_e, data) => {
                                            updateColumn(
                                                index,
                                                option.columnModifier(
                                                    column,
                                                    data.checked as boolean,
                                                ),
                                            );
                                        }}
                                        label={option.label}
                                    />
                                </Field>
                            );
                        case "input":
                            return (
                                <Field
                                    key={option.label}
                                    label={{
                                        children: (
                                            <InfoLabel size="small" info={option.hint}>
                                                {option.label}
                                            </InfoLabel>
                                        ),
                                    }}>
                                    <Input
                                        size="small"
                                        value={(
                                            column[option.columnProperty] as string
                                        )?.toString()}
                                        onChange={(_e, data) => {
                                            updateColumn(
                                                index,
                                                option.columnModifier(column, data.value),
                                            );
                                        }}
                                    />
                                </Field>
                            );
                        case "input-number":
                            return (
                                <Field
                                    key={option.label}
                                    label={{
                                        children: (
                                            <InfoLabel size="small" info={option.hint}>
                                                {option.label}
                                            </InfoLabel>
                                        ),
                                    }}>
                                    <Input
                                        size="small"
                                        type="number"
                                        value={(
                                            column[option.columnProperty] as number
                                        )?.toString()}
                                        onChange={(_e, data) => {
                                            updateColumn(
                                                index,
                                                option.columnModifier(column, parseInt(data.value)),
                                            );
                                        }}
                                    />
                                </Field>
                            );
                        case "textarea":
                            return (
                                <Field
                                    key={option.label}
                                    label={{
                                        children: (
                                            <InfoLabel size="small" info={option.hint}>
                                                {option.label}
                                            </InfoLabel>
                                        ),
                                    }}>
                                    <Textarea
                                        size="small"
                                        value={column[option.columnProperty] as string}
                                        onChange={(_e, data) => {
                                            updateColumn(
                                                index,
                                                option.columnModifier(column, data.value),
                                            );
                                        }}
                                    />
                                </Field>
                            );
                    }
                    return <></>;
                })}
            </div>
        );
    };

    // Render cell content based on column id
    const renderCell = (column: SchemaDesigner.Column, columnId: TableColumnId, index: number) => {
        switch (columnId) {
            case "error":
                return (
                    <>
                        {context.errors[`columns_${column.id}`] && (
                            <Popover>
                                <PopoverTrigger disableButtonEnhancement>
                                    <Button
                                        icon={
                                            <FluentIcons.ErrorCircleRegular
                                                style={{
                                                    color: "var(--vscode-errorForeground)",
                                                }}
                                                title={context.errors[column.name]}
                                            />
                                        }
                                        appearance="transparent"
                                    />
                                </PopoverTrigger>
                                <PopoverSurface tabIndex={-1}>
                                    <div>{context.errors[`columns_${column.id}`]}</div>
                                </PopoverSurface>
                            </Popover>
                        )}
                    </>
                );
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
                        selectedOption={
                            column.isComputed
                                ? {
                                      text: "Computed",
                                      value: "Computed",
                                  }
                                : {
                                      text: column.dataType,
                                      value: column.dataType,
                                  }
                        }
                        onSelect={(selected) => {
                            const updatedColumn = {
                                ...column,
                                dataType: selected.value,
                                defaultValue: "",
                            };
                            updateColumn(index, columnUtils.fillColumnDefaults(updatedColumn));
                        }}
                        style={{
                            minWidth: "150px",
                            maxWidth: "150px",
                        }}
                        size="small"
                        disabled={column.isComputed}
                        ariaLabel={`${locConstants.schemaDesigner.dataType} for ${column.name}`}
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
                                isNullable: data.checked ? false : column.isNullable,
                            });
                        }}
                        disabled={column.isComputed}
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
                        positioning={{
                            position: "below",
                        }}>
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
                            {renderAdvancedOptions(column, index)}
                            {/* <ColumnAdvancedOptions
                                column={column}
                                index={index}
                                updateColumn={updateColumn}
                            /> */}
                        </PopoverSurface>
                    </Popover>
                );

            default:
                return <Text>{columnId}</Text>;
        }
    };

    return (
        <>
            <Table
                {...keyboardNavAttr}
                as="table"
                size="extra-small"
                {...columnSizing_unstable.getTableProps()}
                ref={tableRef}>
                <TableHeader>
                    <TableRow>
                        {columnDefinitions.map((column) => {
                            return (
                                <TableHeaderCell
                                    {...columnSizing_unstable.getTableHeaderCellProps(
                                        column.columnId,
                                    )}
                                    key={column.columnId}>
                                    {column.renderHeaderCell()}
                                </TableHeaderCell>
                            );
                        })}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {getRows().map((_row, index) => (
                        <TableRow key={index}>
                            {tableColumns.map((column) => {
                                return (
                                    <TableCell
                                        {...columnSizing_unstable.getTableCellProps(
                                            column.columnId,
                                        )}
                                        key={column.columnId}>
                                        {renderCell(columns[index], column.columnId, index)}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </>
    );
};

// Main component
export const SchemaDesignerEditorTablePanel = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerEditorContext);
    const columnNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastColumnNameInputIndex, setLastColumnNameInputIndex] = useState<number>(-1);

    // Memoized values
    const datatypes = useMemo(() => context.dataTypes, [context.dataTypes]);
    const allTables = useMemo(() => {
        return tableUtils.getAllTables(context.schema, context.table);
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
            table.foreignKeys.some((fk) => fk.referencedColumns.includes(column.name)),
        );

        return !hasRelatedForeignKey && !isReferencedInForeignKey;
    };

    // Add a new column
    const addColumn = () => {
        const newColumns = [...context.table.columns];
        newColumns.push({
            id: uuidv4(),
            name: namingUtils.getNextColumnName(newColumns),
            dataType: "int",
            isPrimaryKey: newColumns.length === 0, // First column is primary key by default
            isIdentity: false,
            isNullable: true,
            maxLength: "",
            precision: 0,
            scale: 0,
            identitySeed: 1,
            identityIncrement: 1,
            defaultValue: "",
            isComputed: false,
            computedFormula: "",
            computedPersisted: false,
        });

        context.setTable({
            ...context.table,
            columns: newColumns,
        });

        setLastColumnNameInputIndex(newColumns.length - 1);
    };

    // Update column at specified index
    const updateColumn = (index: number, updatedColumn: SchemaDesigner.Column) => {
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
                    ariaLabel={locConstants.schemaDesigner.schema}
                />
            </Field>

            {/* Table Name */}
            <Field validationMessage={context.errors[TABLE_NAME_ERROR_KEY]}>
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
                onClick={addColumn}>
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
