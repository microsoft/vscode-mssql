/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from "./queryPlanSetup";
import "./executionPlan.css";
import {
    Button,
    Combobox,
    makeStyles,
    Option,
} from "@fluentui/react-components";
import { Checkmark20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import * as ep from "./executionPlanInterfaces";
import { locConstants } from "../../common/locConstants";

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
});

interface HighlightExpensiveOperationsProps {
    executionPlanView: any;
    setExecutionPlanView: any;
    setHighlightOpsClicked: any;
}

export const HighlightExpensiveOperations: React.FC<
    HighlightExpensiveOperationsProps
> = ({ executionPlanView, setExecutionPlanView, setHighlightOpsClicked }) => {
    const classes = useStyles();
    const state = useContext(ExecutionPlanContext);
    const executionPlanState = state?.state;
    const [highlightMetricSelected, setHighlightMetricSelected] = useState("");

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
                highlightMetricOptionsEnum[
                    highlightMetricOptions.indexOf(highlightMetricSelected)
                ];
            const expensiveOperationDelegate: (
                cell: ep.AzDataGraphCell,
            ) => number | undefined =
                getExpensiveOperationDelegate(enumSelected)!;
            executionPlanView.clearExpensiveOperatorHighlighting();
            const elementId = executionPlanView.highlightExpensiveOperator(
                expensiveOperationDelegate,
            );
            if (elementId) {
                executionPlanView.centerElement(
                    executionPlanView.getElementById(elementId)!,
                );
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

    return (
        <div
            id="highlightExpensiveOpsContainer"
            className={classes.inputContainer}
            style={{
                background: utils.iconBackground(executionPlanState!.theme!),
            }}
        >
            <div>{locConstants.executionPlan.metric}</div>
            <Combobox
                id="highlightExpensiveOpsDropdown"
                onOptionSelect={(_, data) =>
                    setHighlightMetricSelected(data.optionText ?? "")
                }
            >
                <div style={{ maxHeight: "250px" }}>
                    {highlightMetricOptions.map((option) => (
                        <Option key={option}>{option}</Option>
                    ))}
                </div>
            </Combobox>
            <Button
                onClick={handleHighlightExpensiveOperation}
                icon={<Checkmark20Regular />}
            />
            <Button
                icon={<Dismiss20Regular />}
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

    const getElapsedCpuTimeInMs = (
        cell: ep.AzDataGraphCell,
    ): number | undefined => {
        const elapsedCpuMetric = cell.costMetrics.find(
            (m) => m.name === "ElapsedCpuTime",
        );

        if (elapsedCpuMetric === undefined) {
            return undefined;
        } else {
            return Number(elapsedCpuMetric.value);
        }
    };

    const getCost = (cell: ep.AzDataGraphCell): number | undefined => cell.cost;
    const getSubtreeCost = (cell: ep.AzDataGraphCell): number | undefined =>
        cell.subTreeCost;

    const getRowsForAllExecutions = (
        cell: ep.AzDataGraphCell,
    ): number | undefined => {
        const actualRowsMetric = cell.costMetrics.find(
            (m) => m.name === "ActualRows",
        );
        const estimateRowsForAllExecutionsMetric = cell.costMetrics.find(
            (m) => m.name === "EstimateRowsAllExecs",
        );

        if (
            actualRowsMetric === undefined &&
            estimateRowsForAllExecutionsMetric === undefined
        ) {
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

    const getNumberOfRowsRead = (
        cell: ep.AzDataGraphCell,
    ): number | undefined => {
        const actualRowsReadMetric = cell.costMetrics.find(
            (m) => m.name === "ActualRowsRead",
        );
        const estimatedRowsReadMetric = cell.costMetrics.find(
            (m) => m.name === "EstimatedRowsRead",
        );

        if (
            actualRowsReadMetric === undefined &&
            estimatedRowsReadMetric === undefined
        ) {
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
