/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dropdown,
    Input,
    makeStyles,
    mergeClasses,
    Option,
    Text,
    tokens,
    Tooltip,
    useArrowNavigationGroup,
} from "@fluentui/react-components";
import { EraserRegular } from "@fluentui/react-icons";
import {
    NodeFilterOperator,
    NodeFilterPropertyDataType,
    ObjectExplorerPageFilter,
} from "../../../sharedInterfaces/objectExplorerFilter";
import { locConstants } from "../../common/locConstants";

const filterGridColumns = "minmax(130px, 0.75fr) minmax(150px, 0.85fr) minmax(260px, 1.8fr) 32px";

const useStyles = makeStyles({
    root: {
        width: "100%",
        minWidth: 0,
        overflowX: "auto",
    },
    grid: {
        minWidth: "620px",
    },
    headerRow: {
        display: "grid",
        gridTemplateColumns: filterGridColumns,
        columnGap: tokens.spacingHorizontalM,
        alignItems: "end",
        marginBottom: tokens.spacingVerticalXS,
    },
    headerCell: {
        minWidth: 0,
        paddingBottom: tokens.spacingVerticalS,
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    row: {
        display: "grid",
        gridTemplateColumns: filterGridColumns,
        columnGap: tokens.spacingHorizontalM,
        alignItems: "center",
        minHeight: "44px",
    },
    cell: {
        display: "flex",
        alignItems: "center",
        minWidth: 0,
    },
    control: {
        width: "100%",
        minWidth: 0,
        height: "32px",
        minHeight: "32px",
        maxHeight: "32px",
        boxSizing: "border-box",
    },
    activeControl: {
        boxShadow: "inset 0 0 0 1px var(--vscode-focusBorder)",
    },
    rangeControls: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        width: "100%",
        minWidth: 0,
    },
    rangeSeparator: {
        color: "var(--vscode-descriptionForeground)",
    },
    clearCell: {
        justifyContent: "center",
    },
    clearButton: {
        width: "32px",
        minWidth: "32px",
        height: "32px",
        minHeight: "32px",
    },
});

export interface ObjectExplorerFilterContentProps {
    uiFilters: ObjectExplorerPageFilter[];
    setUiFilters: (filters: ObjectExplorerPageFilter[]) => void;
    getFilterOperatorString: (operator: NodeFilterOperator | undefined) => string;
    primaryFilterIndex: number;
    setPrimaryFilterElement: (element: HTMLElement | null) => void;
}

export const ObjectExplorerFilterContent = ({
    uiFilters,
    setUiFilters,
    getFilterOperatorString,
    primaryFilterIndex,
    setPrimaryFilterElement,
}: ObjectExplorerFilterContentProps) => {
    const classes = useStyles();
    const keyboardNavAttr = useArrowNavigationGroup({ axis: "grid" });
    const andText = locConstants.objectExplorerFiltering.and;

    const hasFilterValue = (item: ObjectExplorerPageFilter): boolean => {
        const values = Array.isArray(item.value) ? item.value : [item.value];
        return values.some((value) => value !== undefined && String(value).trim().length > 0);
    };

    const updateOperator = (item: ObjectExplorerPageFilter, optionValue?: string) => {
        if (optionValue === undefined) {
            return;
        }

        const selectedValue = Number(optionValue);
        if (Number.isNaN(selectedValue)) {
            return;
        }

        uiFilters[item.index].selectedOperator = selectedValue as NodeFilterOperator;
        if (
            uiFilters[item.index].selectedOperator === NodeFilterOperator.Between ||
            uiFilters[item.index].selectedOperator === NodeFilterOperator.NotBetween
        ) {
            if (!Array.isArray(uiFilters[item.index].value)) {
                uiFilters[item.index].value = [uiFilters[item.index].value as string, ""];
            }
        } else if (Array.isArray(uiFilters[item.index].value)) {
            uiFilters[item.index].value = (uiFilters[item.index].value as string[])[0];
        }
        setUiFilters([...uiFilters]);
    };

    const renderValueControl = (item: ObjectExplorerPageFilter) => {
        switch (item.type) {
            case NodeFilterPropertyDataType.Date:
            case NodeFilterPropertyDataType.Number:
            case NodeFilterPropertyDataType.String: {
                let inputType: "text" | "number" | "date" = "text";
                if (item.type === NodeFilterPropertyDataType.Date) {
                    inputType = "date";
                } else if (item.type === NodeFilterPropertyDataType.Number) {
                    inputType = "number";
                }

                if (
                    item.selectedOperator === NodeFilterOperator.Between ||
                    item.selectedOperator === NodeFilterOperator.NotBetween
                ) {
                    return (
                        <div className={classes.rangeControls}>
                            <Input
                                id={`input-${item.index}`}
                                ref={
                                    item.index === primaryFilterIndex
                                        ? setPrimaryFilterElement
                                        : undefined
                                }
                                type={inputType}
                                className={mergeClasses(
                                    classes.control,
                                    hasFilterValue(item) && classes.activeControl,
                                )}
                                aria-label={locConstants.objectExplorerFiltering.filterValueLabel(
                                    item.displayName,
                                )}
                                value={(item.value as string[])[0]}
                                onChange={(_event, data) => {
                                    (uiFilters[item.index].value as string[])[0] = data.value;
                                    setUiFilters([...uiFilters]);
                                }}
                            />
                            <Text className={classes.rangeSeparator} size={200}>
                                {andText}
                            </Text>
                            <Input
                                type={inputType}
                                className={mergeClasses(
                                    classes.control,
                                    hasFilterValue(item) && classes.activeControl,
                                )}
                                aria-label={locConstants.objectExplorerFiltering.secondFilterValueLabel(
                                    item.displayName,
                                )}
                                value={(item.value as string[])[1]}
                                onChange={(_event, data) => {
                                    (uiFilters[item.index].value as string[])[1] = data.value;
                                    setUiFilters([...uiFilters]);
                                }}
                            />
                        </div>
                    );
                }

                return (
                    <Input
                        id={`input-${item.index}`}
                        ref={
                            item.index === primaryFilterIndex ? setPrimaryFilterElement : undefined
                        }
                        type={inputType}
                        className={mergeClasses(
                            classes.control,
                            hasFilterValue(item) && classes.activeControl,
                        )}
                        placeholder={
                            item.type === NodeFilterPropertyDataType.String
                                ? locConstants.objectExplorerFiltering.filterByProperty(
                                      item.displayName.toLocaleLowerCase(),
                                  )
                                : undefined
                        }
                        aria-label={locConstants.objectExplorerFiltering.filterValueLabel(
                            item.displayName,
                        )}
                        value={item.value as string}
                        onChange={(_event, data) => {
                            uiFilters[item.index].value = data.value;
                            setUiFilters([...uiFilters]);
                        }}
                    />
                );
            }
            case NodeFilterPropertyDataType.Choice:
            case NodeFilterPropertyDataType.Boolean:
                return (
                    <Dropdown
                        id={`input-${item.index}`}
                        ref={
                            item.index === primaryFilterIndex ? setPrimaryFilterElement : undefined
                        }
                        className={mergeClasses(
                            classes.control,
                            hasFilterValue(item) && classes.activeControl,
                        )}
                        aria-label={locConstants.objectExplorerFiltering.filterValueLabel(
                            item.displayName,
                        )}
                        value={
                            item.choices?.find((choice) => choice.name === item.value)
                                ?.displayName ?? ""
                        }
                        selectedOptions={item.value ? [item.value as string] : []}
                        onOptionSelect={(_event, data) => {
                            uiFilters[item.index].value = data.optionValue ?? "";
                            setUiFilters([...uiFilters]);
                        }}>
                        {item.choices!.map((choice) => (
                            <Option key={choice.name} value={choice.name}>
                                {choice.displayName}
                            </Option>
                        ))}
                    </Dropdown>
                );
            default:
                return undefined;
        }
    };

    const clearFilter = (item: ObjectExplorerPageFilter) => {
        if (
            item.selectedOperator === NodeFilterOperator.Between ||
            item.selectedOperator === NodeFilterOperator.NotBetween
        ) {
            uiFilters[item.index].value = ["", ""];
        } else {
            uiFilters[item.index].value = "";
        }
        setUiFilters([...uiFilters]);
    };

    return (
        <div className={classes.root}>
            <div
                {...keyboardNavAttr}
                className={classes.grid}
                role="grid"
                aria-rowcount={uiFilters.length + 1}
                aria-colcount={4}>
                <div role="rowgroup">
                    <div className={classes.headerRow} role="row">
                        <div className={classes.headerCell} role="columnheader">
                            {locConstants.objectExplorerFiltering.property}
                        </div>
                        <div className={classes.headerCell} role="columnheader">
                            {locConstants.objectExplorerFiltering.operator}
                        </div>
                        <div className={classes.headerCell} role="columnheader">
                            {locConstants.objectExplorerFiltering.value}
                        </div>
                        <div
                            className={classes.headerCell}
                            role="columnheader"
                            aria-label={locConstants.objectExplorerFiltering.clear}
                        />
                    </div>
                </div>
                <div role="rowgroup">
                    {uiFilters.map((item) => (
                        <div className={classes.row} role="row" key={item.name}>
                            <div className={classes.cell} role="cell">
                                <Text>{item.displayName}</Text>
                            </div>
                            <div className={classes.cell} role="cell">
                                <Dropdown
                                    id={`operator-${item.index}`}
                                    className={classes.control}
                                    aria-label={locConstants.objectExplorerFiltering.filterOperatorLabel(
                                        item.displayName,
                                    )}
                                    value={getFilterOperatorString(item.selectedOperator)}
                                    selectedOptions={[item.selectedOperator.toString()]}
                                    onOptionSelect={(_event, data) =>
                                        updateOperator(item, data.optionValue)
                                    }>
                                    {item.operatorOptions.map((option) => (
                                        <Option key={option} value={option.toString()}>
                                            {getFilterOperatorString(option)}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </div>
                            <div className={classes.cell} role="cell">
                                {renderValueControl(item)}
                            </div>
                            <div
                                className={mergeClasses(classes.cell, classes.clearCell)}
                                role="cell">
                                <Tooltip
                                    content={locConstants.objectExplorerFiltering.clearPropertyFilter(
                                        item.displayName,
                                    )}
                                    relationship="label">
                                    <Button
                                        type="button"
                                        appearance="subtle"
                                        className={classes.clearButton}
                                        icon={<EraserRegular />}
                                        disabled={!hasFilterValue(item)}
                                        aria-label={locConstants.objectExplorerFiltering.clearPropertyFilter(
                                            item.displayName,
                                        )}
                                        onClick={() => clearFilter(item)}
                                    />
                                </Tooltip>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
