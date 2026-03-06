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
            if (
                filters.selectedOperator === NodeFilterOperator.Between ||
                filters.selectedOperator === NodeFilterOperator.NotBetween
            ) {
                filters.value = ["", ""];
            } else {
                filters.value = "";
            }
        }
        setUiFilters([...uiFilters]);
    };

    const submitFilters = () => {
        const filters: vscodeMssql.NodeFilter[] = uiFilters
            .map((f) => {
                let value = undefined;
                switch (f.type) {
                    case NodeFilterPropertyDataType.Boolean:
                        if (f.value === "" || f.value === undefined) {
                            value = undefined;
                        } else {
                            value =
                                f.choices?.find((c) => c.displayName === f.value)?.name ??
                                undefined;
                        }
                        break;
                    case NodeFilterPropertyDataType.Number:
                        if (
                            f.selectedOperator === NodeFilterOperator.Between ||
                            f.selectedOperator === NodeFilterOperator.NotBetween
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
                    case NodeFilterPropertyDataType.Choice:
                        if (f.value === "" || f.value === undefined) {
                            value = undefined;
                        } else {
                            value =
                                f.choices?.find((c) => c.displayName === f.value)?.name ??
                                undefined;
                        }
                        break;
                }
                return {
                    name: f.name,
                    value: value!,
                    operator: f.selectedOperator,
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

        let errorText = "";
        for (const filter of filters) {
            if (
                filter.operator === NodeFilterOperator.Between ||
                filter.operator === NodeFilterOperator.NotBetween
            ) {
                const value1 = (filter.value as string[] | number[])[0];
                const value2 = (filter.value as string[] | number[])[1];
                if (!value1 && value2) {
                    errorText = locConstants.objectExplorerFiltering.firstValueEmptyError(
                        getFilterOperatorString(filter.operator),
                        filter.name,
                    );
                } else if (!value2 && value1) {
                    errorText = locConstants.objectExplorerFiltering.secondValueEmptyError(
                        getFilterOperatorString(filter.operator),
                        filter.name,
                    );
                } else if (value1 > value2) {
                    errorText = locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                        getFilterOperatorString(filter.operator),
                        filter.name,
                    );
                }
            }
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
            title="Filter Settings"
            subtitle={breadcrumb}
            errorMessage={errorMessage}
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
