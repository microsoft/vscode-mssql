/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Switch, Text, Textarea } from "@fluentui/react-components";
import { Add20Regular, Delete20Regular, Save20Regular } from "@fluentui/react-icons";
import { type JSX, useEffect, useState } from "react";
import {
    DbAgentInstruction,
    DbAgentRegistrationMode,
    DbAgentSettings,
} from "../../../../sharedInterfaces/serverDashboard";
import {
    getDashboardLoc,
    getIssueCategoryLabel,
    getRegistrationModeLabel,
    getRoleDescription,
    getRoleLabel,
} from "../dashboardLabels";

export interface DbAgentPoliciesProps {
    instructions: DbAgentInstruction[];
    onCreateInstruction: (text: string) => void;
    onRevokeInstruction: (instructionId: string) => void;
}

export function DbAgentPolicies({
    instructions,
    onCreateInstruction,
    onRevokeInstruction,
}: DbAgentPoliciesProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [instructionText, setInstructionText] = useState("");

    const createInstruction = (): void => {
        const text = instructionText.trim();
        if (!text) {
            return;
        }
        onCreateInstruction(text);
        setInstructionText("");
    };

    return (
        <section className="dashboard-agent-section">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h3" size={500} weight="semibold">
                        {dashboardLoc.customInstructions}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.customInstructionsDescription}
                    </Text>
                </div>
            </div>
            <Card className="dashboard-agent-instruction-composer">
                <Textarea
                    resize="vertical"
                    value={instructionText}
                    placeholder={dashboardLoc.instructionPlaceholder}
                    onChange={(_, data) => setInstructionText(data.value)}
                />
                <div>
                    <Button
                        appearance="primary"
                        icon={<Add20Regular />}
                        disabled={!instructionText.trim()}
                        onClick={createInstruction}>
                        {dashboardLoc.addInstruction}
                    </Button>
                </div>
            </Card>
            <div className="dashboard-agent-instructions">
                {instructions.map((instruction) => (
                    <Card key={instruction.instructionId}>
                        <div className="dashboard-agent-instruction-header">
                            <Text>{instruction.text}</Text>
                            <Button
                                appearance="subtle"
                                icon={<Delete20Regular />}
                                onClick={() => onRevokeInstruction(instruction.instructionId)}>
                                {dashboardLoc.revoke}
                            </Button>
                        </div>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.createdByAt(
                                instruction.createdBy,
                                formatDateTime(instruction.createdAt),
                            )}
                        </Text>
                    </Card>
                ))}
            </div>
        </section>
    );
}

export interface DbAgentSettingsPanelProps {
    settings: DbAgentSettings;
    onSave: (settings: DbAgentSettings) => void;
}

export function DbAgentSettingsPanel({ settings, onSave }: DbAgentSettingsPanelProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [draft, setDraft] = useState(settings);

    useEffect(() => setDraft(settings), [settings]);

    const updateCategory = (
        category: DbAgentSettings["actionCategories"][number]["category"],
        change: Partial<DbAgentSettings["actionCategories"][number]>,
    ): void => {
        setDraft((current) => ({
            ...current,
            actionCategories: current.actionCategories.map((setting) =>
                setting.category === category ? { ...setting, ...change } : setting,
            ),
        }));
    };

    return (
        <section className="dashboard-agent-section">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h3" size={500} weight="semibold">
                        {dashboardLoc.agentSettings}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.agentSettingsDescription}
                    </Text>
                </div>
            </div>
            <Card className="dashboard-agent-settings-card">
                <Text as="h4" size={400} weight="semibold">
                    {dashboardLoc.notifications}
                </Text>
                <Switch
                    checked={draft.notifyOnResolve}
                    label={dashboardLoc.notifyOnResolve}
                    onChange={(_, data) =>
                        setDraft((current) => ({
                            ...current,
                            notifyOnResolve: data.checked,
                        }))
                    }
                />
                <Switch
                    checked={draft.notifyOnFailure}
                    label={dashboardLoc.notifyOnFailure}
                    onChange={(_, data) =>
                        setDraft((current) => ({
                            ...current,
                            notifyOnFailure: data.checked,
                        }))
                    }
                />
            </Card>
            <Card className="dashboard-agent-settings-card">
                <Text as="h4" size={400} weight="semibold">
                    {dashboardLoc.actionPermissions}
                </Text>
                <div className="dashboard-agent-permission-grid">
                    {draft.actionCategories.map((setting) => {
                        const categoryLabel = getIssueCategoryLabel(setting.category);
                        return (
                            <div key={setting.category}>
                                <div>
                                    <Text weight="semibold">
                                        {dashboardLoc.actionCategory(categoryLabel)}
                                    </Text>
                                    <Badge appearance="outline">{categoryLabel}</Badge>
                                </div>
                                <Switch
                                    checked={setting.enabled}
                                    label={dashboardLoc.allowActions}
                                    onChange={(_, data) =>
                                        updateCategory(setting.category, {
                                            enabled: data.checked,
                                        })
                                    }
                                />
                                <Switch
                                    checked={setting.approvalRequired}
                                    disabled={!setting.enabled}
                                    label={dashboardLoc.requireApproval}
                                    onChange={(_, data) =>
                                        updateCategory(setting.category, {
                                            approvalRequired: data.checked,
                                        })
                                    }
                                />
                            </div>
                        );
                    })}
                </div>
            </Card>
            <div>
                <Button appearance="primary" icon={<Save20Regular />} onClick={() => onSave(draft)}>
                    {dashboardLoc.saveSettings}
                </Button>
            </div>
        </section>
    );
}

export interface DbAgentAccessProps {
    settings: DbAgentSettings;
    registrationMode: DbAgentRegistrationMode;
}

export function DbAgentAccess({ settings, registrationMode }: DbAgentAccessProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    return (
        <section className="dashboard-agent-section">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h3" size={500} weight="semibold">
                        {dashboardLoc.accessAndRoles}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.accessDescription}
                    </Text>
                </div>
            </div>
            <div className="dashboard-agent-access-grid">
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.currentRole}</Text>
                    <div className="dashboard-heading-with-badge">
                        <Text size={500} weight="semibold">
                            {getRoleLabel(settings.currentRole)}
                        </Text>
                        <Badge appearance="tint" color="success">
                            {getRoleLabel(settings.currentRole)}
                        </Badge>
                    </div>
                    <Text>{getRoleDescription(settings.currentRole)}</Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.approvingAdmin}</Text>
                    <Text size={500} weight="semibold">
                        {settings.approvingAdmin}
                    </Text>
                    <Text>{dashboardLoc.approvalRequired}</Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.registrationStatus}
                    </Text>
                    <Text size={500} weight="semibold">
                        {getRegistrationModeLabel(registrationMode)}
                    </Text>
                    <Badge
                        appearance="tint"
                        color={registrationMode === "registered" ? "success" : "warning"}>
                        {getRegistrationModeLabel(registrationMode)}
                    </Badge>
                </Card>
            </div>
        </section>
    );
}

function formatDateTime(timestamp: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(timestamp));
}
