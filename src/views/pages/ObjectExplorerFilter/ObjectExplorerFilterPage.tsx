/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1Strong,
    Button,
    createTableColumn,
    Dropdown,
    InfoLabel,
    Input,
    makeStyles,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Option,
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
    Tooltip,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { useContext, useEffect, useState } from "react";
import { ObjectExplorerFilterContext } from "./ObjectExplorerFilterStateProvider";
import * as vscodeMssql from "vscode-mssql";
import { EraserRegular } from "@fluentui/react-icons";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
    ObjectExplorerPageFilter,
} from "../../../sharedInterfaces/objectExplorerFilter";
import * as l10n from "@vscode/l10n";
import { locConstants } from "../../common/locConstants";

export const useStyles = makeStyles({
    root: {
        flexDirection: "column",
        display: "flex",
        paddingTop: "10px",
        paddingLeft: "10px",
        "> *": {
            marginTop: "5px",
            marginBottom: "5px",
        },
    },
    inputs: {
        maxWidth: "150px",
        minWidth: "150px",
        width: "150px",
    },
    tableCell: {
        display: "flex",
        flexDirection: "column",
        "> *": {
            marginTop: "5px",
            marginBottom: "5px",
        },
    },
    operatorOptions: {
        maxWidth: "150px",
        minWidth: "150px",
        width: "150px",
    },
    andOrText: {
        marginLeft: "10px",
    },
});

export const ObjectExplorerFilterPage = () => {
    const classes = useStyles();
    const provider = useContext(ObjectExplorerFilterContext);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [uiFilters, setUiFilters] = useState<ObjectExplorerPageFilter[]>([]);

    const AND = locConstants.objectExplorerFiltering.and;
    const CONTAINS = locConstants.objectExplorerFiltering.contains;
    const NOT_CONTAINS = locConstants.objectExplorerFiltering.notContains;
    const STARTS_WITH = locConstants.objectExplorerFiltering.startsWith;
    const NOT_STARTS_WITH = locConstants.objectExplorerFiltering.notStartsWith;
    const ENDS_WITH = locConstants.objectExplorerFiltering.endsWith;
    const NOT_ENDS_WITH = locConstants.objectExplorerFiltering.notEndsWith;
    const EQUALS = locConstants.objectExplorerFiltering.equals;
    const NOT_EQUALS = locConstants.objectExplorerFiltering.notEquals;
    const LESS_THAN = locConstants.objectExplorerFiltering.lessThan;
    const LESS_THAN_OR_EQUALS = locConstants.objectExplorerFiltering.lessThanOrEquals;
    const GREATER_THAN = locConstants.objectExplorerFiltering.greaterThan;
    const GREATER_THAN_OR_EQUALS = locConstants.objectExplorerFiltering.greaterThanOrEquals;
    const BETWEEN = locConstants.objectExplorerFiltering.between;
    const NOT_BETWEEN = locConstants.objectExplorerFiltering.notBetween;

    function getFilterOperatorString(operator: NodeFilterOperator | undefined): string | undefined {
        if (operator === undefined) {
            return undefined;
        }
        switch (operator) {
            case NodeFilterOperator.Contains:
                return CONTAINS;
            case NodeFilterOperator.NotContains:
                return NOT_CONTAINS;
            case NodeFilterOperator.StartsWith:
                return STARTS_WITH;
            case NodeFilterOperator.NotStartsWith:
                return NOT_STARTS_WITH;
            case NodeFilterOperator.EndsWith:
                return ENDS_WITH;
            case NodeFilterOperator.NotEndsWith:
                return NOT_ENDS_WITH;
            case NodeFilterOperator.Equals:
                return EQUALS;
            case NodeFilterOperator.NotEquals:
                return NOT_EQUALS;
            case NodeFilterOperator.LessThan:
                return LESS_THAN;
            case NodeFilterOperator.LessThanOrEquals:
                return LESS_THAN_OR_EQUALS;
            case NodeFilterOperator.GreaterThan:
                return GREATER_THAN;
            case NodeFilterOperator.GreaterThanOrEquals:
                return GREATER_THAN_OR_EQUALS;
            case NodeFilterOperator.Between:
                return BETWEEN;
            case NodeFilterOperator.NotBetween:
                return NOT_BETWEEN;
            default:
                return "";
        }
    }

    function getFilterOperatorEnum(operator: string): NodeFilterOperator {
        switch (operator) {
            case CONTAINS:
                return NodeFilterOperator.Contains;
            case NOT_CONTAINS:
                return NodeFilterOperator.NotContains;
            case STARTS_WITH:
                return NodeFilterOperator.StartsWith;
            case NOT_STARTS_WITH:
                return NodeFilterOperator.NotStartsWith;
            case ENDS_WITH:
                return NodeFilterOperator.EndsWith;
            case NOT_ENDS_WITH:
                return NodeFilterOperator.NotEndsWith;
            case EQUALS:
                return NodeFilterOperator.Equals;
            case NOT_EQUALS:
                return NodeFilterOperator.NotEquals;
            case LESS_THAN:
                return NodeFilterOperator.LessThan;
            case LESS_THAN_OR_EQUALS:
                return NodeFilterOperator.LessThanOrEquals;
            case GREATER_THAN:
                return NodeFilterOperator.GreaterThan;
            case GREATER_THAN_OR_EQUALS:
                return NodeFilterOperator.GreaterThanOrEquals;
            case BETWEEN:
                return NodeFilterOperator.Between;
            case NOT_BETWEEN:
                return NodeFilterOperator.NotBetween;
            default:
                return NodeFilterOperator.Equals;
        }
    }

    function getFilterOperators(property: vscodeMssql.NodeFilterProperty): string[] {
        switch (property.type) {
            case NodeFilterPropertyDataType.Boolean:
                return [EQUALS, NOT_EQUALS];
            case NodeFilterPropertyDataType.String:
                return [
                    CONTAINS,
                    NOT_CONTAINS,
                    STARTS_WITH,
                    NOT_STARTS_WITH,
                    ENDS_WITH,
                    NOT_ENDS_WITH,
                    EQUALS,
                    NOT_EQUALS,
                ];
            case NodeFilterPropertyDataType.Number:
                return [
                    EQUALS,
                    NOT_EQUALS,
                    LESS_THAN,
                    LESS_THAN_OR_EQUALS,
                    GREATER_THAN,
                    GREATER_THAN_OR_EQUALS,
                    BETWEEN,
                    NOT_BETWEEN,
                ];
            case NodeFilterPropertyDataType.Date:
                return [
                    EQUALS,
                    NOT_EQUALS,
                    LESS_THAN,
                    LESS_THAN_OR_EQUALS,
                    GREATER_THAN,
                    GREATER_THAN_OR_EQUALS,
                    BETWEEN,
                    NOT_BETWEEN,
                ];
            case NodeFilterPropertyDataType.Choice:
                return [EQUALS, NOT_EQUALS];
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
                provider?.state?.filterProperties?.map((value, index) => {
                    const filter = provider?.state?.existingFilters?.find(
                        (f) => f.name === value.name,
                    );
                    return {
                        index: index,
                        name: value.name,
                        displayName: value.displayName,
                        value: filter?.value ?? "",
                        type: value.type,
                        choices: getFilterChoices(value) ?? [],
                        operatorOptions: getFilterOperators(value),
                        selectedOperator:
                            filter === undefined
                                ? getFilterOperators(value)[0]
                                : (getFilterOperatorString(filter?.operator) ?? ""),
                        description: value.description,
                    };
                }) ?? [],
            );
        };

        setIntialFocus();
        loadUiFilters();
        setErrorMessage(undefined);
    }, [provider?.state?.filterProperties]);

    function renderCell(columnId: TableColumnId, item: ObjectExplorerPageFilter) {
        switch (columnId) {
            case "property":
                return (
                    <InfoLabel size="small" info={<>{item.description}</>}>
                        {item.displayName}
                    </InfoLabel>
                );
            case "operator":
                return (
                    <div className={classes.tableCell}>
                        <Dropdown
                            id={`operator-${item.index}`}
                            className={classes.operatorOptions}
                            size="small"
                            value={item.selectedOperator ?? ""}
                            selectedOptions={[item.selectedOperator]}
                            onOptionSelect={(_e, d) => {
                                uiFilters[item.index].selectedOperator = d.optionValue!;
                                // Check if the value is an array and set it to an empty array if it is
                                if (d.optionValue === BETWEEN || d.optionValue === NOT_BETWEEN) {
                                    if (!Array.isArray(uiFilters[item.index].value)) {
                                        uiFilters[item.index].value = [
                                            uiFilters[item.index].value as string,
                                            "",
                                        ];
                                    }
                                } else {
                                    if (Array.isArray(uiFilters[item.index].value)) {
                                        uiFilters[item.index].value = (
                                            uiFilters[item.index].value as string[]
                                        )[0];
                                    }
                                }
                                setUiFilters([...uiFilters]);
                            }}>
                            {item.operatorOptions.map((option) => {
                                return (
                                    <Option key={option} value={option}>
                                        {option}
                                    </Option>
                                );
                            })}
                        </Dropdown>
                        {item.selectedOperator === BETWEEN ||
                            (item.selectedOperator === NOT_BETWEEN && (
                                <Text className={classes.andOrText} size={200}>
                                    {AND}
                                </Text>
                            ))}
                    </div>
                );
            case "value":
                switch (item.type) {
                    case NodeFilterPropertyDataType.Date:
                    case NodeFilterPropertyDataType.Number:
                    case NodeFilterPropertyDataType.String:
                        let inputType: "text" | "number" | "date" = "text";
                        switch (item.type) {
                            case NodeFilterPropertyDataType.Date:
                                inputType = "date";
                                break;
                            case NodeFilterPropertyDataType.Number:
                                inputType = "number";
                                break;
                            case NodeFilterPropertyDataType.String:
                                inputType = "text";
                                break;
                        }
                        if (
                            item.selectedOperator === BETWEEN ||
                            item.selectedOperator === NOT_BETWEEN
                        ) {
                            return (
                                <div className={classes.tableCell}>
                                    <Input
                                        id={`input-${item.index}`}
                                        size="small"
                                        type={inputType}
                                        className={classes.inputs}
                                        value={(item.value as string[])[0]}
                                        onChange={(_e, d) => {
                                            (uiFilters[item.index].value as string[])[0] = d.value;
                                            setUiFilters([...uiFilters]);
                                        }}
                                    />
                                    <Input
                                        size="small"
                                        type={inputType}
                                        className={classes.inputs}
                                        value={(item.value as string[])[1]}
                                        onChange={(_e, d) => {
                                            (uiFilters[item.index].value as string[])[1] = d.value;
                                            setUiFilters([...uiFilters]);
                                        }}
                                    />
                                </div>
                            );
                        } else {
                            return (
                                <Input
                                    id={`input-${item.index}`}
                                    size="small"
                                    type={inputType}
                                    className={classes.inputs}
                                    value={item.value as string}
                                    onChange={(_e, d) => {
                                        uiFilters[item.index].value = d.value;
                                        setUiFilters([...uiFilters]);
                                    }}
                                />
                            );
                        }
                    case NodeFilterPropertyDataType.Choice:
                    case NodeFilterPropertyDataType.Boolean:
                        return (
                            <Dropdown
                                size="small"
                                id={`input-${item.index}`}
                                className={classes.inputs}
                                value={item.value as string}
                                onOptionSelect={(_e, d) => {
                                    uiFilters[item.index].value = d.optionText ?? "";
                                    setUiFilters([...uiFilters]);
                                }}>
                                {item.choices!.map((choice) => {
                                    return (
                                        <Option key={choice.name} value={choice.name}>
                                            {choice.displayName}
                                        </Option>
                                    );
                                })}
                            </Dropdown>
                        );
                    default:
                        return undefined;
                }
            case "clear":
                return (
                    <Tooltip content="Clear" relationship="label">
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<EraserRegular />}
                            onClick={() => {
                                if (
                                    uiFilters[item.index].selectedOperator === BETWEEN ||
                                    uiFilters[item.index].selectedOperator === NOT_BETWEEN
                                ) {
                                    uiFilters[item.index].value = ["", ""];
                                } else {
                                    uiFilters[item.index].value = "";
                                }
                                setUiFilters([...uiFilters]);
                            }}
                        />
                    </Tooltip>
                );
        }
    }

    const columnsDef: TableColumnDefinition<ObjectExplorerPageFilter>[] = [
        createTableColumn({
            columnId: "property",
            renderHeaderCell: () => {
                return <>{locConstants.objectExplorerFiltering.property}</>;
            },
        }),
        createTableColumn({
            columnId: "operator",
            renderHeaderCell: () => {
                return <>{locConstants.objectExplorerFiltering.operator}</>;
            },
        }),
        createTableColumn({
            columnId: "value",
            renderHeaderCell: () => {
                return <>{locConstants.objectExplorerFiltering.value}</>;
            },
        }),
        createTableColumn({
            columnId: "clear",
            renderHeaderCell: () => {
                return <>{locConstants.objectExplorerFiltering.clear}</>;
            },
        }),
    ];

    const [columns] = useState<TableColumnDefinition<ObjectExplorerPageFilter>[]>(columnsDef);

    const sizingOptions: TableColumnSizingOptions = {
        property: {
            minWidth: 150,
            idealWidth: 200,
            defaultWidth: 300,
        },
        operator: {
            minWidth: 140,
            idealWidth: 140,
            defaultWidth: 140,
        },
        value: {
            minWidth: 150,
            idealWidth: 150,
            defaultWidth: 150,
        },
        clear: {
            minWidth: 20,
            idealWidth: 20,
            defaultWidth: 20,
        },
    };

    const [columnSizingOptions] = useState<TableColumnSizingOptions>(sizingOptions);
    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures<ObjectExplorerPageFilter>(
        {
            columns: columns,
            items: uiFilters,
        },
        [useTableColumnSizing_unstable({ columnSizingOptions })],
    );
    const rows = getRows();
    if (!provider) {
        return undefined;
    }
    return (
        <div className={classes.root}>
            <Text size={400}>{l10n.t("Filter Settings")}</Text>
            <Body1Strong>
                {locConstants.objectExplorerFiltering.path(provider?.state?.nodePath!)}
            </Body1Strong>
            {errorMessage && errorMessage !== "" && (
                <MessageBar intent={"error"}>
                    <MessageBarBody>
                        <MessageBarTitle>
                            {locConstants.objectExplorerFiltering.error}
                        </MessageBarTitle>
                        {errorMessage}
                    </MessageBarBody>
                </MessageBar>
            )}
            <Table
                as="table"
                size="small"
                {...columnSizing_unstable.getTableProps()}
                ref={tableRef}>
                <TableHeader>
                    <TableRow>
                        {columns.map((column) => {
                            return (
                                <TableHeaderCell
                                    key={column.columnId}
                                    {...columnSizing_unstable.getTableHeaderCellProps(
                                        column.columnId,
                                    )}>
                                    {column.renderHeaderCell()}
                                </TableHeaderCell>
                            );
                        })}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((_row, index) => {
                        return (
                            <TableRow key={`row${index}`}>
                                {columnsDef.map((column) => {
                                    return (
                                        <TableCell
                                            key={column.columnId}
                                            {...columnSizing_unstable.getTableHeaderCellProps(
                                                column.columnId,
                                            )}>
                                            {renderCell(column.columnId, uiFilters[index])}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: "10px",
                    maxWidth: "300px",
                }}>
                <Button
                    appearance="secondary"
                    onClick={() => {
                        for (let filters of uiFilters) {
                            if (
                                filters.selectedOperator === BETWEEN ||
                                filters.selectedOperator === NOT_BETWEEN
                            ) {
                                filters.value = ["", ""];
                            } else {
                                filters.value = "";
                            }
                        }
                        setUiFilters([...uiFilters]);
                    }}>
                    {locConstants.objectExplorerFiltering.clearAll}
                </Button>
                <Button
                    appearance="secondary"
                    onClick={() => {
                        provider.cancel();
                    }}>
                    {locConstants.common.close}
                </Button>
                <Button
                    appearance="primary"
                    onClick={() => {
                        const filters: vscodeMssql.NodeFilter[] = uiFilters
                            .map((f) => {
                                let value = undefined;
                                switch (f.type) {
                                    case NodeFilterPropertyDataType.Boolean:
                                        if (f.value === "" || f.value === undefined) {
                                            value = undefined;
                                        } else {
                                            value =
                                                f.choices?.find((c) => c.displayName === f.value)
                                                    ?.name ?? undefined;
                                        }
                                        break;
                                    case NodeFilterPropertyDataType.Number:
                                        if (
                                            f.selectedOperator === BETWEEN ||
                                            f.selectedOperator === NOT_BETWEEN
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
                                                f.choices?.find((c) => c.displayName === f.value)
                                                    ?.name ?? undefined;
                                        }
                                        break;
                                }
                                return {
                                    name: f.name,
                                    value: value!,
                                    operator: getFilterOperatorEnum(f.selectedOperator),
                                };
                            })
                            .filter((f) => {
                                if (
                                    f.operator === NodeFilterOperator.Between ||
                                    f.operator === NodeFilterOperator.NotBetween
                                ) {
                                    return (
                                        (f.value as string[])[0] !== "" ||
                                        (f.value as string[])[1] !== ""
                                    );
                                }
                                return f.value !== "" && f.value !== undefined;
                            });

                        let errorText = "";
                        for (let filter of filters) {
                            if (
                                filter.operator === NodeFilterOperator.Between ||
                                filter.operator === NodeFilterOperator.NotBetween
                            ) {
                                let value1 = (filter.value as string[] | number[])[0];
                                let value2 = (filter.value as string[] | number[])[1];
                                if (!value1 && value2) {
                                    errorText =
                                        locConstants.objectExplorerFiltering.firstValueEmptyError(
                                            getFilterOperatorString(filter.operator)!,
                                            filter.name,
                                        );
                                } else if (!value2 && value1) {
                                    errorText =
                                        locConstants.objectExplorerFiltering.secondValueEmptyError(
                                            getFilterOperatorString(filter.operator)!,
                                            filter.name,
                                        );
                                } else if (value1 > value2) {
                                    errorText =
                                        locConstants.objectExplorerFiltering.firstValueLessThanSecondError(
                                            getFilterOperatorString(filter.operator)!,
                                            filter.name,
                                        );
                                }
                            }
                        }
                        if (errorText) {
                            setErrorMessage(errorText);
                            return;
                        }
                        provider.submit(filters);
                    }}>
                    {locConstants.objectExplorerFiltering.ok}
                </Button>
            </div>
        </div>
    );
};
