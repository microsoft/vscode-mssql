/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";
import {
    QsSaveExecutionPlanRequest,
    QsCompareExecutionPlanRequest,
    QsShowPlanQueryRequest,
    QsShowPlanXmlRequest,
} from "../../../sharedInterfaces/queryStudio";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { ExecutionPlanPage, ExecutionPlanPageViewState } from "../ExecutionPlan/executionPlanPage";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";
import {
    ExecutionPlanContext,
    ExecutionPlanContextProps,
} from "../ExecutionPlan/executionPlanStateProvider";
import type { Rpc } from "./resultsGridShared";

const LOADING_PLAN_STATE: ExecutionPlanState = {
    loadState: ApiStatus.Loading,
    executionPlanGraphs: [],
    totalCost: 0,
};

export type QueryStudioExecutionPlanViewState = ExecutionPlanPageViewState;

export function QueryStudioExecutionPlanView(props: {
    rpc: Rpc;
    executionPlanState?: ExecutionPlanState | undefined;
    active?: boolean;
    initialViewState?: QueryStudioExecutionPlanViewState;
    onViewStateChange?: (viewState: QueryStudioExecutionPlanViewState) => void;
}) {
    const { rpc, executionPlanState, active, initialViewState, onViewStateChange } = props;
    const parent = useContext(VscodeWebviewContext);
    const planState = useMemo(
        () => ({ executionPlanState: executionPlanState ?? LOADING_PLAN_STATE }),
        [executionPlanState],
    );
    const planContext = useMemo(
        () => parent && { ...parent, getSnapshot: () => planState },
        [parent, planState],
    );
    const context = useMemo<ExecutionPlanContextProps>(
        () => ({
            getExecutionPlan: () => undefined,
            saveExecutionPlan: (sqlPlanContent: string) => {
                void rpc.sendRequest(QsSaveExecutionPlanRequest.type, { sqlPlanContent });
            },
            showPlanXml: (sqlPlanContent: string) => {
                void rpc.sendRequest(QsShowPlanXmlRequest.type, { sqlPlanContent });
            },
            showQuery: (query: string) => {
                void rpc.sendRequest(QsShowPlanQueryRequest.type, { query });
            },
            updateTotalCost: () => undefined,
            compareExecutionPlan: (graphIndex: number) => {
                const graph = executionPlanState?.executionPlanGraphs?.[graphIndex];
                if (graph) {
                    void rpc.sendRequest(QsCompareExecutionPlanRequest.type, {
                        sqlPlanContent: graph.graphFile.graphFileContent,
                        graphIndex: graph.graphFile.planIndexInFile ?? 0,
                    });
                }
            },
        }),
        [rpc, executionPlanState],
    );

    return (
        <VscodeWebviewContext.Provider value={planContext}>
            <ExecutionPlanContext.Provider value={context}>
                <div className="qs-query-plan-view">
                    <ExecutionPlanPage
                        autoLoad={false}
                        active={active}
                        initialViewState={initialViewState}
                        onViewStateChange={onViewStateChange}
                    />
                </div>
            </ExecutionPlanContext.Provider>
        </VscodeWebviewContext.Provider>
    );
}
