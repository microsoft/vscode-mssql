/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { Dropdown, Field, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import {
    AzureSqlDatabaseContextProps,
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseFormState,
    AzureSqlDatabaseState,
    AZURE_SQL_DB_COMPONENT_ORDER,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
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
import { DeploymentContext } from "../deploymentStateProvider";
import { useAzureSqlDatabaseDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
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
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
    },
    formLoadingLabel: {
        display: "flex",
        alignItems: "center",
        marginTop: 0,
        marginBottom: 0,
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

    const renderAzureField = (propertyName: keyof AzureSqlDatabaseFormState) => {
        const component = formComponents[propertyName];
        if (!component) return undefined;

        const loadStatus = azureComponentStatuses[propertyName];
        if (loadStatus === ApiStatus.NotStarted) {
            handleLoadAzureComponents();
        }

        if (loadStatus === ApiStatus.Loaded || loadStatus === ApiStatus.Error) {
            return (
                <div className={classes.fieldContainer}>
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
            );
        }

        // Loading or NotStarted — show spinner placeholder
        return (
            <div style={{ marginBottom: "2px" }}>
                <Field
                    label={
                        <div className={classes.formLoadingLabel}>
                            <Text>{component.label}</Text>
                            <Spinner size="extra-tiny" style={{ transform: "scale(0.8)" }} />
                        </div>
                    }>
                    <Dropdown
                        size="small"
                        placeholder={getLoadingPlaceholder(propertyName)}
                        style={{ marginTop: 0, width: "min(100%, 630px)" }}
                    />
                </Field>
            </div>
        );
    };

    const renderFormField = (propertyName: keyof AzureSqlDatabaseFormState) => {
        const component = formComponents[propertyName];
        if (!component) return undefined;
        return (
            <div className={classes.fieldContainer}>
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
                {renderAzureField("accountId")}
                {renderAzureField("tenantId")}
                {renderAzureField("subscriptionId")}
                {renderAzureField("resourceGroup")}
                {renderAzureField("serverName")}
                {renderFormField("databaseName")}
                {renderFormField("profileName")}
                <div className={classes.fieldContainer}>
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
            <div className={classes.bottomDiv} />
        </div>
    );
};
