/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ExecutionPlanGraph } from "./executionPlanGraph";
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

/**
 * Asks the page to scroll a plan into view. Each request is a new object, so the same plan can be
 * revealed again after the user scrolls away.
 */
export interface ExecutionPlanRevealRequest {
    graphIndex: number;
}

interface ExecutionPlanPageProps {
    autoLoad?: boolean;
    /** Plan to scroll into view. Pass it only while the page is visible, so it can be measured. */
    revealRequest?: ExecutionPlanRevealRequest;
}

export const ExecutionPlanPage = ({ autoLoad = true, revealRequest }: ExecutionPlanPageProps) => {
    const classes = useStyles();
    const context = useContext(ExecutionPlanContext);
    const containerRef = useRef<HTMLDivElement>(null);
    const revealedRequestRef = useRef<ExecutionPlanRevealRequest | undefined>(undefined);
    const executionPlanState = useExecutionPlanSelector<ExecutionPlanState>(
        (s) => s.executionPlanState,
    );
    const loadState = executionPlanState?.loadState ?? ApiStatus.Loading;
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
    }, [autoLoad, executionPlanState]);

    useEffect(() => {
        if (
            !revealRequest ||
            revealRequest === revealedRequestRef.current ||
            loadState !== ApiStatus.Loaded
        ) {
            return;
        }
        // Wait a frame so a tab that was just shown has been laid out before measuring.
        const frame = requestAnimationFrame(() => {
            const container = containerRef.current;
            const plan = container?.children[revealRequest.graphIndex];
            if (container && plan instanceof HTMLElement) {
                container.scrollTop = plan.offsetTop;
                revealedRequestRef.current = revealRequest;
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [revealRequest, loadState]);

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
                return executionPlanGraphs.map((_, index) => (
                    <ExecutionPlanGraph key={index} graphIndex={index} />
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
        <div ref={containerRef} className={classes.outerDiv}>
            {renderMainContent()}
        </div>
    );
};
