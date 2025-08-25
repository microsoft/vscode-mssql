/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useState, useEffect } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import {
    Button,
    Field,
    InputOnChangeData,
    Label,
    makeStyles,
    MenuCheckedValueChangeData,
    MenuCheckedValueChangeEvent,
    Dropdown,
    Option,
    OptionOnSelectData,
    SelectionEvents,
} from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    AuthenticationType,
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    FabricSqlDbInfo,
    IAzureAccount,
    IConnectionDialogProfile,
    SqlArtifactTypes,
} from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { FabricWorkspaceViewer } from "./components/fabricWorkspaceViewer";
import FabricWorkspaceFilter from "./components/fabricWorkspaceFilter";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";
import { useItemGroupStyles } from "../../common/styles";

const useStyles = makeStyles({
    icon: {
        width: "75px",
        height: "75px",
        marginBottom: "10px",
    },
    notSignedInContainer: {
        marginTop: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
    },
    signInLink: {
        marginTop: "8px",
    },
    formRow: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    workspaceContainer: {
        backgroundColor: "var(--vscode-editor-background)",
        borderRadius: "4px",
        border: "1px solid var(--vscode-panel-border)",
    },
    workspaceContentPadding: {
        paddingLeft: "6px",
        paddingBottom: "6px",
        paddingTop: "6px",
    },
});

export const fabricLogoColor = () => {
    return require(`../../media/fabric-color.svg`);
};

const fabricAuthOptions: (keyof IConnectionDialogProfile)[] = [
    "authenticationType",
    "accountId",
    "tenantId",
];

export const FabricBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    if (context === undefined) {
        return undefined;
    }

    const styles = useStyles();
    const formStyles = useFormStyles();
    const itemGroupStyles = useItemGroupStyles();

    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    const [searchFilter, setSearchFilter] = useState<string>("");
    const [typeFilter, setTypeFilter] = useState<string[]>(["Show All"]);

    const [accounts, setAccounts] = useState<IAzureAccount[]>([]);
    // const [selectedAccountId, setSelectedAccountId] = useState<string>("");
    const [selectedAccountName, setSelectedAccountName] = useState<string>("");

    // Load accounts from state when component mounts
    useEffect(() => {
        if (
            context.state.loadingAzureAccountsStatus === ApiStatus.Loaded &&
            context.state.azureAccounts
        ) {
            setAccounts(context.state.azureAccounts);

            // Sync selectedAccountName with the globally stored selectedAccountId
            if (context.state.selectedAccountId) {
                const selectedAccount = context.state.azureAccounts.find(
                    (account) => account.id === context.state.selectedAccountId,
                );
                if (selectedAccount) {
                    setSelectedAccountName(selectedAccount.name);
                }
            } else if (context.state.azureAccounts.length > 0) {
                // Set the first account as selected if no account is currently selected
                handleAccountChange({} as any, {
                    optionText: context.state.azureAccounts[0].name,
                    optionValue: context.state.azureAccounts[0].id,
                    selectedOptions: [context.state.azureAccounts[0].id],
                });
            }
        }
    }, [
        context.state.loadingAzureAccountsStatus,
        context.state.azureAccounts,
        context.state.selectedAccountId,
    ]);

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    function handleSearchInputChanged(_: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) {
        setSearchFilter(data.value);
    }

    function handleFilterOptionChanged(
        _: MenuCheckedValueChangeEvent,
        { name, checkedItems }: MenuCheckedValueChangeData,
    ) {
        if (name === "sqlType") {
            setTypeFilter(checkedItems);
        }
    }

    function handleAccountChange(_event: SelectionEvents, data: OptionOnSelectData) {
        const accountName = data.optionText || "";
        const accountId = data.optionValue || "";
        setSelectedAccountName(accountName);
        // setSelectedAccountId(accountId);

        context!.selectAzureAccount(accountId);
    }

    function handleServerSelected(selectedServer: FabricSqlDbInfo) {
        switch (selectedServer.type) {
            case SqlArtifactTypes.SqlAnalyticsEndpoint: {
                // TODO: RPC to fetch server name
                console.error("Selecting Fabric SQL Endpoints is not yet supported.");
                return;

                const serverUrl = "TODO";
                setConnectionProperty("server", serverUrl);
                setConnectionProperty("profileName", selectedServer.displayName);
                setConnectionProperty("azureAuthType", AuthenticationType.AzureMFA);
            }
            case SqlArtifactTypes.SqlDatabase:
                setConnectionProperty("server", selectedServer.server);
                setConnectionProperty("database", selectedServer.database);
                setConnectionProperty("profileName", selectedServer.displayName);
                setConnectionProperty("authenticationType", AuthenticationType.AzureMFA);

                return;
            default:
                console.error("Unknown server type selected.");
        }
    }

    return (
        <div>
            <EntraSignInEmpty
                loadAccountStatus={context.state.loadingAzureAccountsStatus}
                brandImageSource={fabricLogoColor()}
                signInText={Loc.connectionDialog.signIntoFabricToBrowse}
                linkText={Loc.connectionDialog.signIntoFabric}
                loadingText={Loc.connectionDialog.loadingFabricAccounts}
                onSignInClick={() => {
                    context.signIntoAzureForBrowse(ConnectionInputMode.FabricBrowse);
                }}
            />
            {context.state.loadingAzureAccountsStatus === ApiStatus.Loaded && (
                <>
                    <div className={formStyles.formComponentDiv}>
                        <Field orientation="horizontal">
                            <Label>{Loc.connectionDialog.fabricAccount}</Label>
                            <Dropdown
                                value={selectedAccountName}
                                selectedOptions={
                                    context.state.selectedAccountId
                                        ? [context.state.selectedAccountId]
                                        : []
                                }
                                onOptionSelect={handleAccountChange}
                                placeholder={Loc.connectionDialog.selectAnAccount}>
                                {accounts.map((account) => (
                                    <Option key={account.id} value={account.id} text={account.name}>
                                        {account.name}
                                    </Option>
                                ))}
                            </Dropdown>
                        </Field>
                    </div>

                    <Label>{Loc.connectionDialog.fabricWorkspaces}</Label>
                    <div className={styles.workspaceContainer}>
                        <div className={styles.workspaceContentPadding}>
                            <FabricWorkspaceFilter
                                onSearchInputChanged={handleSearchInputChanged}
                                onFilterOptionChanged={handleFilterOptionChanged}
                                searchValue={searchFilter}
                                selectedTypeFilters={typeFilter}
                                selectTenantId={(id) => {
                                    context.selectAzureTenant(id);
                                }}
                                azureTenants={context.state.azureTenants}
                                selectedTenantId={context.state.selectedTenantId}
                            />
                            <FabricWorkspaceViewer
                                fabricWorkspacesLoadStatus={
                                    context.state.fabricWorkspacesLoadStatus
                                }
                                fabricWorkspaces={context.state.fabricWorkspaces}
                                searchFilter={searchFilter}
                                typeFilter={typeFilter}
                                selectFabricWorkspace={context.selectFabricWorkspace}
                                onSelectDatabase={handleServerSelected}
                            />
                        </div>
                    </div>

                    {context.state.formState.server && (
                        <div className={itemGroupStyles.itemGroup}>
                            {context.state.connectionComponents.mainOptions
                                .filter(
                                    (opt) => fabricAuthOptions.includes(opt), // filter to only necessary auth options
                                )
                                .map((inputName, idx) => {
                                    const component =
                                        context.state.formComponents[
                                            inputName as keyof IConnectionDialogProfile
                                        ];
                                    if (component?.hidden !== false) {
                                        return undefined;
                                    }

                                    return (
                                        <FormField<
                                            IConnectionDialogProfile,
                                            ConnectionDialogWebviewState,
                                            ConnectionDialogFormItemSpec,
                                            ConnectionDialogContextProps
                                        >
                                            key={idx}
                                            context={context}
                                            component={component}
                                            idx={idx}
                                            props={{ orientation: "horizontal" }}
                                            componentProps={{
                                                disabled: inputName === "authenticationType",
                                            }}
                                        />
                                    );
                                })}
                        </div>
                    )}

                    <AdvancedOptionsDrawer
                        isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                        setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
                    />
                    <div className={formStyles.formNavTray}>
                        <Button
                            onClick={(_event) => {
                                setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                            }}
                            className={formStyles.formNavTrayButton}>
                            {Loc.connectionDialog.advancedSettings}
                        </Button>
                        <div className={formStyles.formNavTrayRight}>
                            <ConnectButton className={formStyles.formNavTrayButton} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
