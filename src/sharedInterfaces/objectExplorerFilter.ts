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
    private static strings: any;

    public static initializeStrings(strings: any) {
        this.strings = strings;
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
                            f.selectedOperator === this.strings.between ||
                            f.selectedOperator === this.strings.notBetween
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
                return this.strings.contains;
            case NodeFilterOperator.NotContains:
                return this.strings.notContains;
            case NodeFilterOperator.StartsWith:
                return this.strings.startsWith;
            case NodeFilterOperator.NotStartsWith:
                return this.strings.notStartsWith;
            case NodeFilterOperator.EndsWith:
                return this.strings.endsWith;
            case NodeFilterOperator.NotEndsWith:
                return this.strings.notEndsWith;
            case NodeFilterOperator.Equals:
                return this.strings.equals;
            case NodeFilterOperator.NotEquals:
                return this.strings.notEquals;
            case NodeFilterOperator.LessThan:
                return this.strings.lessThan;
            case NodeFilterOperator.LessThanOrEquals:
                return this.strings.lessThanOrEquals;
            case NodeFilterOperator.GreaterThan:
                return this.strings.greaterThan;
            case NodeFilterOperator.GreaterThanOrEquals:
                return this.strings.greaterThanOrEquals;
            case NodeFilterOperator.Between:
                return this.strings.between;
            case NodeFilterOperator.NotBetween:
                return this.strings.notBetween;
            default:
                return "";
        }
    }

    static getFilterOperatorEnum(operator: string): NodeFilterOperator {
        switch (operator) {
            case this.strings.contains:
                return NodeFilterOperator.Contains;
            case this.strings.notContains:
                return NodeFilterOperator.NotContains;
            case this.strings.startsWith:
                return NodeFilterOperator.StartsWith;
            case this.strings.notStartsWith:
                return NodeFilterOperator.NotStartsWith;
            case this.strings.endsWith:
                return NodeFilterOperator.EndsWith;
            case this.strings.notEndsWith:
                return NodeFilterOperator.NotEndsWith;
            case this.strings.equals:
                return NodeFilterOperator.Equals;
            case this.strings.notEquals:
                return NodeFilterOperator.NotEquals;
            case this.strings.lessThan:
                return NodeFilterOperator.LessThan;
            case this.strings.lessThanOrEquals:
                return NodeFilterOperator.LessThanOrEquals;
            case this.strings.greaterThan:
                return NodeFilterOperator.GreaterThan;
            case this.strings.greaterThanOrEquals:
                return NodeFilterOperator.GreaterThanOrEquals;
            case this.strings.between:
                return NodeFilterOperator.Between;
            case this.strings.notBetween:
                return NodeFilterOperator.NotBetween;
            default:
                return NodeFilterOperator.Equals;
        }
    }

    static getFilterOperators(property: vscodeMssql.NodeFilterProperty): string[] {
        switch (property.type) {
            case NodeFilterPropertyDataType.Boolean:
                return [this.strings.equals, this.strings.notEquals];
            case NodeFilterPropertyDataType.String:
                return [
                    this.strings.contains,
                    this.strings.notContains,
                    this.strings.startsWith,
                    this.strings.notStartsWith,
                    this.strings.endsWith,
                    this.strings.notEndsWith,
                    this.strings.equals,
                    this.strings.notEquals,
                ];
            case NodeFilterPropertyDataType.Number:
            case NodeFilterPropertyDataType.Date:
                return [
                    this.strings.equals,
                    this.strings.notEquals,
                    this.strings.lessThan,
                    this.strings.lessThanOrEquals,
                    this.strings.greaterThan,
                    this.strings.greaterThanOrEquals,
                    this.strings.between,
                    this.strings.notBetween,
                ];
            case NodeFilterPropertyDataType.Choice:
                return [this.strings.equals, this.strings.notEquals];
            default:
                return [];
        }
    }
}
