/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import * as ep from "../../../sharedInterfaces/executionPlan";

import { Button, Combobox, Option, makeStyles, tokens } from "@fluentui/react-components";
import {
    Checkmark16Regular,
    Checkmark20Regular,
    Dismiss16Regular,
    Dismiss20Regular,
} from "@fluentui/react-icons";
import {
    ExecutionPlanGraphController,
    ExecutionPlanMetricSource,
} from "./executionPlanGraphController";
import { locConstants } from "../../common/locConstants";
import { useMemo, useState } from "react";
import {
    VscodeFloatingWidget,
    VscodeFloatingWidgetAction,
} from "../../common/vscodeFloatingWidget";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    inputContainer: {
        position: "absolute",
        top: 0,
        right: "35px",
        padding: "10px",
        border: "1px solid #ccc",
        zIndex: "1",
        boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.1)",
        display: "flex",
        alignItems: "center",
        gap: "2px",
        opacity: 1,
    },
    previewInputContainer: {
        position: "absolute",
        top: "4px",
        right: "39px",
        zIndex: 5,
        maxWidth: "calc(100% - 51px)",
    },
    previewLabel: {
        padding: "0 4px",
        color: "var(--vscode-editorWidget-foreground)",
        whiteSpace: "nowrap",
    },
    dropdown: {
        maxHeight: "200px",
    },
    spacer: {
        padding: "1px",
    },
});

interface HighlightExpensiveOperationsProps {
    executionPlanView: ExecutionPlanGraphController;
    setExecutionPlanView: any;
    setHighlightOpsClicked: any;
    inputRef: any;
    useReactFlow: boolean;
}

export const HighlightExpensiveOperations: React.FC<HighlightExpensiveOperationsProps> = ({
    executionPlanView,
    setExecutionPlanView,
    setHighlightOpsClicked,
    inputRef,
    useReactFlow,
}) => {
    const classes = useStyles();
    const [highlightMetricSelected, setHighlightMetricSelected] = useState("");
    const [highlightedElement, setHighlightedElement] = useState("");

    const highlightMetricOptions: string[] = useMemo(
        () => [
            locConstants.executionPlan.actualElapsedTime,
            locConstants.executionPlan.actualElapsedCpuTime,
            locConstants.executionPlan.cost,
            locConstants.executionPlan.subtreeCost,
            locConstants.executionPlan.actualNumberOfRowsForAllExecutions,
            locConstants.executionPlan.numberOfRowsRead,
            locConstants.executionPlan.off,
        ],
        [],
    );
    const highlightMetricOptionsEnum: ep.ExpensiveMetricType[] = useMemo(
        () => [
            ep.ExpensiveMetricType.ActualElapsedTime,
            ep.ExpensiveMetricType.ActualElapsedCpuTime,
            ep.ExpensiveMetricType.Cost,
            ep.ExpensiveMetricType.SubtreeCost,
            ep.ExpensiveMetricType.ActualNumberOfRowsForAllExecutions,
            ep.ExpensiveMetricType.NumberOfRowsRead,
            ep.ExpensiveMetricType.Off,
        ],
        [],
    );
    const searchableMetricOptions = useMemo(
        () => highlightMetricOptions.map((option) => ({ value: option, text: option })),
        [highlightMetricOptions],
    );
    const selectedMetricOption = useMemo(
        () => searchableMetricOptions.find((option) => option.value === highlightMetricSelected),
        [highlightMetricSelected, searchableMetricOptions],
    );

    const handleHighlightExpensiveOperation = async () => {
        if (executionPlanView) {
            const enumSelected =
                highlightMetricOptionsEnum[highlightMetricOptions.indexOf(highlightMetricSelected)];
            executionPlanView.clearExpensiveOperatorHighlighting();
            if (enumSelected === ep.ExpensiveMetricType.Off) {
                setHighlightedElement("");
                setExecutionPlanView(executionPlanView);
                return;
            }
            const expensiveOperationDelegate: (
                cell: ExecutionPlanMetricSource,
            ) => number | undefined = getExpensiveOperationDelegate(enumSelected);
            const elementId = executionPlanView.highlightExpensiveOperator(
                expensiveOperationDelegate,
            );
            if (elementId) {
                const element = executionPlanView.getElementById(
                    elementId,
                )! as ep.ExecutionPlanNode;
                executionPlanView.centerElement(element);
                setHighlightedElement(element.name);
            }
            setExecutionPlanView(executionPlanView);
        }
    };

    const handleHighlightClose = async () => {
        if (executionPlanView) {
            executionPlanView.clearExpensiveOperatorHighlighting();
            setExecutionPlanView(executionPlanView);
        }
        setHighlightOpsClicked(false);
    };

    const handleKeyDownOnAccept = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowLeft") {
            inputRef.current?.focus(); // Move focus to the combobox
        }
    };

    if (useReactFlow) {
        return (
            <VscodeFloatingWidget
                id="highlightExpensiveOpsContainer"
                className={classes.previewInputContainer}
                role="group"
                aria-label={locConstants.executionPlan.metric}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        void handleHighlightClose();
                    }
                }}>
                <span className={classes.previewLabel}>{locConstants.executionPlan.metric}</span>
                <SearchableDropdown
                    id="highlightExpensiveOpsDropdown"
                    size="small"
                    options={searchableMetricOptions}
                    selectedOption={selectedMetricOption}
                    showPlaceholder
                    placeholder={locConstants.executionPlan.metric}
                    searchBoxPlaceholder={locConstants.common.find}
                    style={{
                        width: "260px",
                        minWidth: "180px",
                        height: "26px",
                        boxSizing: "border-box",
                    }}
                    minPopupWidth={260}
                    onSelect={(option) => setHighlightMetricSelected(option.value)}
                    triggerRef={inputRef}
                    ariaLabel={locConstants.executionPlan.metric}
                />
                <VscodeFloatingWidgetAction
                    onClick={handleHighlightExpensiveOperation}
                    disabled={!highlightMetricSelected}
                    title={locConstants.common.apply}
                    aria-label={locConstants.common.apply}
                    icon={<Checkmark16Regular />}
                />
                <VscodeFloatingWidgetAction
                    icon={<Dismiss16Regular />}
                    title={locConstants.common.close}
                    aria-label={locConstants.common.close}
                    onClick={handleHighlightClose}
                />
            </VscodeFloatingWidget>
        );
    }

    return (
        <div
            id="highlightExpensiveOpsContainer"
            className={classes.inputContainer}
            style={{
                background: tokens.colorNeutralBackground1,
            }}
            aria-label={highlightedElement}>
            <div>{locConstants.executionPlan.metric}</div>
            <div style={{ paddingRight: "12px" }} />
            <Combobox
                id="highlightExpensiveOpsDropdown"
                size="small"
                input={{ style: { textOverflow: "ellipsis" } }}
                listbox={{ style: { minWidth: "fit-content" } }}
                onOptionSelect={(_, data) => setHighlightMetricSelected(data.optionText ?? "")}
                ref={inputRef}
                aria-label={locConstants.executionPlan.metric}>
                {highlightMetricOptions.map((option) => (
                    <Option key={option}>{option}</Option>
                ))}
            </Combobox>
            <div className={classes.spacer}></div>
            <Button
                onClick={handleHighlightExpensiveOperation}
                size="small"
                appearance="subtle"
                title={locConstants.common.apply}
                aria-label={locConstants.common.apply}
                icon={<Checkmark20Regular />}
                onKeyDown={handleKeyDownOnAccept}
            />
            <Button
                icon={<Dismiss20Regular />}
                size="small"
                appearance="subtle"
                title={locConstants.common.close}
                aria-label={locConstants.common.close}
                onClick={handleHighlightClose}
            />
        </div>
    );
};

function getExpensiveOperationDelegate(
    selectedExpensiveOperationType: ep.ExpensiveMetricType,
): (cell: ExecutionPlanMetricSource) => number | undefined {
    const getElapsedTimeInMs = (cell: ExecutionPlanMetricSource): number | undefined =>
        cell.elapsedTimeInMs;

    const getElapsedCpuTimeInMs = (cell: ExecutionPlanMetricSource): number | undefined => {
        const elapsedCpuMetric = cell.costMetrics.find((m) => m.name === "ElapsedCpuTime");

        if (elapsedCpuMetric === undefined) {
            return undefined;
        } else {
            return Number(elapsedCpuMetric.value);
        }
    };

    const getCost = (cell: ExecutionPlanMetricSource): number | undefined => cell.cost;
    const getSubtreeCost = (cell: ExecutionPlanMetricSource): number | undefined =>
        cell.subTreeCost;

    const getRowsForAllExecutions = (cell: ExecutionPlanMetricSource): number | undefined => {
        const actualRowsMetric = cell.costMetrics.find((m) => m.name === "ActualRows");
        const estimateRowsForAllExecutionsMetric = cell.costMetrics.find(
            (m) => m.name === "EstimateRowsAllExecs",
        );

        if (actualRowsMetric === undefined && estimateRowsForAllExecutionsMetric === undefined) {
            return undefined;
        }

        let result = Number(actualRowsMetric?.value);
        if (!result) {
            result = Number(estimateRowsForAllExecutionsMetric?.value);
        }

        if (isNaN(result)) {
            return undefined;
        }

        return result;
    };

    const getNumberOfRowsRead = (cell: ExecutionPlanMetricSource): number | undefined => {
        const actualRowsReadMetric = cell.costMetrics.find((m) => m.name === "ActualRowsRead");
        const estimatedRowsReadMetric = cell.costMetrics.find(
            (m) => m.name === "EstimatedRowsRead",
        );

        if (actualRowsReadMetric === undefined && estimatedRowsReadMetric === undefined) {
            return undefined;
        }

        let result = Number(actualRowsReadMetric?.value);
        if (!result) {
            result = Number(estimatedRowsReadMetric?.value);
        }

        if (isNaN(result)) {
            return undefined;
        }

        return result;
    };

    let expensiveOperationDelegate = getCost;
    switch (selectedExpensiveOperationType) {
        case ep.ExpensiveMetricType.ActualElapsedTime:
            expensiveOperationDelegate = getElapsedTimeInMs;
            break;
        case ep.ExpensiveMetricType.ActualElapsedCpuTime:
            expensiveOperationDelegate = getElapsedCpuTimeInMs;
            break;
        case ep.ExpensiveMetricType.SubtreeCost:
            expensiveOperationDelegate = getSubtreeCost;
            break;
        case ep.ExpensiveMetricType.ActualNumberOfRowsForAllExecutions:
            expensiveOperationDelegate = getRowsForAllExecutions;
            break;
        case ep.ExpensiveMetricType.NumberOfRowsRead:
            expensiveOperationDelegate = getNumberOfRowsRead;
            break;
        case ep.ExpensiveMetricType.Off:
            expensiveOperationDelegate = () => undefined;
            break;
    }

    return expensiveOperationDelegate;
}
