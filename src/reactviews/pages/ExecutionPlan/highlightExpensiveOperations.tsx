/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import * as ep from "../../../sharedInterfaces/executionPlan";

import { Button, Combobox, Option, makeStyles, tokens } from "@fluentui/react-components";
import { Checkmark20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { ExecutionPlanView } from "./executionPlanView";
import { locConstants } from "../../common/locConstants";
import { useState } from "react";

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
    dropdown: {
        maxHeight: "200px",
    },
    spacer: {
        padding: "1px",
    },
});

interface HighlightExpensiveOperationsProps {
    executionPlanView: ExecutionPlanView;
    setExecutionPlanView: any;
    setHighlightOpsClicked: any;
    inputRef: any;
}

export const HighlightExpensiveOperations: React.FC<HighlightExpensiveOperationsProps> = ({
    executionPlanView,
    setExecutionPlanView,
    setHighlightOpsClicked,
    inputRef,
}) => {
    const classes = useStyles();
    const [highlightMetricSelected, setHighlightMetricSelected] = useState("");
    const [highlightedElement, setHighlightedElement] = useState("");

    const highlightMetricOptions: string[] = [
        locConstants.executionPlan.actualElapsedTime,
        locConstants.executionPlan.actualElapsedCpuTime,
        locConstants.executionPlan.cost,
        locConstants.executionPlan.subtreeCost,
        locConstants.executionPlan.actualNumberOfRowsForAllExecutions,
        locConstants.executionPlan.numberOfRowsRead,
        locConstants.executionPlan.off,
    ];
    const highlightMetricOptionsEnum: ep.ExpensiveMetricType[] = [
        ep.ExpensiveMetricType.ActualElapsedTime,
        ep.ExpensiveMetricType.ActualElapsedCpuTime,
        ep.ExpensiveMetricType.Cost,
        ep.ExpensiveMetricType.SubtreeCost,
        ep.ExpensiveMetricType.ActualNumberOfRowsForAllExecutions,
        ep.ExpensiveMetricType.NumberOfRowsRead,
        ep.ExpensiveMetricType.Off,
    ];

    const handleHighlightExpensiveOperation = async () => {
        if (executionPlanView) {
            const enumSelected =
                highlightMetricOptionsEnum[highlightMetricOptions.indexOf(highlightMetricSelected)];
            const expensiveOperationDelegate: (cell: ep.AzDataGraphCell) => number | undefined =
                getExpensiveOperationDelegate(enumSelected)!;
            executionPlanView.clearExpensiveOperatorHighlighting();
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
): (cell: ep.AzDataGraphCell) => number | undefined {
    const getElapsedTimeInMs = (cell: ep.AzDataGraphCell): number | undefined =>
        cell.elapsedTimeInMs;

    const getElapsedCpuTimeInMs = (cell: ep.AzDataGraphCell): number | undefined => {
        const elapsedCpuMetric = cell.costMetrics.find((m) => m.name === "ElapsedCpuTime");

        if (elapsedCpuMetric === undefined) {
            return undefined;
        } else {
            return Number(elapsedCpuMetric.value);
        }
    };

    const getCost = (cell: ep.AzDataGraphCell): number | undefined => cell.cost;
    const getSubtreeCost = (cell: ep.AzDataGraphCell): number | undefined => cell.subTreeCost;

    const getRowsForAllExecutions = (cell: ep.AzDataGraphCell): number | undefined => {
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

    const getNumberOfRowsRead = (cell: ep.AzDataGraphCell): number | undefined => {
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
    }

    return expensiveOperationDelegate;
}
