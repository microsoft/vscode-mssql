/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";

export interface AdvancedColumnOption {
    label: string;
    type: "input" | "input-number" | "checkbox" | "textarea";
    value: string | number | boolean;
    hint?: string;
    columnProperty: keyof SchemaDesigner.Column;
    columnModifier: (
        column: SchemaDesigner.Column,
        value: string | number | boolean,
    ) => SchemaDesigner.Column;
}

export const columnUtils = {
    isColumnValid: (
        column: SchemaDesigner.Column,
        columns: SchemaDesigner.Column[],
    ): string | undefined => {
        const conflict = columns.find(
            (c) =>
                c.name.toLowerCase() === column.name.toLowerCase() &&
                c.id !== column.id &&
                c.dataType === column.dataType,
        );
        if (conflict) {
            return locConstants.schemaDesigner.columnNameRepeatedError(column.name);
        }
        if (!column.name) {
            return locConstants.schemaDesigner.columnNameEmptyError;
        }
        if (column.isPrimaryKey && column.isNullable) {
            return locConstants.schemaDesigner.columnPKCannotBeNull(column.name);
        }

        if (columnUtils.isLengthBasedType(column.dataType)) {
            if (!column.maxLength) {
                return locConstants.schemaDesigner.columnMaxLengthEmptyError;
            }
            if (column.maxLength !== "MAX") {
                const maxLength = parseInt(column.maxLength);
                if (isNaN(maxLength) || maxLength <= 0) {
                    return locConstants.schemaDesigner.columnMaxLengthInvalid(column.maxLength);
                }
            }
        }
    },

    isLengthBasedType: (type: string): boolean => {
        return ["char", "varchar", "nchar", "nvarchar", "binary", "varbinary", "vector"].includes(
            type,
        );
    },

    isTimeBasedWithScale: (type: string): boolean => {
        return ["datetime2", "datetimeoffset", "time"].includes(type);
    },

    isPrecisionBasedType: (type: string): boolean => {
        return ["decimal", "numeric"].includes(type);
    },

    isIdentityBasedType: (type: string, scale: number): boolean => {
        if (type === "decimal" || type === "numeric") {
            return scale === 0;
        }
        return ["int", "bigint", "smallint", "tinyint"].includes(type);
    },

    getDefaultLength: (type: string): string => {
        switch (type) {
            case "char":
            case "nchar":
            case "binary":
            case "vector":
                return "1";
            case "varchar":
            case "nvarchar":
            case "varbinary":
                return "50";
            default:
                return "0";
        }
    },

    getDefaultPrecision: (type: string): number => {
        switch (type) {
            case "decimal":
            case "numeric":
                return 18;
            default:
                return 0;
        }
    },

    getDefaultScale: (type: string): number => {
        switch (type) {
            case "decimal":
            case "numeric":
                return 0;
            default:
                return 0;
        }
    },

    fillColumnDefaults: (column: SchemaDesigner.Column): SchemaDesigner.Column => {
        if (columnUtils.isLengthBasedType(column.dataType)) {
            column.maxLength = columnUtils.getDefaultLength(column.dataType);
        } else {
            column.maxLength = "";
        }

        if (columnUtils.isPrecisionBasedType(column.dataType)) {
            column.precision = columnUtils.getDefaultPrecision(column.dataType);
            column.scale = columnUtils.getDefaultScale(column.dataType);
        } else {
            column.precision = 0;
            column.scale = 0;
        }

        if (columnUtils.isTimeBasedWithScale(column.dataType)) {
            column.scale = columnUtils.getDefaultScale(column.dataType);
        } else {
            column.scale = 0;
        }

        return column;
    },

    getAdvancedOptions: (column: SchemaDesigner.Column): AdvancedColumnOption[] => {
        const options: AdvancedColumnOption[] = [];

        if (!column.isPrimaryKey) {
            options.push({
                label: locConstants.schemaDesigner.allowNull,
                type: "checkbox",
                value: false,
                columnProperty: "isNullable",
                columnModifier: (column, value) => {
                    column.isNullable = value as boolean;
                    return column;
                },
            });
        }

        if (!column.isComputed) {
            if (
                columnUtils.isIdentityBasedType(column.dataType, column.scale) &&
                (!column.isNullable || column.isPrimaryKey)
            ) {
                options.push({
                    label: locConstants.schemaDesigner.isIdentity,
                    value: "isIdentity",
                    type: "checkbox",
                    columnProperty: "isIdentity",
                    columnModifier: (column, value) => {
                        column.isIdentity = value as boolean;
                        column.identitySeed = value ? 1 : 0;
                        column.identityIncrement = value ? 1 : 0;
                        return column;
                    },
                });
            }

            if (columnUtils.isLengthBasedType(column.dataType)) {
                options.push({
                    label: locConstants.schemaDesigner.maxLength,
                    value: "",
                    type: "input",
                    columnProperty: "maxLength",
                    columnModifier: (column, value) => {
                        column.maxLength = value as string;
                        if (!column.maxLength) {
                            column.maxLength = "0";
                        }
                        return column;
                    },
                });
            }

            if (columnUtils.isPrecisionBasedType(column.dataType)) {
                options.push({
                    label: locConstants.schemaDesigner.precision,
                    value: "",
                    type: "input-number",
                    columnProperty: "precision",
                    columnModifier: (column, value) => {
                        column.precision = value as number;
                        return column;
                    },
                });
            }

            if (
                columnUtils.isTimeBasedWithScale(column.dataType) ||
                columnUtils.isPrecisionBasedType(column.dataType)
            ) {
                options.push({
                    label: locConstants.schemaDesigner.scale,
                    value: "",
                    type: "input-number",
                    columnProperty: "scale",
                    columnModifier: (column, value) => {
                        column.scale = value as number;
                        return column;
                    },
                });
            }

            options.push({
                label: locConstants.schemaDesigner.defaultValue,
                value: "",
                type: "textarea",
                columnProperty: "defaultValue",
                columnModifier: (column, value) => {
                    column.defaultValue = value as string;
                    return column;
                },
            });
        }

        options.push({
            label: locConstants.schemaDesigner.isComputed,
            value: false,
            type: "checkbox",
            columnProperty: "isComputed",
            columnModifier: (column, value) => {
                column.isComputed = value as boolean;
                column.isPrimaryKey = false;
                column.isIdentity = false;
                column.identitySeed = 0;
                column.identityIncrement = 0;
                column.isNullable = true;
                column.computedFormula = value ? "1" : "";
                column.computedPersisted = false;
                column.dataType = value ? "int" : column.dataType;
                return column;
            },
        });

        if (column.isComputed) {
            options.push({
                label: locConstants.schemaDesigner.computedFormula,
                value: "",
                type: "textarea",
                columnProperty: "computedFormula",
                columnModifier: (column, value) => {
                    column.computedFormula = value as string;
                    return column;
                },
            });
            options.push({
                label: locConstants.schemaDesigner.isPersisted,
                value: false,
                type: "checkbox",
                columnProperty: "computedPersisted",
                columnModifier: (column, value) => {
                    column.computedPersisted = value as boolean;
                    return column;
                },
            });
        }

        return options;
    },
};
