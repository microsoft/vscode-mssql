/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text } from "@fluentui/react-components";
import { useCallback, useContext, useState } from "react";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { DockerIcon } from "../../../common/icons/docker";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";
import { AzureSqlDatabaseLocalContainerInfoPage } from "./azureSqlDatabaseLocalContainerInfoPage";
import {
    AzureSqlDatabaseContainerEnginePage,
    getContainerEngineDisplayName,
} from "./azureSqlDatabaseContainerEnginePage";
import { ContainerEngine } from "../../../../sharedInterfaces/azureSqlDatabase";

const useStyles = makeStyles({
    placeholder: {
        minHeight: "240px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
});

interface AzureSqlDatabaseLocalContainerWizardProps {
    onBackToDeploymentType: () => void;
}

export const AzureSqlDatabaseLocalContainerWizard: React.FC<
    AzureSqlDatabaseLocalContainerWizardProps
> = ({ onBackToDeploymentType }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const [containerEngine, setContainerEngine] = useState<ContainerEngine>();
    const [detectedEngineCount, setDetectedEngineCount] = useState<number>();
    const [arePrerequisitesReady, setArePrerequisitesReady] = useState(false);
    const handlePrerequisitesReadyChange = useCallback((isReady: boolean) => {
        setArePrerequisitesReady(isReady);
    }, []);

    if (!context) {
        return undefined;
    }

    const placeholderPage = () => (
        <div className={classes.placeholder}>
            <Text size={500}>{locConstants.azureSqlDatabase.localContainerTbd}</Text>
        </div>
    );

    const pages: WizardPageDefinition[] = [
        {
            id: "local-container-info",
            title: locConstants.azureSqlDatabase.developerContainer,
            render: () => <AzureSqlDatabaseLocalContainerInfoPage />,
            nextLabel: locConstants.common.next,
            onPrevious: () => {
                onBackToDeploymentType();
                return false;
            },
        },
        {
            id: "local-container-prerequisites",
            title:
                detectedEngineCount === 0
                    ? locConstants.azureSqlDatabase.noContainerEngineFound
                    : locConstants.azureSqlDatabase.gettingContainerEngineReady(
                          containerEngine
                              ? getContainerEngineDisplayName(containerEngine)
                              : locConstants.azureSqlDatabase.containerEngine,
                      ),
            render: () => (
                <AzureSqlDatabaseContainerEnginePage
                    engine={containerEngine}
                    onEngineChange={setContainerEngine}
                    onDetectionComplete={setDetectedEngineCount}
                    onReadyChange={handlePrerequisitesReadyChange}
                />
            ),
            canGoNext: arePrerequisitesReady,
        },
        {
            id: "local-container-configuration",
            title: locConstants.azureSqlDatabase.localContainerTbd,
            render: placeholderPage,
        },
        {
            id: "local-container-provisioning",
            title: locConstants.azureSqlDatabase.localContainerTbd,
            render: placeholderPage,
        },
    ];

    return (
        <Wizard
            icon={<DockerIcon aria-hidden="true" />}
            title={locConstants.azureSqlDatabase.localContainerWizardTitle}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
        />
    );
};
