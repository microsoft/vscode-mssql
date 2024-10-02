/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ExecutionPlanGraph } from "./executionPlanGraph";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { QueryResultState } from "../QueryResult/queryResultStateProvider";

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
    context?: QueryResultState;
}

export const ExecutionPlanPage: React.FC<ExecutionPlanPageProps> = ({
    context,
}) => {
    const classes = useStyles();
    console.log(context);
    const provider = context ? context : useContext(ExecutionPlanContext);
    const loadState = provider?.state?.loadState ?? ApiStatus.Loading;
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
                    provider?.state?.executionPlanGraphs ?? [];
                return executionPlanGraphs?.map((_: any, index: number) => (
                    <ExecutionPlanGraph
                        key={index}
                        graphIndex={index}
                        context={context}
                    />
                ));
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>
                            {provider?.state?.errorMessage ?? ""}
                        </Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
