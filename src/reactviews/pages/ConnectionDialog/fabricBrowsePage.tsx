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
    Link,
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
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IAzureAccount,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { AzureFilterCombobox } from "./AzureFilterCombobox.component";
import { FabricWorkspaceViewer } from "./components/fabricWorkspaceViewer";
import FabricWorkspaceFilter from "./components/fabricWorkspaceFilter";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";

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
});

export const fabricLogoColor = () => {
    return require(`../../media/fabric-color.svg`);
};

export const FabricBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    if (context === undefined) {
        return undefined;
    }

    const formStyles = useFormStyles();
    const styles = useStyles();

    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    const [servers, setServers] = useState<string[]>([]);
    const [selectedServer, setSelectedServer] = useState<string>("");
    const [serverValue, setServerValue] = useState<string>("");

    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDatabase, setSelectedDatabase] = useState<string>("");
    const [databaseValue, setDatabaseValue] = useState<string>("");

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

    function setSelectedServerWithFormState(server: string | undefined) {
        if (server === undefined && context?.state.formState.server === "") {
            return; // avoid unnecessary updates
        }

        setSelectedServer(server || "");

        let serverUri = "";

        if (server) {
            const srv = context?.state.azureServers.find((s) => s.server === server);
            serverUri = srv?.uri || "";
        }

        setConnectionProperty("server", serverUri);
    }

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

    return (
        <div>
            <EntraSignInEmpty
                loadAccountStatus={context.state.loadingAzureAccountsStatus}
                brandImageSource={fabricLogoColor()}
                signInText={Loc.connectionDialog.signIntoFabricToBrowse}
                linkText={Loc.connectionDialog.signIntoFabric}
                loadingText="Loading Fabric Accounts"
                onSignInClick={() => {
                    context.signIntoAzureForBrowse(ConnectionInputMode.FabricBrowse);
                }}
            />
            {context.state.loadingAzureAccountsStatus === ApiStatus.Loaded && (
                <>
                    <Field orientation="horizontal">
                        <Label>Fabric Account</Label>
                        <Dropdown
                            value={selectedAccountName}
                            selectedOptions={
                                context.state.selectedAccountId
                                    ? [context.state.selectedAccountId]
                                    : []
                            }
                            onOptionSelect={handleAccountChange}
                            placeholder="Select an account">
                            {accounts.map((account) => (
                                <Option key={account.id} value={account.id} text={account.name}>
                                    {account.name}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>
                    <Label>{Loc.connectionDialog.workspaces}</Label>
                    <div
                        style={{
                            paddingLeft: "6px",
                            paddingBottom: "6px",
                            paddingTop: "6px",
                        }}>
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
                            fabricWorkspacesLoadStatus={context.state.fabricWorkspacesLoadStatus}
                            fabricWorkspaces={context.state.fabricWorkspaces}
                            searchFilter={searchFilter}
                            typeFilter={typeFilter}
                            selectFabricWorkspace={context.selectFabricWorkspace}
                        />
                    </div>

                    {selectedServer && (
                        <>
                            <FormField<
                                IConnectionDialogProfile,
                                ConnectionDialogWebviewState,
                                ConnectionDialogFormItemSpec,
                                ConnectionDialogContextProps
                            >
                                context={context}
                                component={context.state.formComponents["trustServerCertificate"]!}
                                idx={0}
                                props={{ orientation: "horizontal" }}
                            />
                            <AzureFilterCombobox
                                label={Loc.connectionDialog.databaseLabel}
                                clearable
                                content={{
                                    valueList: databases,
                                    value: databaseValue,
                                    setValue: setDatabaseValue,
                                    selection: selectedDatabase,
                                    setSelection: (db) => {
                                        setSelectedDatabase(db ?? "");
                                        setConnectionProperty("database", db ?? "");
                                    },
                                    placeholder: `<${Loc.connectionDialog.default}>`,
                                    invalidOptionErrorMessage:
                                        Loc.connectionDialog.invalidAzureBrowse(
                                            Loc.connectionDialog.database,
                                        ),
                                }}
                            />
                            {context.state.connectionComponents.mainOptions
                                .filter(
                                    // filter out inputs that are manually placed above
                                    (opt) =>
                                        !["server", "database", "trustServerCertificate"].includes(
                                            opt,
                                        ),
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
                                        />
                                    );
                                })}
                        </>
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
