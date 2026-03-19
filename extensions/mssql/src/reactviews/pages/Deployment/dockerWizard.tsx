/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { Wizard, WizardPageDefinition } from "../../common/wizard";
import { DockerIcon } from "../../common/icons/docker";
import { DeploymentContext } from "./deploymentStateProvider";
import { useDeploymentSelector } from "./deploymentSelector";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { LocalContainersState } from "../../../sharedInterfaces/localContainers";
import { LocalContainersInfoPage } from "./LocalContainers/localContainersInfoPage";
import { LocalContainersPrereqPage } from "./LocalContainers/localContainersPrereqPage";
import { LocalContainersInputForm } from "./LocalContainers/localContainersInputForm";
import { LocalContainersSetupStepsPage } from "./LocalContainers/localContainersSetupStepsPage";

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

interface DockerWizardProps {
    onBack: () => void;
}

export const DockerWizard: React.FC<DockerWizardProps> = ({ onBack }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const deploymentTypeLoadState = useDeploymentSelector((s) => s.deploymentTypeState?.loadState);
    const deploymentTypeErrorMessage = useDeploymentSelector(
        (s) => s.deploymentTypeState?.errorMessage,
    );
    const formErrors = useDeploymentSelector(
        (s) => (s.deploymentTypeState as LocalContainersState)?.formErrors,
    );
    const acceptedEula = useDeploymentSelector(
        (s) => (s.deploymentTypeState as LocalContainersState)?.formState?.acceptEula,
    );
    const password = useDeploymentSelector(
        (s) => (s.deploymentTypeState as LocalContainersState)?.formState?.password,
    );
    const version = useDeploymentSelector(
        (s) => (s.deploymentTypeState as LocalContainersState)?.formState?.version,
    );
    const [initialized, setInitialized] = useState(false);

    if (!context) return undefined;

    const canCreateContainer =
        (formErrors?.length ?? 1) === 0 &&
        Boolean(acceptedEula) &&
        Boolean(password) &&
        Boolean(version);

    const pages = useMemo<WizardPageDefinition[]>(
        () => [
            {
                id: "info",
                title: locConstants.localContainers.sqlServerContainerHeader,
                render: () => <LocalContainersInfoPage />,
                onNext: async () => {
                    context.initializeDeploymentSpecifics(DeploymentType.LocalContainers);
                    setInitialized(true);
                },
                onPrevious: async () => {
                    onBack();
                    return false;
                },
                nextLabel: locConstants.common.getStarted,
            },
            {
                id: "prereqs",
                title: locConstants.localContainers.gettingDockerReady,
                render: () => {
                    if (!initialized || deploymentTypeLoadState === ApiStatus.Loading) {
                        return (
                            <div className={classes.spinnerDiv}>
                                <Spinner
                                    label={locConstants.localContainers.loadingLocalContainers}
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
                    return <LocalContainersPrereqPage />;
                },
            },
            {
                id: "configure",
                title: locConstants.localContainers.createContainer,
                render: () => <LocalContainersInputForm />,
                nextLabel: locConstants.localContainers.createContainer,
                isPageValid: canCreateContainer,
                onNext: async () => {
                    await context.checkDockerProfile();
                },
            },
            {
                id: "deploy",
                title: locConstants.localContainers.settingUp,
                render: () => <LocalContainersSetupStepsPage />,
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
        [
            context,
            initialized,
            deploymentTypeLoadState,
            deploymentTypeErrorMessage,
            canCreateContainer,
            onBack,
        ],
    );

    return (
        <Wizard
            icon={<DockerIcon />}
            title={locConstants.localContainers.sqlServerContainerHeader}
            pages={pages}
            initialPageId="info"
            onCancel={() => context.dispose()}
        />
    );
};
