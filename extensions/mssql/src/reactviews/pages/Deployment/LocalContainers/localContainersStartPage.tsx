/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { LocalContainersPrereqPage } from "./localContainersPrereqPage";
import { useDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    spinnerDiv: {
        height: "100%",
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

export const LocalContainersStartPage = () => {
    const classes = useStyles();
    const loadState = useDeploymentSelector((s) => s.deploymentTypeState?.loadState);
    const errorMessage = useDeploymentSelector((s) => s.deploymentTypeState?.errorMessage);

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.localContainers.loadingLocalContainers}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return <LocalContainersPrereqPage />;
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
