/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option } from "@fluentui/react-components";
import { useCallback, useEffect, useRef, useState } from "react";

import { ExecutionPlanComparisonSource } from "../../../../sharedInterfaces/executionPlanComparison";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { WebviewErrorBoundary } from "../../../common/webviewErrorBoundary";
import { ExecutionPlanGraphController } from "../executionPlanGraphController";
import { ExecutionPlanHeader } from "../executionPlanHeader";
import { FindNode } from "../findNodes";
import { ReactFlowExecutionPlan } from "../reactFlowExecutionPlan";
import { ComparisonSide } from "./comparisonModel";
import { ComparisonPaneSource } from "./useComparisonSources";

function graphCostPercentage(source: ExecutionPlanComparisonSource, graphIndex: number) {
    const graphCost = (index: number) =>
        source.graphs[index].root.cost + source.graphs[index].root.subTreeCost;
    const total = source.graphs.reduce((sum, _, index) => sum + graphCost(index), 0);
    return total > 0 ? ((graphCost(graphIndex) / total) * 100).toFixed(2) : "0.00";
}

interface ComparisonPlanPaneProps {
    side: ComparisonSide;
    pane: ComparisonPaneSource;
    groupRoots: ReadonlyMap<string, number>;
    onReady: (side: ComparisonSide, controller: ExecutionPlanGraphController | null) => void;
    onSelectionChange: (side: ComparisonSide, id: string) => void;
    onSelectGraph: (side: ComparisonSide, graphIndex: number) => void;
    onShowQuery: (query: string) => void;
    showFind: boolean;
    onCloseFind: () => void;
}

/** One plan of the comparison: its statement picker, query summary and graph. */
export function ComparisonPlanPane({
    side,
    pane,
    groupRoots,
    onReady,
    onSelectionChange,
    onSelectGraph,
    onShowQuery,
    showFind,
    onCloseFind,
}: ComparisonPlanPaneProps) {
    const { themeKind, extensionRpc } = useVscodeWebview();
    const { source, graphIndex } = pane;
    const graph = source.graphs[graphIndex];
    const [controller, setController] = useState<ExecutionPlanGraphController | null>(null);
    const findInputRef = useRef<HTMLInputElement>(null);
    const handleReady = useCallback(
        (nextController: ExecutionPlanGraphController | null) => {
            setController(nextController);
            onReady(side, nextController);
        },
        [onReady, side],
    );
    const handleSelectionChange = useCallback(
        (id: string) => onSelectionChange(side, id),
        [onSelectionChange, side],
    );

    useEffect(() => {
        if (showFind) {
            findInputRef.current?.focus();
        }
    }, [showFind]);

    if (!graph) {
        return undefined;
    }

    return (
        <section
            className="execution-plan-comparison-pane"
            aria-label={
                side === "primary"
                    ? locConstants.executionPlan.primaryPlan
                    : locConstants.executionPlan.addedPlan
            }>
            <div className="execution-plan-comparison-pane-header">
                <div className="execution-plan-comparison-source-row">
                    <span className="execution-plan-comparison-source-name">{source.name}</span>
                    {source.graphs.length > 1 && (
                        <Dropdown
                            size="small"
                            value={locConstants.executionPlan.statementNumber(graphIndex + 1)}
                            selectedOptions={[String(graphIndex)]}
                            aria-label={locConstants.executionPlan.selectStatement}
                            onOptionSelect={(_, data) =>
                                onSelectGraph(side, Number(data.optionValue))
                            }>
                            {source.graphs.map((_, index) => (
                                <Option
                                    key={index}
                                    value={String(index)}
                                    text={locConstants.executionPlan.statementNumber(index + 1)}>
                                    {locConstants.executionPlan.statementNumber(index + 1)}
                                </Option>
                            ))}
                        </Dropdown>
                    )}
                </div>
                <ExecutionPlanHeader
                    graph={graph}
                    costLabel={locConstants.executionPlan.queryCostRelativeToScript(
                        graphIndex + 1,
                        graphCostPercentage(source, graphIndex),
                    )}
                    onShowQuery={onShowQuery}
                />
            </div>
            <div className="execution-plan-comparison-graph">
                <WebviewErrorBoundary
                    fallback={
                        <div role="alert" className="execution-plan-comparison-render-error">
                            {locConstants.executionPlan.executionPlanRendererError}
                        </div>
                    }
                    onError={(error, errorInfo) => {
                        handleReady(null);
                        extensionRpc.log.error(
                            `React Flow ${side} comparison renderer failed`,
                            error,
                            errorInfo.componentStack,
                        );
                    }}>
                    <ReactFlowExecutionPlan
                        root={graph.root}
                        planNumber={graphIndex + 1}
                        themeKind={themeKind}
                        onReady={handleReady}
                        comparisonGroupRoots={groupRoots}
                        onSelectionChange={handleSelectionChange}
                    />
                </WebviewErrorBoundary>
                {showFind && controller && (
                    <FindNode
                        executionPlanView={controller}
                        setExecutionPlanView={() => undefined}
                        findNodeOptions={controller.getUniqueElementProperties()}
                        setFindNodeClicked={(open: boolean) => {
                            if (!open) {
                                onCloseFind();
                            }
                        }}
                        inputRef={findInputRef}
                    />
                )}
            </div>
        </section>
    );
}
