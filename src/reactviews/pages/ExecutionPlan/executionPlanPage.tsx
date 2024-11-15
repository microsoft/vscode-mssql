/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ExecutionPlanGraph } from "./executionPlanGraph";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";

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

export const ExecutionPlanPage = () => {
    const classes = useStyles();
    const state = useContext(ExecutionPlanContext);
    const executionPlanState = state?.state?.executionPlanState;
    const loadState = executionPlanState?.loadState ?? ApiStatus.Loading;
    useEffect(() => {
        if (
            state &&
            state.provider &&
            executionPlanState &&
            // checks if execution plans have already been gotten
            executionPlanState.executionPlanGraphs &&
            !executionPlanState.executionPlanGraphs.length
        ) {
            state.provider.getExecutionPlan();
        }
    }, [executionPlanState]);

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label="Loading execution plan..."
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                const executionPlanGraphs =
                    executionPlanState?.executionPlanGraphs ?? [];
                return executionPlanGraphs?.map((_: any, index: number) => (
                    <ExecutionPlanGraph key={index} graphIndex={index} />
                ));
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>
                            {executionPlanState?.errorMessage ?? ""}
                        </Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
