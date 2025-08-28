/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { Card, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { FabricProvisioningContext } from "./fabricProvisioningStateProvider";
import { Checkmark20Regular, Circle20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { FabricProvisioningHeader } from "./fabricProvisioningHeader";
import { ApiStatus } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: "650px",
        minHeight: "fit-content",
        paddingBottom: "50px",
    },
    spinnerDiv: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    leftHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    separatorDiv: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        background: tokens.colorNeutralStroke2,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px",
    },
    topSpace: {
        marginTop: "8px",
    },
    contentDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "fit-content",
        width: "500px",
    },
});

export const ProvisionFabricDatabasePage: React.FC = () => {
    const state = useContext(FabricProvisioningContext);
    const classes = useStyles();
    const fabricProvisioningState = state?.state;

    if (!state || !fabricProvisioningState) return undefined;

    useEffect(() => {}, [
        fabricProvisioningState.provisionLoadState,
        fabricProvisioningState.connectionLoadState,
    ]);

    const getStatusIcon = (status: ApiStatus) => {
        if (status === ApiStatus.NotStarted) {
            return <Circle20Regular style={{ color: "gray" }} />;
        }
        if (status === ApiStatus.Loaded) {
            return <Checkmark20Regular style={{ color: "green" }} />;
        }
        if (status === ApiStatus.Error) {
            return <Dismiss20Regular style={{ color: "red" }} />;
        }
        return <Spinner size="tiny" />;
    };

    return (
        <div>
            <FabricProvisioningHeader />
            <Card className={classes.outerDiv}>
                <div className={classes.separatorDiv} />
                <div className={classes.header}>
                    <div className={classes.leftHeader}>
                        {getStatusIcon(fabricProvisioningState.provisionLoadState)}
                        {fabricProvisioningState.database ? (
                            <span>
                                Finished Deploying {fabricProvisioningState.database.displayName}
                            </span>
                        ) : (
                            <span>Deployment in progress...</span>
                        )}
                    </div>
                    <div className={classes.contentDiv}>
                        <span>
                            Deployment Name: {fabricProvisioningState.formState.databaseName}
                        </span>
                        <span>Tenant: {fabricProvisioningState.formState.tenantId}</span>
                        <span>Workspace: {fabricProvisioningState.formState.workspace}</span>
                        <span>Start Time: {fabricProvisioningState.deploymentStartTime}</span>
                    </div>
                    <div>{fabricProvisioningState.connectionLoadState}</div>
                </div>
            </Card>
        </div>
    );
};
