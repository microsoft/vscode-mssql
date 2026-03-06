/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { Fragment, useContext, useEffect, useState } from "react";
import { ObjectExplorerFilterContext } from "./ObjectExplorerFilterStateProvider";
import { useObjectExplorerFilterSelector } from "./objectExplorerFilterSelector";
import * as vscodeMssql from "vscode-mssql";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
    ObjectExplorerPageFilter,
} from "../../../sharedInterfaces/objectExplorerFilter";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { FilterFunnelIcon16Regular } from "../../common/icons/filterFunnel";
import { ObjectExplorerFilterContent } from "./ObjectExplorerFilterContent";

const useStyles = makeStyles({
    breadcrumb: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: "8px",
        rowGap: "4px",
        minWidth: 0,
    },
    breadcrumbSegment: {
        color: "var(--vscode-descriptionForeground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    breadcrumbCurrent: {
        color: "var(--vscode-foreground)",
    },
    breadcrumbSeparator: {
        color: "var(--vscode-breadcrumb-foreground, var(--vscode-descriptionForeground))",
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
    },
});

export const ObjectExplorerFilterPage = () => {
    const styles = useStyles();
    const context = useContext(ObjectExplorerFilterContext);
    const filterProperties = useObjectExplorerFilterSelector((s) => s?.filterProperties);
    const existingFilters = useObjectExplorerFilterSelector((s) => s?.existingFilters);
    const nodePath = useObjectExplorerFilterSelector((s) => s?.nodePath);
    const breadcrumbSegments = useObjectExplorerFilterSelector((s) => s?.breadcrumbSegments);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [uiFilters, setUiFilters] = useState<ObjectExplorerPageFilter[]>([]);

    const isBetweenOperator = (operator: NodeFilterOperator): boolean => {
        return (
            operator === NodeFilterOperator.Between || operator === NodeFilterOperator.NotBetween
        );
    };

    const toRawString = (value: unknown): string => {
        if (typeof value === "string") {
            return value.trim();
        }
        if (value === undefined) {
            return "";
        }
        return String(value).trim();
    };

    const parseNumericFilterValue = (value: string): number | undefined => {
        if (value === "") {
            return undefined;
        }

        const parsedValue = Number(value);
        return Number.isNaN(parsedValue) ? undefined : parsedValue;
    };

    const operatorLabels: Record<NodeFilterOperator, string> = {
        [NodeFilterOperator.Contains]: locConstants.objectExplorerFiltering.contains,
        [NodeFilterOperator.NotContains]: locConstants.objectExplorerFiltering.notContains,
        [NodeFilterOperator.StartsWith]: locConstants.objectExplorerFiltering.startsWith,
        [NodeFilterOperator.NotStartsWith]: locConstants.objectExplorerFiltering.notStartsWith,
        [NodeFilterOperator.EndsWith]: locConstants.objectExplorerFiltering.endsWith,
        [NodeFilterOperator.NotEndsWith]: locConstants.objectExplorerFiltering.notEndsWith,
        [NodeFilterOperator.Equals]: locConstants.objectExplorerFiltering.equals,
        [NodeFilterOperator.NotEquals]: locConstants.objectExplorerFiltering.notEquals,
        [NodeFilterOperator.LessThan]: locConstants.objectExplorerFiltering.lessThan,
        [NodeFilterOperator.LessThanOrEquals]:
            locConstants.objectExplorerFiltering.lessThanOrEquals,
        [NodeFilterOperator.GreaterThan]: locConstants.objectExplorerFiltering.greaterThan,
        [NodeFilterOperator.GreaterThanOrEquals]:
            locConstants.objectExplorerFiltering.greaterThanOrEquals,
        [NodeFilterOperator.Between]: locConstants.objectExplorerFiltering.between,
        [NodeFilterOperator.NotBetween]: locConstants.objectExplorerFiltering.notBetween,
    };

    function getFilterOperatorString(operator: NodeFilterOperator | undefined): string {
        if (operator === undefined) {
            return "";
        }
        return operatorLabels[operator] ?? "";
    }

    function getFilterOperators(property: vscodeMssql.NodeFilterProperty): NodeFilterOperator[] {
        switch (property.type) {
            case NodeFilterPropertyDataType.Boolean:
                return [NodeFilterOperator.Equals, NodeFilterOperator.NotEquals];
            case NodeFilterPropertyDataType.String:
                return [
                    NodeFilterOperator.Contains,
                    NodeFilterOperator.NotContains,
                    NodeFilterOperator.StartsWith,
                    NodeFilterOperator.NotStartsWith,
                    NodeFilterOperator.EndsWith,
                    NodeFilterOperator.NotEndsWith,
                    NodeFilterOperator.Equals,
                    NodeFilterOperator.NotEquals,
                ];
            case NodeFilterPropertyDataType.Number:
                return [
                    NodeFilterOperator.Equals,
                    NodeFilterOperator.NotEquals,
                    NodeFilterOperator.LessThan,
                    NodeFilterOperator.LessThanOrEquals,
                    NodeFilterOperator.GreaterThan,
                    NodeFilterOperator.GreaterThanOrEquals,
                    NodeFilterOperator.Between,
                    NodeFilterOperator.NotBetween,
                ];
            case NodeFilterPropertyDataType.Date:
                return [
                    NodeFilterOperator.Equals,
                    NodeFilterOperator.NotEquals,
                    NodeFilterOperator.LessThan,
                    NodeFilterOperator.LessThanOrEquals,
                    NodeFilterOperator.GreaterThan,
                    NodeFilterOperator.GreaterThanOrEquals,
                    NodeFilterOperator.Between,
                    NodeFilterOperator.NotBetween,
                ];
            case NodeFilterPropertyDataType.Choice:
                return [NodeFilterOperator.Equals, NodeFilterOperator.NotEquals];
            default:
                return [];
        }
    }

    function getFilterChoices(
        property: vscodeMssql.NodeFilterChoiceProperty | vscodeMssql.NodeFilterProperty,
    ):
        | {
              name: string;
              displayName: string;
          }[]
        | undefined {
        switch (property.type) {
            case NodeFilterPropertyDataType.Choice:
                return (property as vscodeMssql.NodeFilterChoiceProperty).choices.map((choice) => {
                    return {
                        name: choice.value,
                        displayName: choice.displayName!,
                    };
                });
            case NodeFilterPropertyDataType.Boolean:
                return [
                    {
                        name: "true",
                        displayName: "True",
                    },
                    {
                        name: "false",
                        displayName: "False",
                    },
                ];
            default:
                return undefined;
        }
    }

    useEffect(() => {
        function setIntialFocus() {
            const input = document.getElementById("input-0");
            if (input) {
                input.focus();
            }
        }

        const loadUiFilters = () => {
            setUiFilters(
                filterProperties?.map((value, index) => {
                    const filter = existingFilters?.find((f) => f.name === value.name);
                    const operatorOptions = getFilterOperators(value);
                    const defaultOperator = operatorOptions[0] ?? NodeFilterOperator.Equals;
                    return {
                        index: index,
                        name: value.name,
                        displayName: value.displayName,
                        value: filter?.value ?? "",
                        type: value.type,
                        choices: getFilterChoices(value) ?? [],
                        operatorOptions: operatorOptions,
                        selectedOperator:
                            filter?.operator !== undefined ? filter.operator : defaultOperator,
                        description: value.description,
                    };
                }) ?? [],
            );
        };

        setIntialFocus();
        loadUiFilters();
        setErrorMessage(undefined);
    }, [filterProperties]);
    if (!context || !filterProperties) {
        return undefined;
    }

    const breadcrumb =
        breadcrumbSegments && breadcrumbSegments.length > 0 ? (
            <div className={styles.breadcrumb}>
                {breadcrumbSegments.map((segment, index) => {
                    const isLast = index === breadcrumbSegments.length - 1;
                    return (
                        <Fragment key={`${segment}-${index}`}>
                            <span
                                className={`${styles.breadcrumbSegment} ${
                                    isLast ? styles.breadcrumbCurrent : ""
                                }`}>
                                {segment}
                            </span>
                            {!isLast && (
                                <span className={styles.breadcrumbSeparator} aria-hidden="true">
                                    &gt;
                                </span>
                            )}
                        </Fragment>
                    );
                })}
            </div>
        ) : nodePath ? (
            locConstants.objectExplorerFiltering.path(nodePath)
        ) : undefined;

    const clearAllFilters = () => {
        for (const filters of uiFilters) {
            if (isBetweenOperator(filters.selectedOperator)) {
                filters.value = ["", ""];
            } else {
                filters.value = "";
            }
        }
        setUiFilters([...uiFilters]);
    };

    const submitFilters = () => {
        const filters: vscodeMssql.NodeFilter[] = [];
        let errorText = "";

        for (const filter of uiFilters) {
            const betweenOperator = isBetweenOperator(filter.selectedOperator);

            if (filter.type === NodeFilterPropertyDataType.Number) {
                if (betweenOperator) {
                    const rawValues = Array.isArray(filter.value)
                        ? (filter.value as string[])
                        : [toRawString(filter.value), ""];
                    const value1Raw = toRawString(rawValues[0]);
                    const value2Raw = toRawString(rawValues[1]);

                    // Skip empty numeric range filters before any conversion.
                    if (value1Raw === "" && value2Raw === "") {
                        continue;
                    }

                    const value1 = parseNumericFilterValue(value1Raw);
                    const value2 = parseNumericFilterValue(value2Raw);

                    if (value1 === undefined && value2 !== undefined) {
                        errorText = locConstants.objectExplorerFiltering.firstValueEmptyError(
                            getFilterOperatorString(filter.selectedOperator),
                            filter.name,
                        );
                        break;
                    }

                    if (value2 === undefined && value1 !== undefined) {
                        errorText = locConstants.objectExplorerFiltering.secondValueEmptyError(
                            getFilterOperatorString(filter.selectedOperator),
                            filter.name,
                        );
                        break;
                    }

                    // Treat NaN/invalid numeric values as unset.
                    if (value1 === undefined && value2 === undefined) {
                        continue;
                    }

                    if (value1! > value2!) {
                        errorText =
                            locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                                getFilterOperatorString(filter.selectedOperator),
                                filter.name,
                            );
                        break;
                    }

                    filters.push({
                        name: filter.name,
                        value: [value1!, value2!],
                        operator: filter.selectedOperator,
                    });
                    continue;
                }

                const rawValue = toRawString(filter.value);
                if (rawValue === "") {
                    continue;
                }

                const numericValue = parseNumericFilterValue(rawValue);
                if (numericValue === undefined) {
                    continue;
                }

                filters.push({
                    name: filter.name,
                    value: numericValue,
                    operator: filter.selectedOperator,
                });
                continue;
            }

            if (betweenOperator) {
                const rawValues = Array.isArray(filter.value)
                    ? (filter.value as string[])
                    : [toRawString(filter.value), ""];
                const value1 = toRawString(rawValues[0]);
                const value2 = toRawString(rawValues[1]);

                if (value1 === "" && value2 === "") {
                    continue;
                }

                if (value1 === "" && value2 !== "") {
                    errorText = locConstants.objectExplorerFiltering.firstValueEmptyError(
                        getFilterOperatorString(filter.selectedOperator),
                        filter.name,
                    );
                    break;
                }

                if (value2 === "" && value1 !== "") {
                    errorText = locConstants.objectExplorerFiltering.secondValueEmptyError(
                        getFilterOperatorString(filter.selectedOperator),
                        filter.name,
                    );
                    break;
                }

                if (value1 > value2) {
                    errorText = locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                        getFilterOperatorString(filter.selectedOperator),
                        filter.name,
                    );
                    break;
                }

                filters.push({
                    name: filter.name,
                    value: [value1, value2],
                    operator: filter.selectedOperator,
                });
                continue;
            }

            let value: string | undefined;
            switch (filter.type) {
                case NodeFilterPropertyDataType.Boolean:
                case NodeFilterPropertyDataType.Choice:
                    if (filter.value === "" || filter.value === undefined) {
                        value = undefined;
                    } else {
                        value =
                            filter.choices?.find((c) => c.displayName === filter.value)?.name ??
                            undefined;
                    }
                    break;
                case NodeFilterPropertyDataType.String:
                case NodeFilterPropertyDataType.Date:
                    value = filter.value as string;
                    break;
                default:
                    value = undefined;
                    break;
            }

            if (value === "" || value === undefined) {
                continue;
            }

            filters.push({
                name: filter.name,
                value,
                operator: filter.selectedOperator,
            });
        }

        if (errorText) {
            setErrorMessage(errorText);
            return;
        }

        context.submit(filters);
    };

    return (
        <DialogPageShell
            icon={<FilterFunnelIcon16Regular />}
            title={locConstants.objectExplorerFiltering.filterSettings}
            subtitle={breadcrumb}
            errorMessage={errorMessage}
            maxContentWidth="medium"
            footerStart={
                <Button appearance="secondary" onClick={clearAllFilters}>
                    {locConstants.objectExplorerFiltering.clearAll}
                </Button>
            }
            footerEnd={
                <>
                    <Button appearance="secondary" onClick={() => context.cancel()}>
                        {locConstants.common.close}
                    </Button>
                    <Button appearance="primary" onClick={submitFilters}>
                        {locConstants.objectExplorerFiltering.ok}
                    </Button>
                </>
            }>
            <ObjectExplorerFilterContent
                uiFilters={uiFilters}
                setUiFilters={setUiFilters}
                getFilterOperatorString={getFilterOperatorString}
            />
        </DialogPageShell>
    );
};
