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
    NodeFilterPropertyDataType,
    ObjectExplorerPageFilter,
    ObjectExplorerFilterUtils,
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
    const BETWEEN = locConstants.objectExplorerFiltering.between;
    const NOT_BETWEEN = locConstants.objectExplorerFiltering.notBetween;

    // Initialize the static values
    ObjectExplorerFilterUtils.initializeStrings(locConstants.objectExplorerFiltering);

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
                        operatorOptions: ObjectExplorerFilterUtils.getFilterOperators(value),
                        selectedOperator:
                            filter === undefined
                                ? ObjectExplorerFilterUtils.getFilterOperators(value)[0]
                                : (ObjectExplorerFilterUtils.getFilterOperatorString(
                                      filter?.operator,
                                  ) ?? ""),
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
                        const filters: vscodeMssql.NodeFilter[] =
                            ObjectExplorerFilterUtils.getFilters(uiFilters);
                        const errorText = ObjectExplorerFilterUtils.getErrorTextFromFilters(
                            filters,
                            locConstants.objectExplorerFiltering.firstValueEmptyError,
                            locConstants.objectExplorerFiltering.secondValueEmptyError,
                            locConstants.objectExplorerFiltering.firstValueLessThanSecondError,
                        );
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
