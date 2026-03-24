/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { DeploymentContext } from "./deploymentStateProvider";
import { useDeploymentSelector } from "./deploymentSelector";
import { Button, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { DeploymentDatabaseIcon } from "../../common/icons/deploymentDatabase";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { LocalContainersState } from "../../../sharedInterfaces/localContainers";
import { FabricProvisioningState } from "../../../sharedInterfaces/fabricProvisioning";
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
    const deploymentType = useDeploymentSelector((s) => s.deploymentType);
    const deploymentTypeState = useDeploymentSelector((s) => s.deploymentTypeState);
    const [activeDeploymentType, setActiveDeploymentType] = useState<DeploymentType>();
    const [pendingDeploymentType, setPendingDeploymentType] = useState<DeploymentType>();

    const isLocalContainersStateReady = (state: unknown) =>
        Array.isArray((state as LocalContainersState | undefined)?.dockerSteps);

    const isFabricStateReady = (state: unknown) => {
        const fabricState = state as FabricProvisioningState | undefined;
        return (
            !!fabricState?.formState &&
            !!fabricState?.formComponents &&
            "accountId" in fabricState.formComponents
        );
    };

    useEffect(() => {
        if (pendingDeploymentType === undefined || deploymentType !== pendingDeploymentType) {
            return;
        }

        if (
            pendingDeploymentType === DeploymentType.LocalContainers &&
            isLocalContainersStateReady(deploymentTypeState)
        ) {
            setActiveDeploymentType(DeploymentType.LocalContainers);
            setPendingDeploymentType(undefined);
        } else if (
            pendingDeploymentType === DeploymentType.FabricProvisioning &&
            isFabricStateReady(deploymentTypeState)
        ) {
            setActiveDeploymentType(DeploymentType.FabricProvisioning);
            setPendingDeploymentType(undefined);
        }
    }, [deploymentType, deploymentTypeState, pendingDeploymentType]);

    if (!context || !loadState) {
        return undefined;
    }

    if (activeDeploymentType === DeploymentType.LocalContainers) {
        return (
            <LocalContainersDeploymentWizard
                onBackToStart={() => {
                    setActiveDeploymentType(undefined);
                    setPendingDeploymentType(undefined);
                }}
            />
        );
    }

    if (activeDeploymentType === DeploymentType.FabricProvisioning) {
        return (
            <FabricDeploymentWizard
                onBackToStart={() => {
                    setActiveDeploymentType(undefined);
                    setPendingDeploymentType(undefined);
                }}
            />
        );
    }

    const handleDeploymentTypeSelected = (deploymentType: DeploymentType) => {
        if (loadState !== ApiStatus.Loaded || pendingDeploymentType !== undefined) {
            return;
        }

        setPendingDeploymentType(deploymentType);
        context.initializeDeploymentSpecifics(deploymentType);
    };

    const deploymentLoadingMessage =
        pendingDeploymentType === DeploymentType.LocalContainers
            ? locConstants.localContainers.loadingLocalContainers
            : pendingDeploymentType === DeploymentType.FabricProvisioning
              ? locConstants.fabricProvisioning.loadingFabricProvisioning
              : undefined;

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
                        : deploymentLoadingMessage
                          ? `${deploymentLoadingMessage}`
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
                        selectedDeploymentType={pendingDeploymentType}
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
