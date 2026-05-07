/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    Link,
    Label,
    makeStyles,
    Radio,
    RadioGroup,
    Spinner,
    Text,
} from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import {
    AzureSqlDatabaseContextProps,
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseFormState,
    AzureSqlDatabaseState,
    AZURE_SQL_DB_COMPONENT_ORDER,
    CreateResourceGroupDrawerProps,
    CreateServerDrawerProps,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { AuthenticationType } from "../../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../../common/locConstants";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../../sharedInterfaces/connectionGroup";
import {
    renderColorSwatch,
    SearchableDropdownOptions,
} from "../../../common/searchableDropdown.component";
import { ConnectionGroupDialog } from "../../ConnectionGroup/connectionGroup.component";
import { CreateResourceGroupDrawer } from "./createResourceGroupDrawer";
import { CreateServerDrawer } from "./createServerDrawer";
import { AdvancedOptionsDrawer } from "./advancedOptionsDrawer";
import { DeploymentContext } from "../deploymentStateProvider";
import { useAzureSqlDatabaseDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "75%",
        minHeight: "fit-content",
        padding: "4px 0 8px",
        boxSizing: "border-box",
        whiteSpace: "normal",
    },
    formDiv: {
        flexGrow: 1,
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    spinnerDiv: {
        height: "100%",
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
    fieldContainer: {
        width: "100%",
        display: "flex",
        flexDirection: "row",
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
    },
    bottomDiv: {
        paddingBottom: "8px",
    },
});

interface AzureSqlDatabaseFormPageProps {
    onValidated?: () => void;
}

export const AzureSqlDatabaseFormPage: React.FC<AzureSqlDatabaseFormPageProps> = ({
    onValidated,
}) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const loadState = useAzureSqlDatabaseDeploymentSelector((s) => s.loadState);
    const errorMessage = useAzureSqlDatabaseDeploymentSelector((s) => s.errorMessage);
    const formValidationLoadState = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.formValidationLoadState,
    );
    const dialog = useAzureSqlDatabaseDeploymentSelector((s) => s.dialog);
    const formState = useAzureSqlDatabaseDeploymentSelector((s) => s.formState);
    const formComponents = useAzureSqlDatabaseDeploymentSelector((s) => s.formComponents);
    const azureComponentStatuses = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.azureComponentStatuses,
    );
    const serverCreatedWithAuth = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.serverCreatedWithAuth,
    );

    const [localAutoPauseDelay, setLocalAutoPauseDelay] = useState(
        String(formState.autoPauseDelay),
    );
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    useEffect(() => {
        setLocalAutoPauseDelay(String(formState.autoPauseDelay));
    }, [formState.autoPauseDelay]);

    useEffect(() => {
        if (formValidationLoadState === ApiStatus.Loaded) {
            onValidated?.();
        }
    }, [formValidationLoadState, onValidated]);

    if (!context || !formState) return undefined;

    /**
     * Finds the first Azure component that is NotStarted and whose upstream
     * prerequisites are satisfied (all prior components have values), then triggers its load.
     */
    const handleLoadAzureComponents = () => {
        if (!context || !azureComponentStatuses) return;

        const order = AZURE_SQL_DB_COMPONENT_ORDER as readonly string[];
        for (const name of order) {
            if (azureComponentStatuses[name] === ApiStatus.NotStarted) {
                // Check that all upstream components have values
                const idx = order.indexOf(name);
                const upstreamReady = order
                    .slice(0, idx)
                    .every((prev) => !!(formState as unknown as Record<string, string>)[prev]);
                if (upstreamReady) {
                    context.loadAzureComponent(name);
                }
                return;
            }
        }
    };

    if (loadState === ApiStatus.Loading) {
        return (
            <div className={classes.spinnerDiv}>
                <Spinner
                    label={locConstants.azureSqlDatabase.loadingAzureSqlDatabase}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (loadState === ApiStatus.Error) {
        return (
            <div className={classes.spinnerDiv}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <Text size={400}>{errorMessage ?? ""}</Text>
            </div>
        );
    }

    const getLoadingPlaceholder = (propertyName: keyof AzureSqlDatabaseFormState): string => {
        switch (propertyName) {
            case "accountId":
                return locConstants.azureSqlDatabase.loadingAzureAccounts;
            case "tenantId":
                return locConstants.azureSqlDatabase.loadingTenants;
            case "subscriptionId":
                return locConstants.azureSqlDatabase.loadingSubscriptions;
            case "resourceGroup":
                return locConstants.azureSqlDatabase.loadingResourceGroups;
            case "serverName":
                return locConstants.azureSqlDatabase.loadingServers;
            default:
                return "";
        }
    };

    const isComponentReady = (propertyName: string): boolean => {
        return azureComponentStatuses[propertyName] === ApiStatus.Loaded;
    };

    const renderAzureField = (
        propertyName: keyof AzureSqlDatabaseFormState,
        createNewAction?: { label: string; disabled: boolean; onClick: () => void },
    ) => {
        const component = formComponents[propertyName];
        if (!component) return undefined;

        const loadStatus = azureComponentStatuses[propertyName];
        if (loadStatus === ApiStatus.NotStarted) {
            handleLoadAzureComponents();
        }

        const isLoading = loadStatus === ApiStatus.Loading || loadStatus === ApiStatus.NotStarted;
        if (isLoading) {
            component.loading = true;
            component.placeholder = getLoadingPlaceholder(propertyName);
        } else {
            component.loading = false;
        }

        return (
            <div className={classes.fieldContainer}>
                <div style={{ flex: 1, width: "100%" }}>
                    <FormField<
                        AzureSqlDatabaseFormState,
                        AzureSqlDatabaseState,
                        AzureSqlDatabaseFormItemSpec,
                        AzureSqlDatabaseContextProps
                    >
                        context={context}
                        formState={formState}
                        component={component}
                        idx={0}
                    />
                </div>
                {createNewAction && (
                    <Link
                        as="button"
                        disabled={createNewAction.disabled}
                        onClick={createNewAction.onClick}
                        style={{
                            textDecoration: "none",
                            fontSize: "12px",
                            alignSelf: "flex-end",
                            marginBottom: "12px",
                        }}>
                        {createNewAction.label}
                    </Link>
                )}
            </div>
        );
    };

    const renderFormField = (propertyName: keyof AzureSqlDatabaseFormState) => {
        const component = formComponents[propertyName];
        if (!component) return undefined;
        return (
            <div className={classes.fieldContainer}>
                <div style={{ flex: 1, width: "100%" }}>
                    <FormField<
                        AzureSqlDatabaseFormState,
                        AzureSqlDatabaseState,
                        AzureSqlDatabaseFormItemSpec,
                        AzureSqlDatabaseContextProps
                    >
                        context={context}
                        formState={formState}
                        component={component}
                        idx={0}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className={classes.outerDiv}>
            <div className={classes.formDiv}>
                {dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        mode="modal"
                        state={(dialog as CreateConnectionGroupDialogProps).props}
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={() => context.setConnectionGroupDialogState(false)}
                    />
                )}
                {dialog?.type === "createResourceGroup" && (
                    <CreateResourceGroupDrawer
                        state={(dialog as CreateResourceGroupDrawerProps).props}
                        onSubmit={(resourceGroupName, location) => {
                            context.submitCreateResourceGroup({
                                resourceGroupName,
                                location,
                            });
                        }}
                        onClose={() => context.setCreateResourceGroupDrawerState(false)}
                    />
                )}
                {dialog?.type === "createServer" && (
                    <CreateServerDrawer
                        state={(dialog as CreateServerDrawerProps).props}
                        onSubmit={(
                            serverName,
                            location,
                            authenticationType,
                            adminLogin,
                            adminPassword,
                            savePassword,
                        ) => {
                            context.submitCreateServer({
                                serverName,
                                location,
                                authenticationType,
                                adminLogin,
                                adminPassword,
                                savePassword,
                            });
                        }}
                        onClose={() => context.setCreateServerDrawerState(false)}
                    />
                )}
                {renderAzureField("accountId")}
                {renderAzureField("tenantId")}
                {renderAzureField("subscriptionId")}
                {renderAzureField("resourceGroup", {
                    label: locConstants.azureSqlDatabase.createNew,
                    disabled: !isComponentReady("subscriptionId"),
                    onClick: () => context.setCreateResourceGroupDrawerState(true),
                })}
                {renderAzureField("serverName", {
                    label: locConstants.azureSqlDatabase.createNew,
                    disabled: !isComponentReady("resourceGroup"),
                    onClick: () => context.setCreateServerDrawerState(true),
                })}
                {renderFormField("databaseName")}
                {formState.authenticationType !== AuthenticationType.AzureMFA &&
                    !serverCreatedWithAuth &&
                    !formState.savePassword && (
                        <>
                            <div className={classes.fieldContainer}>
                                <div style={{ flex: 1, width: "100%" }}>
                                    <FormField<
                                        AzureSqlDatabaseFormState,
                                        AzureSqlDatabaseState,
                                        AzureSqlDatabaseFormItemSpec,
                                        AzureSqlDatabaseContextProps
                                    >
                                        context={context}
                                        formState={formState}
                                        component={
                                            formComponents[
                                                "userName"
                                            ] as AzureSqlDatabaseFormItemSpec
                                        }
                                        idx={0}
                                        componentProps={{
                                            readOnly: !!formState.userName,
                                        }}
                                    />
                                </div>
                            </div>
                            {renderFormField("password")}
                            <div style={{ width: "320px" }}>
                                <FormField<
                                    AzureSqlDatabaseFormState,
                                    AzureSqlDatabaseState,
                                    AzureSqlDatabaseFormItemSpec,
                                    AzureSqlDatabaseContextProps
                                >
                                    context={context}
                                    formState={formState}
                                    component={
                                        formComponents[
                                            "savePassword"
                                        ] as AzureSqlDatabaseFormItemSpec
                                    }
                                    idx={0}
                                />
                            </div>
                        </>
                    )}
                <div className={classes.fieldContainer}>
                    <div style={{ flex: 1, width: "100%" }}>
                        <Label weight="semibold">
                            {locConstants.azureSqlDatabase.freeLimitBehavior}
                        </Label>
                        <RadioGroup
                            value={localAutoPauseDelay}
                            onChange={(_e, data) => {
                                setLocalAutoPauseDelay(data.value);
                                context.formAction({
                                    propertyName: "autoPauseDelay",
                                    isAction: false,
                                    value: Number(data.value),
                                });
                            }}>
                            <div>
                                <Radio
                                    value="60"
                                    label={locConstants.azureSqlDatabase.autoPauseOption}
                                />
                                <Text
                                    size={200}
                                    style={{
                                        display: "block",
                                        color: "var(--vscode-descriptionForeground)",
                                        marginLeft: "36px",
                                        marginTop: "-4px",
                                    }}>
                                    {locConstants.azureSqlDatabase.autoPauseDescription}
                                </Text>
                            </div>
                            <div>
                                <Radio
                                    value="-1"
                                    label={locConstants.azureSqlDatabase.continueChargesOption}
                                />
                                <Text
                                    size={200}
                                    style={{
                                        display: "block",
                                        color: "var(--vscode-descriptionForeground)",
                                        marginLeft: "36px",
                                        marginTop: "-4px",
                                    }}>
                                    {locConstants.azureSqlDatabase.continueChargesDescription}
                                </Text>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
                {renderFormField("profileName")}
                <div className={classes.fieldContainer}>
                    <div style={{ flex: 1, width: "100%" }}>
                        <FormField<
                            AzureSqlDatabaseFormState,
                            AzureSqlDatabaseState,
                            AzureSqlDatabaseFormItemSpec,
                            AzureSqlDatabaseContextProps
                        >
                            context={context}
                            formState={formState}
                            component={formComponents["groupId"] as AzureSqlDatabaseFormItemSpec}
                            idx={0}
                            componentProps={{
                                onSelect: (option: SearchableDropdownOptions) => {
                                    if (option.value === CREATE_NEW_GROUP_ID) {
                                        context.setConnectionGroupDialogState(true);
                                    } else {
                                        context.formAction({
                                            propertyName: "groupId",
                                            isAction: false,
                                            value: option.value,
                                        });
                                    }
                                },
                                renderDecoration: (option: SearchableDropdownOptions) => {
                                    return renderColorSwatch(option.color);
                                },
                            }}
                        />
                    </div>
                </div>
                <Button
                    appearance="outline"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => setIsAdvancedDrawerOpen(true)}>
                    {locConstants.azureSqlDatabase.advanced}
                </Button>
                <AdvancedOptionsDrawer
                    open={isAdvancedDrawerOpen}
                    onClose={() => setIsAdvancedDrawerOpen(false)}
                />
            </div>
            <div className={classes.bottomDiv} />
        </div>
    );
};
