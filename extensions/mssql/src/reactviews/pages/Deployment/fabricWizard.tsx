/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { Wizard, WizardPageDefinition } from "../../common/wizard";
import { SqlDbInFabricIcon } from "../../common/icons/sqlDbInFabric";
import { DeploymentContext } from "./deploymentStateProvider";
import { useDeploymentSelector } from "./deploymentSelector";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { FabricProvisioningInfoPage } from "./FabricProvisioning/fabricProvisioningInfoPage";
import { FabricProvisioningInputForm } from "./FabricProvisioning/fabricProvisioningInputForm";
import { ProvisionFabricDatabasePage } from "./FabricProvisioning/provisionFabricDatabasePage";

const useStyles = makeStyles({
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

interface FabricWizardProps {
    onBack: () => void;
}

export const FabricWizard: React.FC<FabricWizardProps> = ({ onBack }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const deploymentTypeLoadState = useDeploymentSelector((s) => s.deploymentTypeState?.loadState);
    const deploymentTypeErrorMessage = useDeploymentSelector(
        (s) => s.deploymentTypeState?.errorMessage,
    );
    const [initialized, setInitialized] = useState(false);

    if (!context) return undefined;

    const pages = useMemo<WizardPageDefinition[]>(
        () => [
            {
                id: "info",
                title: locConstants.fabricProvisioning.sqlDatabaseInFabric,
                render: () => <FabricProvisioningInfoPage />,
                onNext: async () => {
                    context.initializeDeploymentSpecifics(DeploymentType.FabricProvisioning);
                    setInitialized(true);
                },
                nextLabel: locConstants.common.getStarted,
            },
            {
                id: "configure",
                title: locConstants.fabricProvisioning.createDatabase,
                render: () => {
                    if (!initialized || deploymentTypeLoadState === ApiStatus.Loading) {
                        return (
                            <div className={classes.spinnerDiv}>
                                <Spinner
                                    label={
                                        locConstants.fabricProvisioning.loadingFabricProvisioning
                                    }
                                    labelPosition="below"
                                />
                            </div>
                        );
                    }
                    if (deploymentTypeLoadState === ApiStatus.Error) {
                        return (
                            <div className={classes.spinnerDiv}>
                                <ErrorCircleRegular className={classes.errorIcon} />
                                <Text size={400}>{deploymentTypeErrorMessage ?? ""}</Text>
                            </div>
                        );
                    }
                    return <FabricProvisioningInputForm />;
                },
                nextLabel: locConstants.fabricProvisioning.createDatabase,
                onNext: async () => {
                    await context.createDatabase();
                },
                onPrevious: async () => {
                    onBack();
                    return false;
                },
            },
            {
                id: "deploy",
                title: locConstants.fabricProvisioning.provisioning,
                render: () => <ProvisionFabricDatabasePage />,
                nextLabel: locConstants.common.finish,
                onPrevious: async () => {
                    return false;
                },
                onNext: async () => {
                    context.dispose();
                    return false;
                },
            },
        ],
        [context, initialized, deploymentTypeLoadState, deploymentTypeErrorMessage, onBack],
    );

    return (
        <Wizard
            icon={<SqlDbInFabricIcon />}
            title={locConstants.fabricProvisioning.sqlDatabaseInFabric}
            pages={pages}
            initialPageId="info"
            onCancel={() => context.dispose()}
        />
    );
};
