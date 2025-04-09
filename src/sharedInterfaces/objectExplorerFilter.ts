/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { WebviewContextProps } from "./webview";

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
    private static CONTAINS: string;
    private static NOT_CONTAINS: string;
    private static STARTS_WITH: string;
    private static NOT_STARTS_WITH: string;
    private static ENDS_WITH: string;
    private static NOT_ENDS_WITH: string;
    private static EQUALS: string;
    private static NOT_EQUALS: string;
    private static LESS_THAN: string;
    private static LESS_THAN_OR_EQUALS: string;
    private static GREATER_THAN: string;
    private static GREATER_THAN_OR_EQUALS: string;
    private static BETWEEN: string;
    private static NOT_BETWEEN: string;

    public static initializeStrings(values: {
        CONTAINS: string;
        NOT_CONTAINS: string;
        STARTS_WITH: string;
        NOT_STARTS_WITH: string;
        ENDS_WITH: string;
        NOT_ENDS_WITH: string;
        EQUALS: string;
        NOT_EQUALS: string;
        LESS_THAN: string;
        LESS_THAN_OR_EQUALS: string;
        GREATER_THAN: string;
        GREATER_THAN_OR_EQUALS: string;
        BETWEEN: string;
        NOT_BETWEEN: string;
    }) {
        this.CONTAINS = values.CONTAINS;
        this.NOT_CONTAINS = values.NOT_CONTAINS;
        this.STARTS_WITH = values.STARTS_WITH;
        this.NOT_STARTS_WITH = values.NOT_STARTS_WITH;
        this.ENDS_WITH = values.ENDS_WITH;
        this.NOT_ENDS_WITH = values.NOT_ENDS_WITH;
        this.EQUALS = values.EQUALS;
        this.NOT_EQUALS = values.NOT_EQUALS;
        this.LESS_THAN = values.LESS_THAN;
        this.LESS_THAN_OR_EQUALS = values.LESS_THAN_OR_EQUALS;
        this.GREATER_THAN = values.GREATER_THAN;
        this.GREATER_THAN_OR_EQUALS = values.GREATER_THAN_OR_EQUALS;
        this.BETWEEN = values.BETWEEN;
        this.NOT_BETWEEN = values.NOT_BETWEEN;
    }

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

    static getErrorTextFromFilters(
        filters: vscodeMssql.NodeFilter[],
        firstValueEmptyError: (operator: string, name: string) => string,
        secondValueEmptyError: (operator: string, name: string) => string,
        firstValueLessThanSecondError: (operator: string, name: string) => string,
    ): string {
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
                        firstValueEmptyError(
                            this.getFilterOperatorString(filter.operator)!,
                            filter.name,
                        ) ??
                        `The first value must be set for the ${this.getFilterOperatorString(filter.operator)} operator in the ${filter.name} filter`;
                } else if (!value2 && value1) {
                    errorText =
                        secondValueEmptyError(
                            this.getFilterOperatorString(filter.operator)!,
                            filter.name,
                        ) ??
                        `The second value must be set for the ${this.getFilterOperatorString(filter.operator)} operator in the ${filter.name} filter`;
                } else if (value1 > value2) {
                    errorText =
                        firstValueLessThanSecondError(
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
