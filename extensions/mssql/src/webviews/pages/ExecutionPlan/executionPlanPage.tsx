/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useRef } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ExecutionPlanGraphView, ExecutionPlanGraphViewState } from "./executionPlanGraph";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { useExecutionPlanSelector } from "./executionPlanSelector";
import { ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
});

interface ExecutionPlanPageProps {
    autoLoad?: boolean;
}

export interface ExecutionPlanPageViewState {
    pageScrollTop: number;
    graphs: Record<string, ExecutionPlanGraphViewState>;
}

interface ExecutionPlanPageContentProps {
    executionPlanState?: ExecutionPlanState;
    active?: boolean;
    initialViewState?: ExecutionPlanPageViewState;
    onViewStateChange?: (viewState: ExecutionPlanPageViewState) => void;
}

export const ExecutionPlanPageContent = ({
    executionPlanState,
    active = true,
    initialViewState,
    onViewStateChange,
}: ExecutionPlanPageContentProps) => {
    const classes = useStyles();
    const outerRef = useRef<HTMLDivElement>(null);
    const currentViewState = useRef<ExecutionPlanPageViewState>({
        pageScrollTop: initialViewState?.pageScrollTop ?? 0,
        graphs: { ...initialViewState?.graphs },
    });
    const onViewStateChangeRef = useRef(onViewStateChange);
    onViewStateChangeRef.current = onViewStateChange;
    const handleGraphViewStateChange = useCallback(
        (graphIndex: number, graphViewState: ExecutionPlanGraphViewState) => {
            currentViewState.current = {
                ...currentViewState.current,
                graphs: {
                    ...currentViewState.current.graphs,
                    [graphIndex.toString()]: graphViewState,
                },
            };
            onViewStateChangeRef.current?.(currentViewState.current);
        },
        [],
    );
    const handlePageScroll = useCallback(() => {
        currentViewState.current = {
            ...currentViewState.current,
            pageScrollTop: outerRef.current?.scrollTop ?? 0,
        };
        onViewStateChangeRef.current?.(currentViewState.current);
    }, []);
    const loadState = executionPlanState?.loadState ?? ApiStatus.Loading;
    useEffect(() => {
        if (loadState === ApiStatus.Loaded && outerRef.current) {
            outerRef.current.scrollTop = initialViewState?.pageScrollTop ?? 0;
        }
    }, [initialViewState?.pageScrollTop, loadState]);
    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.executionPlan.loadingExecutionPlan}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                const executionPlanGraphs = executionPlanState?.executionPlanGraphs ?? [];
                return executionPlanGraphs?.map((graph, index: number) => (
                    <ExecutionPlanGraphView
                        key={`${index}:${graph.root.id}:${graph.graphFile.graphFileContent.length}`}
                        graphIndex={index}
                        active={active}
                        executionPlanState={executionPlanState!}
                        initialViewState={initialViewState?.graphs[index.toString()]}
                        onViewStateChange={(graphViewState) =>
                            handleGraphViewStateChange(index, graphViewState)
                        }
                    />
                ));
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{executionPlanState?.errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return (
        <div className={classes.outerDiv} ref={outerRef} onScroll={handlePageScroll}>
            {renderMainContent()}
        </div>
    );
};

export const ExecutionPlanPage = ({ autoLoad = true }: ExecutionPlanPageProps) => {
    const context = useContext(ExecutionPlanContext);
    const executionPlanState = useExecutionPlanSelector<ExecutionPlanState>(
        (s) => s.executionPlanState,
    );
    useEffect(() => {
        if (
            autoLoad &&
            context &&
            executionPlanState &&
            // checks if execution plans have already been gotten
            executionPlanState.executionPlanGraphs &&
            !executionPlanState.executionPlanGraphs.length
        ) {
            context.getExecutionPlan();
        }
    }, [autoLoad, context, executionPlanState]);

    return <ExecutionPlanPageContent executionPlanState={executionPlanState} />;
};
