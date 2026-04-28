/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { CreateDatabaseIcon } from "../../../common/icons/createDatabase";
import { DeploymentContext } from "../deploymentStateProvider";
import { AzureSqlDatabasePlaceholderPage } from "./azureSqlDatabasePlaceholderPage";

interface AzureSqlDatabaseDeploymentWizardProps {
    onBackToStart: () => void;
}

export const AzureSqlDatabaseDeploymentWizard: React.FC<AzureSqlDatabaseDeploymentWizardProps> = ({
    onBackToStart,
}) => {
    const context = useContext(DeploymentContext);

    if (!context) {
        return undefined;
    }

    const pages: WizardPageDefinition[] = [
        {
            id: "azure-sql-info",
            title: locConstants.azureSqlDatabase.azureSqlDatabaseHeader,
            render: () => <AzureSqlDatabasePlaceholderPage />,
            canGoNext: () => false,
            onPrevious: () => {
                onBackToStart();
                return false;
            },
            onNext: () => {
                context.dispose();
                return false;
            },
        },
    ];

    return (
        <Wizard
            icon={<CreateDatabaseIcon aria-hidden="true" />}
            title={locConstants.deployment.deploymentHeader}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
        />
    );
};
