/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { locConstants } from "../reactviews/common/locConstants";
import { WebviewContextProps } from "../reactviews/common/vscodeWebviewProvider";

export interface ObjectExplorerFilterState {
    filterProperties: vscodeMssql.NodeFilterProperty[];
    existingFilters: vscodeMssql.NodeFilter[];
    nodePath?: string;
}

export interface ObjectExplorerReducers {
    submit: {
        filters: vscodeMssql.NodeFilter[];
    };
    cancel: {};
}

export interface ObjectExplorerFilterContextProps
    extends WebviewContextProps<ObjectExplorerFilterState | undefined> {
    submit: (filters: vscodeMssql.NodeFilter[]) => void;
    clearAllFilters: () => void;
    cancel: () => void;
}

export enum NodeFilterPropertyDataType {
    String = 0,
    Number = 1,
    Boolean = 2,
    Date = 3,
    Choice = 4,
}

export enum NodeFilterOperator {
    Equals = 0,
    NotEquals = 1,
    LessThan = 2,
    LessThanOrEquals = 3,
    GreaterThan = 4,
    GreaterThanOrEquals = 5,
    Between = 6,
    NotBetween = 7,
    Contains = 8,
    NotContains = 9,
    StartsWith = 10,
    NotStartsWith = 11,
    EndsWith = 12,
    NotEndsWith = 13,
}

export interface ObjectExplorerPageFilter {
    index: number;
    name: string;
    displayName: string;
    value: string | string[] | number | number[] | boolean | undefined;
    type: NodeFilterPropertyDataType;
    choices?: {
        name: string;
        displayName: string;
    }[];
    operatorOptions: string[];
    selectedOperator: string;
    description: string;
}

export class ObjectExplorerFilterUtils {
    // The null check is required for ObjectExplorerFilterUtils methods to work properly during testing.
    private static readonly CONTAINS = locConstants.objectExplorerFiltering.contains ?? "Contains";
    private static readonly NOT_CONTAINS =
        locConstants.objectExplorerFiltering.notContains ?? "Not Contains";
    private static readonly STARTS_WITH =
        locConstants.objectExplorerFiltering.startsWith ?? "Starts With";
    private static readonly NOT_STARTS_WITH =
        locConstants.objectExplorerFiltering.notStartsWith ?? "Not Starts With";
    private static readonly ENDS_WITH =
        locConstants.objectExplorerFiltering.endsWith ?? "Ends With";
    private static readonly NOT_ENDS_WITH =
        locConstants.objectExplorerFiltering.notEndsWith ?? "Not Ends With";
    private static readonly EQUALS = locConstants.objectExplorerFiltering.equals ?? "Equals";
    private static readonly NOT_EQUALS =
        locConstants.objectExplorerFiltering.notEquals ?? "Not Equals";
    private static readonly LESS_THAN =
        locConstants.objectExplorerFiltering.lessThan ?? "Less Than";
    private static readonly LESS_THAN_OR_EQUALS =
        locConstants.objectExplorerFiltering.lessThanOrEquals ?? "Less Than or Equals";
    private static readonly GREATER_THAN =
        locConstants.objectExplorerFiltering.greaterThan ?? "Greater Than";
    private static readonly GREATER_THAN_OR_EQUALS =
        locConstants.objectExplorerFiltering.greaterThanOrEquals ?? "Greater Than or Equals";
    private static readonly BETWEEN = locConstants.objectExplorerFiltering.between ?? "Between";
    private static readonly NOT_BETWEEN =
        locConstants.objectExplorerFiltering.notBetween ?? "Not Between";

    static getFilters(uiFilters: ObjectExplorerPageFilter[]): vscodeMssql.NodeFilter[] {
        return uiFilters
            .map((f) => {
                let value: any = undefined;
                switch (f.type) {
                    case NodeFilterPropertyDataType.Boolean:
                    case NodeFilterPropertyDataType.Choice:
                        value =
                            f.value === "" || f.value === undefined
                                ? undefined
                                : (f.choices?.find((c) => c.displayName === f.value)?.name ??
                                  undefined);
                        break;
                    case NodeFilterPropertyDataType.Number:
                        if (
                            f.selectedOperator === this.BETWEEN ||
                            f.selectedOperator === this.NOT_BETWEEN
                        ) {
                            value = (f.value as string[]).map((v) => Number(v));
                        } else {
                            value = Number(f.value);
                        }
                        break;
                    case NodeFilterPropertyDataType.String:
                    case NodeFilterPropertyDataType.Date:
                        value = f.value;
                        break;
                }

                return {
                    name: f.name,
                    value: value!,
                    operator: this.getFilterOperatorEnum(f.selectedOperator),
                };
            })
            .filter((f) => {
                if (
                    f.operator === NodeFilterOperator.Between ||
                    f.operator === NodeFilterOperator.NotBetween
                ) {
                    return (f.value as string[])[0] !== "" || (f.value as string[])[1] !== "";
                }
                return f.value !== "" && f.value !== undefined;
            });
    }

    static getErrorTextFromFilters(filters: vscodeMssql.NodeFilter[]): string {
        let errorText = "";
        for (let filter of filters) {
            if (
                filter.operator === NodeFilterOperator.Between ||
                filter.operator === NodeFilterOperator.NotBetween
            ) {
                let value1 = (filter.value as string[] | number[])[0];
                let value2 = (filter.value as string[] | number[])[1];
                if (!value1 && value2) {
                    // Only undefined during testing
                    errorText =
                        locConstants.objectExplorerFiltering.firstValueEmptyError(
                            this.getFilterOperatorString(filter.operator)!,
                            filter.name,
                        ) ??
                        `The first value must be set for the ${this.getFilterOperatorString(filter.operator)} operator in the ${filter.name} filter`;
                } else if (!value2 && value1) {
                    errorText =
                        locConstants.objectExplorerFiltering.secondValueEmptyError(
                            this.getFilterOperatorString(filter.operator)!,
                            filter.name,
                        ) ??
                        `The second value must be set for the ${this.getFilterOperatorString(filter.operator)} operator in the ${filter.name} filter`;
                } else if (value1 > value2) {
                    errorText =
                        locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                            this.getFilterOperatorString(filter.operator)!,
                            filter.name,
                        ) ??
                        `The first value must be less than the second value for the ${this.getFilterOperatorString(filter.operator)} operator in the ${filter.name} filter`;
                }
            }
        }
        return errorText;
    }

    static getFilterOperatorString(operator: NodeFilterOperator | undefined): string | undefined {
        if (operator === undefined) {
            return undefined;
        }

        switch (operator) {
            case NodeFilterOperator.Contains:
                return this.CONTAINS;
            case NodeFilterOperator.NotContains:
                return this.NOT_CONTAINS;
            case NodeFilterOperator.StartsWith:
                return this.STARTS_WITH;
            case NodeFilterOperator.NotStartsWith:
                return this.NOT_STARTS_WITH;
            case NodeFilterOperator.EndsWith:
                return this.ENDS_WITH;
            case NodeFilterOperator.NotEndsWith:
                return this.NOT_ENDS_WITH;
            case NodeFilterOperator.Equals:
                return this.EQUALS;
            case NodeFilterOperator.NotEquals:
                return this.NOT_EQUALS;
            case NodeFilterOperator.LessThan:
                return this.LESS_THAN;
            case NodeFilterOperator.LessThanOrEquals:
                return this.LESS_THAN_OR_EQUALS;
            case NodeFilterOperator.GreaterThan:
                return this.GREATER_THAN;
            case NodeFilterOperator.GreaterThanOrEquals:
                return this.GREATER_THAN_OR_EQUALS;
            case NodeFilterOperator.Between:
                return this.BETWEEN;
            case NodeFilterOperator.NotBetween:
                return this.NOT_BETWEEN;
            default:
                return "";
        }
    }

    static getFilterOperatorEnum(operator: string): NodeFilterOperator {
        switch (operator) {
            case this.CONTAINS:
                return NodeFilterOperator.Contains;
            case this.NOT_CONTAINS:
                return NodeFilterOperator.NotContains;
            case this.STARTS_WITH:
                return NodeFilterOperator.StartsWith;
            case this.NOT_STARTS_WITH:
                return NodeFilterOperator.NotStartsWith;
            case this.ENDS_WITH:
                return NodeFilterOperator.EndsWith;
            case this.NOT_ENDS_WITH:
                return NodeFilterOperator.NotEndsWith;
            case this.EQUALS:
                return NodeFilterOperator.Equals;
            case this.NOT_EQUALS:
                return NodeFilterOperator.NotEquals;
            case this.LESS_THAN:
                return NodeFilterOperator.LessThan;
            case this.LESS_THAN_OR_EQUALS:
                return NodeFilterOperator.LessThanOrEquals;
            case this.GREATER_THAN:
                return NodeFilterOperator.GreaterThan;
            case this.GREATER_THAN_OR_EQUALS:
                return NodeFilterOperator.GreaterThanOrEquals;
            case this.BETWEEN:
                return NodeFilterOperator.Between;
            case this.NOT_BETWEEN:
                return NodeFilterOperator.NotBetween;
            default:
                return NodeFilterOperator.Equals;
        }
    }

    static getFilterOperators(property: vscodeMssql.NodeFilterProperty): string[] {
        switch (property.type) {
            case NodeFilterPropertyDataType.Boolean:
                return [this.EQUALS, this.NOT_EQUALS];
            case NodeFilterPropertyDataType.String:
                return [
                    this.CONTAINS,
                    this.NOT_CONTAINS,
                    this.STARTS_WITH,
                    this.NOT_STARTS_WITH,
                    this.ENDS_WITH,
                    this.NOT_ENDS_WITH,
                    this.EQUALS,
                    this.NOT_EQUALS,
                ];
            case NodeFilterPropertyDataType.Number:
            case NodeFilterPropertyDataType.Date:
                return [
                    this.EQUALS,
                    this.NOT_EQUALS,
                    this.LESS_THAN,
                    this.LESS_THAN_OR_EQUALS,
                    this.GREATER_THAN,
                    this.GREATER_THAN_OR_EQUALS,
                    this.BETWEEN,
                    this.NOT_BETWEEN,
                ];
            case NodeFilterPropertyDataType.Choice:
                return [this.EQUALS, this.NOT_EQUALS];
            default:
                return [];
        }
    }
}
