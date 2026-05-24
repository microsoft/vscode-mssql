/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LocalizedConstants from "../constants/locConstants";
import * as designer from "../sharedInterfaces/tableDesigner";

export function getAdvancedOptionsComponents(
    viewDefinition: designer.TableDesignerView | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (!viewDefinition) {
        return [];
    }
    const tabComponents: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "textarea",
            propertyName: designer.TableProperty.Description,
            description: LocalizedConstants.descriptionForTheTable,
            componentProperties: {
                title: LocalizedConstants.description,
                width: 350,
            },
        },
    ];

    if (viewDefinition?.additionalTableProperties) {
        tabComponents.push(...viewDefinition.additionalTableProperties);
    }

    return tabComponents;
}

export function getColumnsTabComponents(
    view: designer.TableDesignerView | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (!view || !view?.columnTableOptions) {
        return [];
    }

    const columnTableOptions = view.columnTableOptions;

    const columnTableColumnDefinitions: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "input",
            propertyName: designer.TableColumnProperty.Name,
            description: LocalizedConstants.theNameOfTheColumnObject,
            componentProperties: {
                title: LocalizedConstants.name,
                width: 150,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableColumnProperty.Description,
            description: LocalizedConstants.displaysTheDescriptionOfTheColumn,
            componentProperties: {
                title: LocalizedConstants.description,
                width: 400,
            },
        },
        {
            componentType: "dropdown",
            propertyName: designer.TableColumnProperty.AdvancedType,
            description: LocalizedConstants.displaysTheUnifiedDataTypeIncludingLength,
            componentProperties: {
                title: LocalizedConstants.dataType,
                width: 120,
                isEditable: true,
            },
        },
        {
            componentType: "dropdown",
            propertyName: designer.TableColumnProperty.Type,
            showInPropertiesView: false,
            description: LocalizedConstants.displaysTheDataTypeNameForThe,
            componentProperties: {
                title: LocalizedConstants.typeLabel,
                width: 100,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableColumnProperty.Length,
            description: LocalizedConstants.theMaximumLengthInCharactersThatCan,
            componentProperties: {
                title: LocalizedConstants.length,
                width: 60,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableColumnProperty.DefaultValue,
            description: LocalizedConstants.aPredefinedGlobalDefaultValueForThe,
            componentProperties: {
                title: LocalizedConstants.defaultValue,
                width: 150,
            },
        },
        {
            componentType: "checkbox",
            propertyName: designer.TableColumnProperty.AllowNulls,
            description: LocalizedConstants.specifiesWhetherTheColumnMayHaveA,
            componentProperties: {
                title: LocalizedConstants.allowNulls,
            },
        },
        {
            componentType: "checkbox",
            propertyName: designer.TableColumnProperty.IsPrimaryKey,
            description: LocalizedConstants.specifiesWhetherTheColumnIsIncludedIn,
            componentProperties: {
                title: LocalizedConstants.primaryKey,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableColumnProperty.Precision,
            description: LocalizedConstants.forNumericDataTheMaximumNumberOf,
            componentProperties: {
                title: LocalizedConstants.precision,
                width: 60,
                inputType: designer.InputType.Number,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableColumnProperty.Scale,
            description: LocalizedConstants.forNumericDataTheMaximumNumberOf2,
            componentProperties: {
                title: LocalizedConstants.scale,
                width: 60,
                inputType: designer.InputType.Number,
            },
        },
    ];

    const displayProperties = getTableDisplayProperties(columnTableOptions, [
        designer.TableColumnProperty.Name,
        designer.TableColumnProperty.AdvancedType,
        designer.TableColumnProperty.IsPrimaryKey,
        designer.TableColumnProperty.IsIdentity,
        designer.TableColumnProperty.AllowNulls,
        designer.TableColumnProperty.DefaultValue,
    ]);

    const tabComponents: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "table",
            propertyName: designer.TableProperty.Columns,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: LocalizedConstants.columns,
                columns: displayProperties,
                itemProperties: addAdditionalTableProperties(
                    columnTableOptions,
                    columnTableColumnDefinitions,
                ),
                objectTypeDisplayName: LocalizedConstants.column,
                canAddRows: columnTableOptions.canAddRows,
                canInsertRows: columnTableOptions.canInsertRows,
                canMoveRows: columnTableOptions.canMoveRows,
                canRemoveRows: columnTableOptions.canRemoveRows,
                removeRowConfirmationMessage: columnTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: columnTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton:
                    columnTableOptions.labelForAddNewButton ?? LocalizedConstants.newColumn,
                expandedGroups: [LocalizedConstants.TableDesigner.General],
            } as designer.DesignerTableProperties,
        },
    ];

    const additionalComponents = getAdditionalComponentsForTab(
        designer.TableProperty.Columns,
        view.additionalComponents,
    );
    if (additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getPrimaryKeyTabComponents(
    view: designer.TableDesignerView | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (!view || !view.primaryKeyColumnSpecificationTableOptions) {
        return [];
    }
    const columnSpecProperties: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "dropdown",
            propertyName: designer.TableIndexColumnSpecificationProperty.Column,
            description: LocalizedConstants.theNameOfTheColumn,
            componentProperties: {
                title: LocalizedConstants.column,
                width: 150,
            },
        },
    ];

    const tabComponents: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "input",
            propertyName: designer.TableProperty.PrimaryKeyName,
            showInPropertiesView: false,
            description: LocalizedConstants.nameOfThePrimaryKey,
            componentProperties: {
                title: LocalizedConstants.name,
                width: 250,
            },
        },
        {
            componentType: "textarea",
            propertyName: designer.TableProperty.PrimaryKeyDescription,
            showInPropertiesView: false,
            description: LocalizedConstants.theDescriptionOfThePrimaryKey,
            componentProperties: {
                title: LocalizedConstants.description,
                width: 250,
            },
        },
    ];

    if (view.additionalPrimaryKeyProperties) {
        view.additionalPrimaryKeyProperties.forEach((component) => {
            const copy = { ...component };
            copy.showInPropertiesView = false;
            tabComponents.push(copy);
        });
    }

    const primaryKeyTableOptions = view.primaryKeyColumnSpecificationTableOptions;
    if (primaryKeyTableOptions) {
        tabComponents.push({
            componentType: "table",
            propertyName: designer.TableProperty.PrimaryKeyColumns,
            showInPropertiesView: false,
            description: LocalizedConstants.columnsInThePrimaryKey,
            componentProperties: {
                title: LocalizedConstants.primaryKeyColumns,
                ariaLabel: LocalizedConstants.primaryKeyColumns,
                columns: getTableDisplayProperties(primaryKeyTableOptions, [
                    designer.TableIndexColumnSpecificationProperty.Column,
                ]),
                itemProperties: addAdditionalTableProperties(
                    primaryKeyTableOptions,
                    columnSpecProperties,
                ),
                objectTypeDisplayName: "",
                canAddRows: primaryKeyTableOptions.canAddRows,
                canRemoveRows: primaryKeyTableOptions.canRemoveRows,
                removeRowConfirmationMessage: primaryKeyTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: primaryKeyTableOptions.showRemoveRowConfirmation,
                showItemDetailInPropertiesView: false,
                labelForAddNewButton:
                    primaryKeyTableOptions.labelForAddNewButton ?? LocalizedConstants.addColumn,
                canMoveRows: primaryKeyTableOptions.canMoveRows,
            } as designer.DesignerTableProperties,
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(
        designer.TableProperty.PrimaryKey,
        view.additionalComponents,
    );
    if (additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getIndexesTabComponents(
    view: designer.TableDesignerView | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (!view || !view.indexTableOptions) {
        return [];
    }
    const indexTableOptions = view.indexTableOptions;
    const columnSpecTableOptions = view.indexColumnSpecificationTableOptions;
    const columnSpecProperties: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "dropdown",
            propertyName: designer.TableIndexColumnSpecificationProperty.Column,
            description: LocalizedConstants.theNameOfTheColumn,
            componentProperties: {
                title: LocalizedConstants.column,
                width: 100,
            },
        },
    ];
    const indexProperties: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "input",
            propertyName: designer.TableIndexProperty.Name,
            description: LocalizedConstants.theNameOfTheIndex,
            group: LocalizedConstants.TableDesigner.AdvancedOptions,
            componentProperties: {
                title: LocalizedConstants.name,
                width: 200,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableIndexProperty.Description,
            description: LocalizedConstants.theDescriptionOfTheIndex,
            group: LocalizedConstants.TableDesigner.AdvancedOptions,
            componentProperties: {
                title: LocalizedConstants.description,
                width: 200,
            },
        },
    ];

    if (columnSpecTableOptions) {
        indexProperties.push({
            componentType: "table",
            propertyName: designer.TableIndexProperty.Columns,
            description: LocalizedConstants.theColumnsOfTheIndex,
            group: LocalizedConstants.TableDesigner.Columns,
            componentProperties: {
                ariaLabel: LocalizedConstants.columns,
                columns: getTableDisplayProperties(columnSpecTableOptions, [
                    designer.TableIndexColumnSpecificationProperty.Column,
                ]),
                itemProperties: addAdditionalTableProperties(
                    columnSpecTableOptions,
                    columnSpecProperties,
                ),
                objectTypeDisplayName: "",
                canAddRows: columnSpecTableOptions.canAddRows,
                canRemoveRows: columnSpecTableOptions.canRemoveRows,
                removeRowConfirmationMessage: columnSpecTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: columnSpecTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton:
                    columnSpecTableOptions.labelForAddNewButton ?? LocalizedConstants.addColumn,
            } as designer.DesignerTableProperties,
        });
    }

    const tabComponents: designer.DesignerDataPropertyInfo[] = [];

    if (indexTableOptions) {
        const includedColumnsGroupName = indexTableOptions.additionalProperties.find(
            (c) => c.propertyName === designer.TableIndexProperty.IncludedColumns,
        )?.group;

        // Making all other properties as advanced options
        indexTableOptions.additionalProperties.forEach((property) => {
            if (!property.group) {
                property.group = LocalizedConstants.TableDesigner.AdvancedOptions;
            }
        });
        tabComponents.push({
            componentType: "table",
            propertyName: designer.TableProperty.Indexes,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: LocalizedConstants.indexes,
                columns: getTableDisplayProperties(indexTableOptions, [
                    designer.TableIndexProperty.Name,
                ]),
                itemProperties: addAdditionalTableProperties(indexTableOptions, indexProperties),
                objectTypeDisplayName: LocalizedConstants.index,
                canAddRows: indexTableOptions.canAddRows,
                canRemoveRows: indexTableOptions.canRemoveRows,
                removeRowConfirmationMessage: indexTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: indexTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton:
                    indexTableOptions.labelForAddNewButton ?? LocalizedConstants.newIndex,
                expandedGroups: [
                    LocalizedConstants.TableDesigner.Columns,
                    includedColumnsGroupName,
                ],
            } as designer.DesignerTableProperties,
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(
        designer.TableProperty.Indexes,
        view.additionalComponents,
    );

    if (additionalComponents) {
        additionalComponents.forEach((component) => {
            if (component.propertyName === designer.TableIndexProperty.ColumnStoreIndex) {
                // Making all ungrouped properties of column store index as advanced options
                const properties =
                    component.componentProperties as designer.DesignerTableProperties;
                properties.expandedGroups = [LocalizedConstants.TableDesigner.Columns];
                properties.itemProperties.forEach((property) => {
                    if (!property.group) {
                        property.group = LocalizedConstants.TableDesigner.AdvancedOptions;
                    }
                });
            }
        });
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getForeignKeysTabComponents(
    view: designer.TableDesignerView | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (!view || !view.foreignKeyTableOptions) {
        return [];
    }
    const foreignKeyTableOptions = view.foreignKeyTableOptions;
    const columnMappingTableOptions = view!.foreignKeyColumnMappingTableOptions;
    const foreignKeyColumnMappingProperties: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "dropdown",
            propertyName: designer.ForeignKeyColumnMappingProperty.ForeignColumn,
            componentProperties: {
                title: LocalizedConstants.foreignColumn,
                width: 150,
            },
        },
        {
            componentType: "dropdown",
            propertyName: designer.ForeignKeyColumnMappingProperty.Column,
            componentProperties: {
                title: LocalizedConstants.column,
                width: 150,
            },
        },
    ];

    const foreignKeyProperties: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "input",
            propertyName: designer.TableForeignKeyProperty.Name,
            description: LocalizedConstants.theNameOfTheForeignKey,
            componentProperties: {
                title: LocalizedConstants.name,
                width: 300,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableForeignKeyProperty.Description,
            description: LocalizedConstants.theDescriptionOfTheForeignKey,
            componentProperties: {
                title: LocalizedConstants.description,
            },
        },
        {
            componentType: "dropdown",
            propertyName: designer.TableForeignKeyProperty.ForeignTable,
            description: LocalizedConstants.theTableWhichContainsThePrimaryOr,
            showInPropertiesView: false,
            componentProperties: {
                title: LocalizedConstants.foreignTable,
                width: 200,
            },
        },
        {
            componentType: "dropdown",
            propertyName: designer.TableForeignKeyProperty.OnUpdateAction,
            description: LocalizedConstants.theBehaviorWhenAUserTriesTo,
            componentProperties: {
                title: LocalizedConstants.onUpdateAction,
                width: 100,
            },
        },
        {
            componentType: "dropdown",
            propertyName: designer.TableForeignKeyProperty.OnDeleteAction,
            description: LocalizedConstants.theBehaviorWhenAUserTriesTo2,
            componentProperties: {
                title: LocalizedConstants.onDeleteAction,
                width: 100,
            },
        },
    ];

    if (columnMappingTableOptions) {
        foreignKeyProperties.push({
            componentType: "table",
            propertyName: designer.TableForeignKeyProperty.Columns,
            description: LocalizedConstants.theMappingBetweenForeignKeyColumnsAnd,
            group: LocalizedConstants.columns,
            componentProperties: {
                ariaLabel: LocalizedConstants.columns,
                columns: getTableDisplayProperties(columnMappingTableOptions, [
                    designer.ForeignKeyColumnMappingProperty.Column,
                    designer.ForeignKeyColumnMappingProperty.ForeignColumn,
                ]),
                itemProperties: addAdditionalTableProperties(
                    columnMappingTableOptions,
                    foreignKeyColumnMappingProperties,
                ),
                canAddRows: columnMappingTableOptions.canAddRows,
                canRemoveRows: columnMappingTableOptions.canRemoveRows,
                removeRowConfirmationMessage:
                    columnMappingTableOptions.removeRowConfirmationMessage,
                labelForAddNewButton:
                    columnMappingTableOptions.labelForAddNewButton ??
                    LocalizedConstants.newColumnMapping,
            } as designer.DesignerTableProperties,
        });
    }

    const tabComponents: designer.DesignerDataPropertyInfo[] = [];

    if (foreignKeyTableOptions) {
        // Making all ungrouped properties of foreign key as advanced options
        foreignKeyProperties.forEach((property) => {
            if (!property.group) {
                property.group = LocalizedConstants.TableDesigner.AdvancedOptions;
            }
        });
        foreignKeyTableOptions.additionalProperties.forEach((property) => {
            if (!property.group) {
                property.group = LocalizedConstants.TableDesigner.AdvancedOptions;
            }
        });
        tabComponents.push({
            componentType: "table",
            propertyName: designer.TableProperty.ForeignKeys,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: LocalizedConstants.foreignKeys,
                columns: getTableDisplayProperties(foreignKeyTableOptions, [
                    designer.TableForeignKeyProperty.Name,
                    designer.TableForeignKeyProperty.ForeignTable,
                ]),
                itemProperties: addAdditionalTableProperties(
                    foreignKeyTableOptions,
                    foreignKeyProperties,
                ),
                objectTypeDisplayName: LocalizedConstants.foreignKey,
                canAddRows: foreignKeyTableOptions.canAddRows,
                canRemoveRows: foreignKeyTableOptions.canRemoveRows,
                removeRowConfirmationMessage: foreignKeyTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: foreignKeyTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton:
                    foreignKeyTableOptions.labelForAddNewButton ?? LocalizedConstants.newForeignKey,
                expandedGroups: [LocalizedConstants.TableDesigner.Columns],
            } as designer.DesignerTableProperties,
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(
        designer.TableProperty.ForeignKeys,
        view.additionalComponents,
    );
    if (additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getCheckConstraintsTabComponents(
    view: designer.TableDesignerView | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (!view || !view.checkConstraintTableOptions) {
        return [];
    }
    const checkConstraintTableOptions = view.checkConstraintTableOptions;
    const additionalcomponents = view.additionalComponents || [];
    const checkConstraintProperties: designer.DesignerDataPropertyInfo[] = [
        {
            componentType: "input",
            propertyName: designer.TableCheckConstraintProperty.Name,
            description: LocalizedConstants.theNameOfTheCheckConstraint,
            componentProperties: {
                title: LocalizedConstants.name,
                width: 200,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableCheckConstraintProperty.Description,
            description: LocalizedConstants.theDescriptionOfTheCheckConstraint,
            componentProperties: {
                title: LocalizedConstants.description,
            },
        },
        {
            componentType: "input",
            propertyName: designer.TableCheckConstraintProperty.Expression,
            description: LocalizedConstants.theExpressionDefiningTheCheckConstraint,
            componentProperties: {
                title: LocalizedConstants.expression,
                width: 300,
            },
        },
    ];

    const tabComponents: designer.DesignerDataPropertyInfo[] = [];

    if (checkConstraintTableOptions) {
        tabComponents.push({
            componentType: "table",
            propertyName: designer.TableProperty.CheckConstraints,
            showInPropertiesView: false,
            componentProperties: {
                ariaLabel: LocalizedConstants.checkConstraints,
                columns: getTableDisplayProperties(checkConstraintTableOptions, [
                    designer.TableCheckConstraintProperty.Name,
                    designer.TableCheckConstraintProperty.Expression,
                ]),
                itemProperties: addAdditionalTableProperties(
                    checkConstraintTableOptions,
                    checkConstraintProperties,
                ),
                objectTypeDisplayName: LocalizedConstants.checkConstraint,
                canAddRows: checkConstraintTableOptions.canAddRows,
                canRemoveRows: checkConstraintTableOptions.canRemoveRows,
                removeRowConfirmationMessage:
                    checkConstraintTableOptions.removeRowConfirmationMessage,
                showRemoveRowConfirmation: checkConstraintTableOptions.showRemoveRowConfirmation,
                labelForAddNewButton:
                    checkConstraintTableOptions.labelForAddNewButton ??
                    LocalizedConstants.newCheckConstraint,
                expandedGroups: [LocalizedConstants.TableDesigner.General],
            } as designer.DesignerTableProperties,
        });
    }

    const additionalComponents = getAdditionalComponentsForTab(
        designer.TableProperty.CheckConstraints,
        additionalcomponents,
    );
    if (additionalComponents) {
        tabComponents.push(...additionalComponents);
    }
    return tabComponents;
}

export function getDesignerView(
    view: designer.TableDesignerView | undefined,
): designer.DesignerView {
    const viewDefinition = {
        tabs: [
            {
                title: LocalizedConstants.columns,
                id: designer.DesignerMainPaneTabs.Columns,
                components: getColumnsTabComponents(view),
            },
            {
                title: LocalizedConstants.primaryKey,
                id: designer.DesignerMainPaneTabs.PrimaryKey,
                components: getPrimaryKeyTabComponents(view),
            },
            {
                title: LocalizedConstants.indexes,
                id: designer.DesignerMainPaneTabs.Indexes,
                components: getIndexesTabComponents(view),
            },
            {
                title: LocalizedConstants.foreignKeys,
                id: designer.DesignerMainPaneTabs.ForeignKeys,
                components: getForeignKeysTabComponents(view),
            },
            {
                title: LocalizedConstants.checkConstraints,
                id: designer.DesignerMainPaneTabs.CheckConstraints,
                components: getCheckConstraintsTabComponents(view),
            },
        ],
    };

    for (const tab of view.additionalTabs) {
        viewDefinition.tabs.push({
            title: tab.title,
            id: tab.id as designer.DesignerMainPaneTabs,
            components: tab.components,
        });
    }

    viewDefinition.tabs.push({
        title: LocalizedConstants.advancedOptions,
        id: designer.DesignerMainPaneTabs.AboutTable,
        components: getAdvancedOptionsComponents(view),
    });
    return viewDefinition;
}

function getTableDisplayProperties(
    options: designer.TableDesignerBuiltInTableViewOptions | undefined,
    defaultProperties: string[],
): string[] {
    if (!options) {
        return defaultProperties;
    }
    return (
        (options.propertiesToDisplay!.length > 0
            ? options.propertiesToDisplay
            : defaultProperties) || []
    );
}

function addAdditionalTableProperties(
    options: designer.TableDesignerBuiltInTableViewOptions,
    properties: designer.DesignerDataPropertyInfo[],
): designer.DesignerDataPropertyInfo[] {
    if (options.additionalProperties) {
        properties.push(...options.additionalProperties);
    }
    return properties;
}

function getAdditionalComponentsForTab(
    tabId: designer.TableProperty,
    additionalComponents: designer.DesignerDataPropertyWithTabInfo[] | undefined,
): designer.DesignerDataPropertyInfo[] {
    if (additionalComponents) {
        return additionalComponents.filter((c) => c.tab === tabId);
    }
    return [];
}
