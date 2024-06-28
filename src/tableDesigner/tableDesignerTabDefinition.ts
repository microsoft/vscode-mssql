/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DesignerDataPropertyInfo, DesignerDataPropertyWithTabInfo, DesignerIssue, DesignerMainPaneTabs, DesignerPropertyPath, DesignerTableProperties, DesignerView, ForeignKeyColumnMappingProperty, InputType, TableCheckConstraintProperty, TableColumnProperty, TableDesignerBuiltInTableViewOptions, TableDesignerView, TableForeignKeyProperty, TableIndexColumnSpecificationProperty, TableIndexProperty, TableProperty } from "./tableDesignerInterfaces";

export function getAboutTableComponents(viewDefinition: TableDesignerView | undefined): DesignerDataPropertyInfo[] {
    if (!viewDefinition) {
        return [];
    }
    const tabComponents: DesignerDataPropertyInfo[] = [
        {
            componentType: 'input',
            propertyName: TableColumnProperty.Name,
            description: "The name of the table object.",
            componentProperties: {
                title: "Table name",
                width: 350
            }
        },
        {
            componentType: 'dropdown',
            propertyName: TableProperty.Schema,
            description: "The schema that contains the table.",
            componentProperties: {
                title: "Schema",
                width: 350,
            }
        },
        {
            componentType: 'textarea',
            propertyName: TableProperty.Description,
            description: "Description for the table.",
            componentProperties: {
                title: "Description",
                width: 350
            }
        }
    ];

    if (viewDefinition?.additionalTableProperties) {
        tabComponents.push(...viewDefinition.additionalTableProperties);
    }

    return tabComponents;
}

export function getColumnsTabComponents(view: TableDesignerView | undefined): DesignerDataPropertyInfo[] {
    if (!view || !view?.columnTableOptions) {
        return [];
    }

    const columnTableOptions = view.columnTableOptions;

    const columnTableColumnDefinitions: DesignerDataPropertyInfo[] = [
        {
            componentType: 'input',
            propertyName: TableColumnProperty.Name,
            description: "The name of the column object.",
            componentProperties: {
                title: "Name",
                width: 150
            }
        }, {
            componentType: 'input',
            propertyName: TableColumnProperty.Description,
            description: "Displays the description of the column",
            componentProperties: {
                title: "Description",
                width: 400
            }
        }, {
            componentType: 'dropdown',
            propertyName: TableColumnProperty.AdvancedType,
            description: "Displays the unified data type (including length, scale and precision) for the column",
            componentProperties: {
                title: "Advanced Type",
                width: 120,
                isEditable: true
            }
        }, {
            componentType: 'dropdown',
            propertyName: TableColumnProperty.Type,
            showInPropertiesView: false,
            description: "Displays the data type name for the column",
            componentProperties: {
                title: "Type",
                width: 100
            }
        }, {
            componentType: 'input',
            propertyName: TableColumnProperty.Length,
            description: "The maximum length (in characters) that can be stored in this database object.",
            componentProperties: {
                title: "Length",
                width: 60
            }
        }, {
            componentType: 'input',
            propertyName: TableColumnProperty.DefaultValue,
            description: "A predefined global default value for the column or binding.",
            componentProperties: {
                title: "Default Value",
                width: 150
            }
        }, {
            componentType: 'checkbox',
            propertyName: TableColumnProperty.AllowNulls,
            description: "Specifies whether the column may have a NULL value.",
            componentProperties: {
                title: "Allow Nulls",
            }
        }, {
            componentType: 'checkbox',
            propertyName: TableColumnProperty.IsPrimaryKey,
            description: "Specifies whether the column is included in the primary key for the table.",
            componentProperties: {
                title: "Primary Key",
            }
        }, {
            componentType: 'input',
            propertyName: TableColumnProperty.Precision,
            description: "For numeric data, the maximum number of decimal digits that can be stored in this database object.",
            componentProperties: {
                title: "Precision",
                width: 60,
                inputType: InputType.Number
            }
        }, {
            componentType: 'input',
            propertyName: TableColumnProperty.Scale,
            description: "For numeric data, the maximum number of decimal digits that can be stored in this database object to the right of decimal point.",
            componentProperties: {
                title: "Scale",
                width: 60,
                inputType: InputType.Number
            }
        }
    ];

    const displayProperties = getTableDisplayProperties(columnTableOptions, [
        TableColumnProperty.Name,
        TableColumnProperty.AdvancedType,
        TableColumnProperty.IsPrimaryKey,
        TableColumnProperty.AllowNulls,
        TableColumnProperty.DefaultValue,
    ]);

    const tabComponents: DesignerDataPropertyInfo[] = [
        {
            componentType: 'table',
            propertyName: TableProperty.Columns,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: "Columns",
                columns: displayProperties,
                itemProperties: addAdditionalTableProperties(columnTableOptions, columnTableColumnDefinitions),
                objectTypeDisplayName: "Column",
                canAddRows: columnTableOptions.canAddRows,
                canInsertRows: columnTableOptions.canInsertRows,
                canMoveRows: columnTableOptions.canMoveRows,
                canRemoveRows: columnTableOptions.canRemoveRows,
                removeRowConfirmationMessage: columnTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: columnTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton: columnTableOptions.labelForAddNewButton ?? "New Column"
            } as DesignerTableProperties
        },
    ];

    const additionalComponents = getAdditionalComponentsForTab(TableProperty.Columns, view.additionalComponents);
    if(additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getPrimaryKeyTabComponents(view: TableDesignerView | undefined): DesignerDataPropertyInfo[] {
    if (!view || !view.primaryKeyColumnSpecificationTableOptions) {
        return [];
    }
    const columnSpecProperties: DesignerDataPropertyInfo[] = [
        {
            componentType: 'dropdown',
            propertyName: TableIndexColumnSpecificationProperty.Column,
            description: "The name of the column.",
            componentProperties: {
                title: "Column",
                width: 150
            }
        }
    ];

    const tabComponents: DesignerDataPropertyInfo[] = [
        {
            componentType: 'input',
            propertyName: TableProperty.PrimaryKeyName,
            showInPropertiesView: false,
            description: "Name of the primary key.",
            componentProperties: {
                title: "Name",
                width: 250
            }
        },
        {
            componentType: 'textarea',
            propertyName: TableProperty.PrimaryKeyDescription,
            showInPropertiesView: false,
            description: "The description of the primary key.",
            componentProperties: {
                title: "Description",
                width: 250
            }
        }
    ];

    if (view.additionalPrimaryKeyProperties) {
        view.additionalPrimaryKeyProperties.forEach(component => {
            const copy = { ...component };
            copy.showInPropertiesView = false;
            tabComponents.push(copy);
        });
    }

    const primaryKeyTableOptions = view.primaryKeyColumnSpecificationTableOptions;
    if (primaryKeyTableOptions) {
        tabComponents.push({
            componentType: 'table',
            propertyName: TableProperty.PrimaryKeyColumns,
            showInPropertiesView: false,
            description: "Columns in the primary key.",
            componentProperties: {
                title: "Primary Key Columns",
                ariaLabel: "Primary Key Columns",
                columns: getTableDisplayProperties(primaryKeyTableOptions, [TableIndexColumnSpecificationProperty.Column]),
                itemProperties: addAdditionalTableProperties(primaryKeyTableOptions, columnSpecProperties),
                objectTypeDisplayName: '',
                canAddRows: primaryKeyTableOptions.canAddRows,
                canRemoveRows: primaryKeyTableOptions.canRemoveRows,
                removeRowConfirmationMessage: primaryKeyTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: primaryKeyTableOptions.showRemoveRowConfirmation,
                showItemDetailInPropertiesView: false,
                labelForAddNewButton: primaryKeyTableOptions.labelForAddNewButton ?? "Add Column",
                canMoveRows: primaryKeyTableOptions.canMoveRows
            } as DesignerTableProperties
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(TableProperty.PrimaryKey, view.additionalComponents);
    if(additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getIndexesTabComponents(view: TableDesignerView | undefined): DesignerDataPropertyInfo[] {
    if (!view || !view.indexTableOptions) {
        return [];
    }
    const indexTableOptions = view.indexTableOptions;
    const columnSpecTableOptions = view.indexColumnSpecificationTableOptions;
    const columnSpecProperties: DesignerDataPropertyInfo[] = [
        {
            componentType: 'dropdown',
            propertyName: TableIndexColumnSpecificationProperty.Column,
            description: "The name of the column.",
            componentProperties: {
                title: "Column",
                width: 100
            }
        }];
    const indexProperties: DesignerDataPropertyInfo[] = [
        {
            componentType: 'input',
            propertyName: TableIndexProperty.Name,
            description: "The name of the index.",
            componentProperties: {
                title: "Name",
                width: 200
            }
        }, {
            componentType: 'input',
            propertyName: TableIndexProperty.Description,
            description: "The description of the index.",
            componentProperties: {
                title: "Description",
                width: 200
            }
        }
    ];

    if (columnSpecTableOptions) {
        indexProperties.push(
            {
                componentType: 'table',
                propertyName: TableIndexProperty.Columns,
                description: "The columns of the index.",
                group: "Columns",
                componentProperties: {
                    ariaLabel: "Columns",
                    columns: getTableDisplayProperties(columnSpecTableOptions, [TableIndexColumnSpecificationProperty.Column]),
                    itemProperties: addAdditionalTableProperties(columnSpecTableOptions, columnSpecProperties),
                    objectTypeDisplayName: '',
                    canAddRows: columnSpecTableOptions.canAddRows,
                    canRemoveRows: columnSpecTableOptions.canRemoveRows,
                    removeRowConfirmationMessage: columnSpecTableOptions.removeRowConfirmationMessage,
                    showRemoveRowConfirmation: columnSpecTableOptions.showRemoveRowConfirmation,
                    labelForAddNewButton: columnSpecTableOptions.labelForAddNewButton ?? "Add Column"
                } as DesignerTableProperties
            }
        );
    }

    const tabComponents: DesignerDataPropertyInfo[] = [];

    if(indexTableOptions) {
        tabComponents.push({
            componentType: 'table',
            propertyName: TableProperty.Indexes,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: "Indexes",
                columns: getTableDisplayProperties(indexTableOptions, [TableIndexProperty.Name]),
                itemProperties: addAdditionalTableProperties(indexTableOptions, indexProperties),
                objectTypeDisplayName: "Index",
                canAddRows: indexTableOptions.canAddRows,
                canRemoveRows: indexTableOptions.canRemoveRows,
                removeRowConfirmationMessage: indexTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: indexTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton: indexTableOptions.labelForAddNewButton ?? "New Index"
            } as DesignerTableProperties
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(TableProperty.Indexes, view.additionalComponents);
    if(additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getForeignKeysTabComponents(view: TableDesignerView | undefined): DesignerDataPropertyInfo[] {
    if (!view || !view.foreignKeyTableOptions) {
        return [];
    }
    const foreignKeyTableOptions = view.foreignKeyTableOptions;
    const columnMappingTableOptions = view!.foreignKeyColumnMappingTableOptions;
    const foreignKeyColumnMappingProperties: DesignerDataPropertyInfo[] = [
        {
            componentType: 'dropdown',
            propertyName: ForeignKeyColumnMappingProperty.ForeignColumn,
            componentProperties: {
                title: "Foreign Column",
                width: 150
            }
        },
        {
            componentType: 'dropdown',
            propertyName: ForeignKeyColumnMappingProperty.Column,
            componentProperties: {
                title: "Column",
                width: 150
            }
        },
    ];

    const foreignKeyProperties: DesignerDataPropertyInfo[] = [
        {
            componentType: 'input',
            propertyName: TableForeignKeyProperty.Name,
            description: "The name of the foreign key.",
            componentProperties: {
                title: "Name",
                width: 300
            }
        },
        {
            componentType: 'input',
            propertyName: TableForeignKeyProperty.Description,
            description: "The description of the foreign key.",
            componentProperties: {
                title: "Description",
            }
        },
        {
            componentType: 'dropdown',
            propertyName: TableForeignKeyProperty.ForeignTable,
            description: "The table which contains the primary or unique key column.",
            componentProperties: {
                title: "Foreign Table",
                width: 200
            }
        },
        {
            componentType: 'dropdown',
            propertyName: TableForeignKeyProperty.OnUpdateAction,
            description: "The behavior when a user tries to update a row with data that is involved in a foreign key relationship.",
            componentProperties: {
                title: "On Update Action",
                width: 100
            }
        },
        {
            componentType: 'dropdown',
            propertyName: TableForeignKeyProperty.OnDeleteAction,
            description: "The behavior when a user tries to delete a row with data that is involved in a foreign key relationship.",
            componentProperties: {
                title: "On Delete Action",
                width: 100
            }
        },

    ];

    if (columnMappingTableOptions) {
        foreignKeyProperties.push({
            componentType: 'table',
            propertyName: TableForeignKeyProperty.Columns,
            description: "The mapping between foreign key columns and primary key columns.",
            group: "Columns",
            componentProperties: {
                ariaLabel: "Columns",
                columns: getTableDisplayProperties(columnMappingTableOptions, [ForeignKeyColumnMappingProperty.Column, ForeignKeyColumnMappingProperty.ForeignColumn]),
                itemProperties: addAdditionalTableProperties(columnMappingTableOptions, foreignKeyColumnMappingProperties),
                canAddRows: columnMappingTableOptions.canAddRows,
                canRemoveRows: columnMappingTableOptions.canRemoveRows,
                removeRowConfirmationMessage: columnMappingTableOptions.removeRowConfirmationMessage,
                labelForAddNewButton: columnMappingTableOptions.labelForAddNewButton ?? "New Column Mapping"
            } as DesignerTableProperties
        });
    }

    const tabComponents: DesignerDataPropertyInfo[] = [];

    if (foreignKeyTableOptions) {
        tabComponents.push({
            componentType: 'table',
            propertyName: TableProperty.ForeignKeys,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: "Foreign Keys",
                columns: getTableDisplayProperties(foreignKeyTableOptions, [TableForeignKeyProperty.Name, TableForeignKeyProperty.ForeignTable]),
                itemProperties: addAdditionalTableProperties(foreignKeyTableOptions, foreignKeyProperties),
                objectTypeDisplayName: "Foreign Key",
                canAddRows: foreignKeyTableOptions.canAddRows,
                canRemoveRows: foreignKeyTableOptions.canRemoveRows,
                removeRowConfirmationMessage: foreignKeyTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: foreignKeyTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton: foreignKeyTableOptions.labelForAddNewButton ?? "New Foreign Key"
            } as DesignerTableProperties
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(TableProperty.ForeignKeys, view.additionalComponents);
    if(additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getCheckConstraintsTabComponents(view: TableDesignerView | undefined): DesignerDataPropertyInfo[] {
    if(!view || !view.checkConstraintTableOptions) {
        return [];
    }
    const checkConstraintTableOptions = view.checkConstraintTableOptions;
    const additionalcomponents = view.additionalComponents || [];
    const checkConstraintProperties: DesignerDataPropertyInfo[] = [
        {
            componentType: 'input',
            propertyName: TableCheckConstraintProperty.Name,
            description: "The name of the check constraint.",
            componentProperties: {
                title: "Name",
                width: 200
            }
        }, {
            componentType: 'input',
            propertyName: TableCheckConstraintProperty.Description,
            description: "The description of the check constraint.",
            componentProperties: {
                title: "Description",
            }
        }, {
            componentType: 'input',
            propertyName: TableCheckConstraintProperty.Expression,
            description: "The expression defining the check constraint.",
            componentProperties: {
                title: "Expression",
                width: 300
            }
        }
    ];

    const tabComponents: DesignerDataPropertyInfo[] = [];

    if(checkConstraintTableOptions) {
        tabComponents.push({
            componentType: 'table',
            propertyName: TableProperty.CheckConstraints,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: "Check Constraints",
                columns: getTableDisplayProperties(checkConstraintTableOptions, [TableCheckConstraintProperty.Name, TableCheckConstraintProperty.Expression]),
                itemProperties: addAdditionalTableProperties(checkConstraintTableOptions, checkConstraintProperties),
                objectTypeDisplayName: "Check Constraint",
                canAddRows: checkConstraintTableOptions.canAddRows,
                canRemoveRows: checkConstraintTableOptions.canRemoveRows,
                removeRowConfirmationMessage: checkConstraintTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: checkConstraintTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton: checkConstraintTableOptions.labelForAddNewButton ?? "New Check Constraint"
            } as DesignerTableProperties
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(TableProperty.CheckConstraints, additionalcomponents);
    if(additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getDesignerView(view: TableDesignerView | undefined): DesignerView {
   return {
    tabs: [
        {
            title: "About table",
            id: DesignerMainPaneTabs.AboutTable,
            components: getAboutTableComponents(view)
        },
        {
            title: "Columns",
            id: DesignerMainPaneTabs.Columns,
            components: getColumnsTabComponents(view)
        },
        {
            title: "Primary Key",
            id: DesignerMainPaneTabs.PrimaryKey,
            components: getPrimaryKeyTabComponents(view)
        },
        {
            title: "Indexes",
            id: DesignerMainPaneTabs.Indexes,
            components: getIndexesTabComponents(view)
        },
        {
            title: "Foreign Keys",
            id: DesignerMainPaneTabs.ForeignKeys,
            components: getForeignKeysTabComponents(view)
        },
        {
            title: "Check Constraints",
            id: DesignerMainPaneTabs.CheckConstraints,
            components: getCheckConstraintsTabComponents(view)
        }
    ]
   };
}


function getTableDisplayProperties(options: TableDesignerBuiltInTableViewOptions | undefined, defaultProperties: string[]): string[] {
    if (!options) {
        return defaultProperties;
    }
    return (options.propertiesToDisplay!.length > 0 ? options.propertiesToDisplay : defaultProperties) || [];
}

function addAdditionalTableProperties(options: TableDesignerBuiltInTableViewOptions, properties: DesignerDataPropertyInfo[]): DesignerDataPropertyInfo[] {
    if (options.additionalProperties) {
        properties.push(...options.additionalProperties);
    }
    return properties;
}

function getAdditionalComponentsForTab(tabId: TableProperty, additionalComponents: DesignerDataPropertyWithTabInfo[] | undefined): DesignerDataPropertyInfo[] {
    if (additionalComponents) {
        return additionalComponents.filter(c => c.tab === tabId);
    }
    return [];
}

export function getIssuesForComponent(componentPath: DesignerPropertyPath, issues: DesignerIssue[]): string {
    if (!issues || issues.length === 0) {
        return "";
    }
    return issues.filter(i => i.propertyPath?.toString() === componentPath.toString()).reduce((acc, issue) => {
        return acc + issue.description + " ";
    }, "");
}