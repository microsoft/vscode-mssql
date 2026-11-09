/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Link,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
} from "@fluentui/react-components";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { useDabContext } from "../dabContext";

/**
 * Tells the user, on the Data API builder page itself, that the configuration
 * changed since it was deployed, so the change can be applied without first
 * opening the deployment.
 */
export const DabConfigChangedBanner = () => {
    const {
        dabDeployments,
        dabDeploymentRun,
        startDabDeployment,
        openDabDeploymentsDialog,
        openDabDeploymentChanges,
    } = useDabContext();

    const deployment = dabDeployments[0];
    const isRunActive =
        dabDeploymentRun?.status === Dab.DabDeploymentRunStatus.Running ||
        dabDeploymentRun?.status === Dab.DabDeploymentRunStatus.Waiting;
    if (!deployment?.isConfigOutdated || isRunActive) {
        return undefined;
    }

    /** Redeploys with the current config and shows the run in the dialog. */
    const applyChanges = async () => {
        await startDabDeployment(deployment.target, deployment.id);
        openDabDeploymentsDialog();
    };

    return (
        <MessageBar intent="warning">
            <MessageBarBody>
                {locConstants.schemaDesigner.deploymentConfigChangedBanner}
            </MessageBarBody>
            <MessageBarActions>
                {deployment.hasConfigSnapshot && (
                    <Link onClick={openDabDeploymentChanges}>
                        {locConstants.schemaDesigner.viewChanges}
                    </Link>
                )}
                <Button appearance="primary" size="small" onClick={() => void applyChanges()}>
                    {locConstants.schemaDesigner.applyDeploymentChanges}
                </Button>
            </MessageBarActions>
        </MessageBar>
    );
};
