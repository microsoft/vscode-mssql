/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import {
    Button,
    Card,
    Link,
    Label,
    makeStyles,
    Radio,
    RadioGroup,
    Spinner,
    Text,
} from "@fluentui/react-components";
import {
    ArrowRight12Regular,
    ErrorCircleRegular,
    GiftRegular,
    LockClosedRegular,
    WarningFilled,
} from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import {
    AzureSqlDatabaseContextProps,
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseFormState,
    AzureSqlDatabaseState,
    AZURE_SQL_DB_COMPONENT_ORDER,
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
    pageContainer: {
        display: "flex",
        flexDirection: "row",
        gap: "24px",
        width: "100%",
        minHeight: "fit-content",
        padding: "4px 0 8px",
        boxSizing: "border-box",
    },
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        flex: "1 1 70%",
        minWidth: 0,
        minHeight: "fit-content",
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
    sidebarDiv: {
        flex: "0 0 280px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        alignSelf: "flex-start",
    },
    sidebarCard: {
        display: "flex",
        flexDirection: "column",
        padding: "8px 16px 16px 16px",
        gap: "0px",
        backgroundColor: "var(--colorNeutralBackground1Hover)",
    },
    sidebarCardHeader: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontWeight: 600,
        fontSize: "12px",
        paddingBottom: "8px",
    },
    sidebarDivider: {
        borderBottom: "1px solid var(--colorNeutralStroke2)",
        marginBottom: "8px",
    },
    sidebarRow: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        fontSize: "12px",
        padding: "3px 0",
    },
    sidebarLabel: {
        color: "var(--colorNeutralForeground4)",
    },
    sidebarValue: {
        textAlign: "right",
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
    linkDiv: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginLeft: "30px",
    },
});

import { TagEntry } from "./azureSqlDatabaseDeploymentWizard";

interface AzureSqlDatabaseFormPageProps {
    onValidated?: () => void;
    tags: TagEntry[];
    onTagsChange: (tags: TagEntry[]) => void;
}

export const AzureSqlDatabaseFormPage: React.FC<AzureSqlDatabaseFormPageProps> = ({
    onValidated,
    tags,
    onTagsChange,
}) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const loadState = useAzureSqlDatabaseDeploymentSelector((s) => s.loadState);
    const errorMessage = useAzureSqlDatabaseDeploymentSelector((s) => s.errorMessage);
    const formValidationLoadState = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.formValidationLoadState,
    );
    const dialog = useAzureSqlDatabaseDeploymentSelector((s) => s.dialog);
    const createResourceGroupDrawerState = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.createResourceGroupDrawerState,
    );
    const createServerDrawerState = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.createServerDrawerState,
    );
    const formState = useAzureSqlDatabaseDeploymentSelector((s) => s.formState);
    const formComponents = useAzureSqlDatabaseDeploymentSelector((s) => s.formComponents);
    const azureComponentStatuses = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.azureComponentStatuses,
    );
    const serverCreatedWithAuth = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.serverCreatedWithAuth,
    );
    const hostIp = useAzureSqlDatabaseDeploymentSelector((s) => s.publicIp);

    const [localAutoPauseDelay, setLocalAutoPauseDelay] = useState(
        String(formState.autoPauseDelay),
    );
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const prevFormValidationLoadState = useRef(formValidationLoadState);

    useEffect(() => {
        setLocalAutoPauseDelay(String(formState.autoPauseDelay));
    }, [formState.autoPauseDelay]);

    useEffect(() => {
        const changed = prevFormValidationLoadState.current !== formValidationLoadState;
        prevFormValidationLoadState.current = formValidationLoadState;
        if (changed && formValidationLoadState === ApiStatus.Loaded) {
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
            component.loadStatus = { status: ApiStatus.Loading };
            component.placeholder = getLoadingPlaceholder(propertyName);
        } else {
            component.loadStatus = { status: ApiStatus.Loaded };
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
                <div style={{ width: component.componentWidth || "100%" }}>
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
        <div className={classes.pageContainer}>
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
                    {createResourceGroupDrawerState && (
                        <CreateResourceGroupDrawer
                            state={createResourceGroupDrawerState}
                            onSubmit={(resourceGroupName, location) => {
                                context.submitCreateResourceGroup({
                                    resourceGroupName,
                                    location,
                                });
                            }}
                            onClose={() => context.setCreateResourceGroupDrawerState(false)}
                        />
                    )}
                    {createServerDrawerState && (
                        <CreateServerDrawer
                            state={createServerDrawerState}
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
                        !(serverCreatedWithAuth && formState.savePassword) && (
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
                                {renderFormField("savePassword")}
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
                    {localAutoPauseDelay === "-1" && (
                        <Card
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                backgroundColor: "var(--colorPaletteYellowBackground1)",
                                borderLeft: "3px solid var(--colorPaletteYellowForeground1)",
                                padding: "10px 12px",
                                gap: "6px",
                                marginLeft: "2px",
                            }}>
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: "10px",
                                }}>
                                <WarningFilled
                                    style={{
                                        color: "var(--colorStatusWarningForeground1)",
                                        fontSize: "20px",
                                        flexShrink: 0,
                                    }}
                                />
                                <span>{locConstants.azureSqlDatabase.continueChargesWarning}</span>
                            </div>
                            <Link className={classes.linkDiv} href="">
                                {locConstants.common.learnMore}
                                <ArrowRight12Regular style={{ marginTop: "2px" }} />
                            </Link>
                        </Card>
                    )}
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
                                component={
                                    formComponents["groupId"] as AzureSqlDatabaseFormItemSpec
                                }
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
                        context={context}
                        formState={formState}
                        formComponents={formComponents}
                        azureComponentStatuses={azureComponentStatuses}
                        hostIp={hostIp ?? ""}
                        tags={tags}
                        onTagsChange={onTagsChange}
                    />
                </div>
                <div className={classes.bottomDiv} />
            </div>
            <div className={classes.sidebarDiv}>
                <Card className={classes.sidebarCard}>
                    <span className={classes.sidebarCardHeader}>
                        <GiftRegular fontSize={16} />
                        {locConstants.azureSqlDatabase.freeOfferApplied}
                    </span>
                    <div className={classes.sidebarDivider} />
                    <Text size={200} style={{ color: "var(--colorNeutralForeground4)" }}>
                        {locConstants.azureSqlDatabase.monthlyLimits}
                    </Text>
                    <ul
                        style={{
                            margin: "4px 0 0",
                            paddingLeft: "20px",
                            fontSize: "12px",
                            color: "var(--colorNeutralForeground4)",
                        }}>
                        <li>{locConstants.azureSqlDatabase.freeVCoreLimit}</li>
                        <li>{locConstants.azureSqlDatabase.freeStorageLimit}</li>
                        <li>{locConstants.azureSqlDatabase.freeDatabaseLimit}</li>
                        <li>{locConstants.azureSqlDatabase.freeBackupType}</li>
                    </ul>
                    <div className={classes.sidebarDivider} style={{ marginTop: "8px" }} />
                    <Text size={200} style={{ color: "var(--colorNeutralForeground4)" }}>
                        {locConstants.azureSqlDatabase.freeSettingsFixed}
                    </Text>
                </Card>
                <Card className={classes.sidebarCard}>
                    <span className={classes.sidebarCardHeader}>
                        <LockClosedRegular fontSize={16} />
                        {locConstants.azureSqlDatabase.computeAndStorage}
                    </span>
                    <div className={classes.sidebarDivider} />
                    <div className={classes.sidebarRow}>
                        <span className={classes.sidebarLabel}>
                            {locConstants.azureSqlDatabase.serviceTier}
                        </span>
                        <span className={classes.sidebarValue}>
                            {locConstants.azureSqlDatabase.generalPurpose}
                        </span>
                    </div>
                    <div className={classes.sidebarRow}>
                        <span className={classes.sidebarLabel}>
                            {locConstants.azureSqlDatabase.compute}
                        </span>
                        <span className={classes.sidebarValue}>
                            {locConstants.azureSqlDatabase.serverless}
                        </span>
                    </div>
                    <div className={classes.sidebarRow}>
                        <span className={classes.sidebarLabel}>
                            {locConstants.azureSqlDatabase.vCores}
                        </span>
                        <span className={classes.sidebarValue}>
                            {locConstants.azureSqlDatabase.defaultVCores}
                        </span>
                    </div>
                    <div className={classes.sidebarRow}>
                        <span className={classes.sidebarLabel}>
                            {locConstants.azureSqlDatabase.storage}
                        </span>
                        <span className={classes.sidebarValue}>
                            {locConstants.azureSqlDatabase.defaultStorage}
                        </span>
                    </div>
                    <div className={classes.sidebarRow}>
                        <span className={classes.sidebarLabel}>
                            {locConstants.azureSqlDatabase.backup}
                        </span>
                        <span className={classes.sidebarValue}>
                            {locConstants.azureSqlDatabase.defaultBackup}
                        </span>
                    </div>
                    <div className={classes.sidebarRow}>
                        <span className={classes.sidebarLabel}>
                            {locConstants.azureSqlDatabase.autoPause}
                        </span>
                        <span className={classes.sidebarValue}>
                            {locConstants.azureSqlDatabase.defaultAutoPause}
                        </span>
                    </div>
                </Card>
            </div>
        </div>
    );
};
