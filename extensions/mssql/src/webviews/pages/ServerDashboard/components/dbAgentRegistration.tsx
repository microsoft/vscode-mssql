/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Spinner, Text } from "@fluentui/react-components";
import { CheckmarkCircle20Regular, ShieldTask20Regular } from "@fluentui/react-icons";
import { type JSX } from "react";
import { DbAgentRegistrationMode } from "../../../../sharedInterfaces/serverDashboard";
import { getDashboardLoc } from "../dashboardLabels";

export interface DbAgentRegistrationProps {
    registrationMode: DbAgentRegistrationMode;
    onRegister: () => void;
}

export function DbAgentRegistration({
    registrationMode,
    onRegister,
}: DbAgentRegistrationProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();

    if (registrationMode === "registering") {
        return (
            <div className="dashboard-tab-content dashboard-agent-onboarding">
                <Card className="dashboard-agent-registration-card">
                    <Spinner size="large" />
                    <Text as="h2" size={600} weight="semibold">
                        {dashboardLoc.registrationInProgress}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.registrationInProgressDescription}
                    </Text>
                </Card>
            </div>
        );
    }

    if (registrationMode === "notEligible") {
        return (
            <div className="dashboard-tab-content dashboard-agent-onboarding">
                <Card className="dashboard-agent-registration-card">
                    <ShieldTask20Regular className="dashboard-agent-onboarding-icon" />
                    <Text as="h2" size={600} weight="semibold">
                        {dashboardLoc.registrationUnavailable}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.registrationUnavailableDescription}
                    </Text>
                </Card>
            </div>
        );
    }

    return (
        <div className="dashboard-tab-content dashboard-agent-onboarding">
            <Card className="dashboard-agent-registration-card">
                <div className="dashboard-agent-onboarding-title">
                    <ShieldTask20Regular className="dashboard-agent-onboarding-icon" />
                    <div>
                        <Text as="h2" size={600} weight="semibold">
                            {dashboardLoc.agentReadyTitle}
                        </Text>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.agentReadyDescription}
                        </Text>
                    </div>
                </div>
                <div className="dashboard-agent-registration-steps">
                    <RegistrationStep
                        number={1}
                        title={dashboardLoc.connectTelemetry}
                        description={dashboardLoc.connectTelemetryDescription}
                    />
                    <RegistrationStep
                        number={2}
                        title={dashboardLoc.configureGuardrails}
                        description={dashboardLoc.configureGuardrailsDescription}
                    />
                    <RegistrationStep
                        number={3}
                        title={dashboardLoc.startMonitoring}
                        description={dashboardLoc.startMonitoringDescription}
                    />
                </div>
                <div>
                    <Button
                        appearance="primary"
                        icon={<CheckmarkCircle20Regular />}
                        onClick={onRegister}>
                        {dashboardLoc.registerDatabaseAgent}
                    </Button>
                </div>
            </Card>
        </div>
    );
}

interface RegistrationStepProps {
    number: number;
    title: string;
    description: string;
}

function RegistrationStep({ number, title, description }: RegistrationStepProps): JSX.Element {
    return (
        <div className="dashboard-agent-registration-step">
            <span>{number}</span>
            <div>
                <Text weight="semibold">{title}</Text>
                <Text className="dashboard-secondary-text">{description}</Text>
            </div>
        </div>
    );
}
