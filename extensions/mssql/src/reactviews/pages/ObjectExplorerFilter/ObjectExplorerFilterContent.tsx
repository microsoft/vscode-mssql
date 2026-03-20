/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    createTableColumn,
    Dropdown,
    InfoLabel,
    Input,
    makeStyles,
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
    useArrowNavigationGroup,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { EraserRegular } from "@fluentui/react-icons";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
    ObjectExplorerPageFilter,
} from "../../../sharedInterfaces/objectExplorerFilter";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
        maxWidth: "760px",
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

const columnsDef: TableColumnDefinition<ObjectExplorerPageFilter>[] = [
    createTableColumn({
        columnId: "property",
        renderHeaderCell: () => <>{locConstants.objectExplorerFiltering.property}</>,
    }),
    createTableColumn({
        columnId: "operator",
        renderHeaderCell: () => <>{locConstants.objectExplorerFiltering.operator}</>,
    }),
    createTableColumn({
        columnId: "value",
        renderHeaderCell: () => <>{locConstants.objectExplorerFiltering.value}</>,
    }),
    createTableColumn({
        columnId: "clear",
        renderHeaderCell: () => <>{locConstants.objectExplorerFiltering.clear}</>,
    }),
];

const sizingOptions: TableColumnSizingOptions = {
    property: {
        minWidth: 150,
        idealWidth: 180,
        defaultWidth: 220,
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
        minWidth: 56,
        idealWidth: 56,
        defaultWidth: 56,
    },
};

export interface ObjectExplorerFilterContentProps {
    uiFilters: ObjectExplorerPageFilter[];
    setUiFilters: (filters: ObjectExplorerPageFilter[]) => void;
    getFilterOperatorString: (operator: NodeFilterOperator | undefined) => string;
}

export const ObjectExplorerFilterContent = ({
    uiFilters,
    setUiFilters,
    getFilterOperatorString,
}: ObjectExplorerFilterContentProps) => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
    const andText = locConstants.objectExplorerFiltering.and;

    const renderCell = (columnId: TableColumnId, item: ObjectExplorerPageFilter) => {
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
                            value={getFilterOperatorString(item.selectedOperator)}
                            selectedOptions={[item.selectedOperator.toString()]}
                            onOptionSelect={(_e, d) => {
                                if (d.optionValue === undefined) {
                                    return;
                                }
                                const selectedValue = Number(d.optionValue);
                                if (Number.isNaN(selectedValue)) {
                                    return;
                                }
                                uiFilters[item.index].selectedOperator =
                                    selectedValue as NodeFilterOperator;
                                if (
                                    uiFilters[item.index].selectedOperator ===
                                        NodeFilterOperator.Between ||
                                    uiFilters[item.index].selectedOperator ===
                                        NodeFilterOperator.NotBetween
                                ) {
                                    if (!Array.isArray(uiFilters[item.index].value)) {
                                        uiFilters[item.index].value = [
                                            uiFilters[item.index].value as string,
                                            "",
                                        ];
                                    }
                                } else if (Array.isArray(uiFilters[item.index].value)) {
                                    uiFilters[item.index].value = (
                                        uiFilters[item.index].value as string[]
                                    )[0];
                                }
                                setUiFilters([...uiFilters]);
                            }}>
                            {item.operatorOptions.map((option) => {
                                return (
                                    <Option key={option} value={option.toString()}>
                                        {getFilterOperatorString(option)}
                                    </Option>
                                );
                            })}
                        </Dropdown>
                        {(item.selectedOperator === NodeFilterOperator.Between ||
                            item.selectedOperator === NodeFilterOperator.NotBetween) && (
                            <Text className={classes.andOrText} size={200}>
                                {andText}
                            </Text>
                        )}
                    </div>
                );
            case "value":
                switch (item.type) {
                    case NodeFilterPropertyDataType.Date:
                    case NodeFilterPropertyDataType.Number:
                    case NodeFilterPropertyDataType.String: {
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
                            item.selectedOperator === NodeFilterOperator.Between ||
                            item.selectedOperator === NodeFilterOperator.NotBetween
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
                        }

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
                    <Tooltip
                        content={locConstants.objectExplorerFiltering.clear}
                        relationship="label">
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<EraserRegular />}
                            onClick={() => {
                                if (
                                    uiFilters[item.index].selectedOperator ===
                                        NodeFilterOperator.Between ||
                                    uiFilters[item.index].selectedOperator ===
                                        NodeFilterOperator.NotBetween
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
    };

    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures<ObjectExplorerPageFilter>(
        {
            columns: columnsDef,
            items: uiFilters,
        },
        [useTableColumnSizing_unstable({ columnSizingOptions: sizingOptions })],
    );
    const rows = getRows();

    return (
        <div className={classes.root}>
            <Table
                {...keyboardNavAttr}
                as="table"
                size="small"
                {...columnSizing_unstable.getTableProps()}
                ref={tableRef}>
                <TableHeader>
                    <TableRow>
                        {columnsDef.map((column) => {
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
        </div>
    );
};
