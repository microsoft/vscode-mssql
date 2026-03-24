/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { DeploymentContext } from "./deploymentStateProvider";
import { useDeploymentSelector } from "./deploymentSelector";
import { Button, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { DeploymentDatabaseIcon } from "../../common/icons/deploymentDatabase";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { ChooseDeploymentTypePage } from "./chooseDeploymentTypePage";
import { LocalContainersDeploymentWizard } from "./LocalContainers/localContainersDeploymentWizard";
import { FabricDeploymentWizard } from "./FabricProvisioning/fabricDeploymentWizard";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    shell: {
        height: "100%",
    },
});

export const DeploymentStartPage = () => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const loadState = useDeploymentSelector((s) => s.loadState);
    const errorMessage = useDeploymentSelector((s) => s.errorMessage);
    const [activeDeploymentType, setActiveDeploymentType] = useState<DeploymentType>();

    if (!context || !loadState) {
        return undefined;
    }

    if (activeDeploymentType === DeploymentType.LocalContainers) {
        return (
            <LocalContainersDeploymentWizard
                onBackToStart={() => setActiveDeploymentType(undefined)}
            />
        );
    }

    if (activeDeploymentType === DeploymentType.FabricProvisioning) {
        return <FabricDeploymentWizard onBackToStart={() => setActiveDeploymentType(undefined)} />;
    }

    const handleDeploymentTypeSelected = (deploymentType: DeploymentType) => {
        if (loadState !== ApiStatus.Loaded) {
            return;
        }

        context.initializeDeploymentSpecifics(deploymentType);
        setActiveDeploymentType(deploymentType);
    };

    return (
        <div className={classes.outerDiv}>
            <DialogPageShell
                icon={<DeploymentDatabaseIcon aria-hidden="true" />}
                title={locConstants.deployment.deploymentHeader}
                subtitle={locConstants.deployment.deploymentDescription}
                maxContentWidth="wide"
                loadingMessage={
                    loadState === ApiStatus.Loading
                        ? `${locConstants.deployment.loadingDeploymentPage}...`
                        : undefined
                }
                errorMessage={loadState === ApiStatus.Error ? errorMessage : undefined}
                footerStart={
                    <Button appearance="secondary" onClick={() => context.dispose()}>
                        {locConstants.common.cancel}
                    </Button>
                }>
                {loadState === ApiStatus.Loaded ? (
                    <ChooseDeploymentTypePage
                        onDeploymentTypeChange={handleDeploymentTypeSelected}
                    />
                ) : (
                    <div style={{ minHeight: "240px" }}>
                        {loadState === ApiStatus.Loading && (
                            <Spinner labelPosition="below" label="" />
                        )}
                        {loadState === ApiStatus.Error && (
                            <Text size={400}>{errorMessage ?? ""}</Text>
                        )}
                    </div>
                )}
            </DialogPageShell>
        </div>
    );
};
