/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { Card, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { FabricProvisioningContext } from "./fabricProvisioningStateProvider";
import { Checkmark20Regular } from "@fluentui/react-icons";
import { FabricProvisioningHeader } from "./fabricProvisioningHeader";

const useStyles = makeStyles({
    outerDiv: {
        height: "fit-content",
        width: "500px",
        position: "relative",
        overflow: "auto",
        justifyContent: "center",
        alignItems: "center",
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
});

export const ProvisionFabricDatabasePage: React.FC = () => {
    const state = useContext(FabricProvisioningContext);
    const classes = useStyles();
    const fabricProvisioningState = state?.state;

    if (!state || !fabricProvisioningState) return undefined;

    useEffect(() => {}, [fabricProvisioningState.database]);

    return (
        <div>
            <FabricProvisioningHeader />
            <Card className={classes.outerDiv}>
                <div className={classes.separatorDiv} />
                <div className={classes.header}>
                    <div className={classes.leftHeader}>
                        {fabricProvisioningState.database ? (
                            <Checkmark20Regular style={{ color: "green" }} />
                        ) : (
                            <Spinner size="tiny" />
                        )}
                        {fabricProvisioningState.database ? (
                            <span>
                                Finished Deploying {fabricProvisioningState.database.displayName}
                            </span>
                        ) : (
                            <span>Deployment in progress...</span>
                        )}
                    </div>
                    <div>
                        Deployment Name: {fabricProvisioningState.formState.databaseName}
                        Tenant: {fabricProvisioningState.formState.tenantId}
                        Workspace: {fabricProvisioningState.formState.workspace}
                        Start Time: {fabricProvisioningState.deploymentStartTime}
                    </div>
                </div>
            </Card>
        </div>
    );
};
