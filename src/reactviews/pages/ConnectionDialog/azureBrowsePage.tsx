/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import { Button, makeStyles, Spinner } from "@fluentui/react-components";
import { Filter16Filled } from "@fluentui/react-icons";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { removeDuplicates } from "../../common/utils";
import { DefaultSelectionMode, updateComboboxSelection } from "../../common/comboboxHelper";
import { AzureFilterCombobox } from "./AzureFilterCombobox.component";
import { EntraSignInEmpty } from "./components/entraSignInEmpty.component";

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

export const azureLogoColor = () => {
    return require(`../../media/azure-color.svg`);
};

export const AzureBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    if (context === undefined) {
        return undefined;
    }

    const formStyles = useFormStyles();

    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    const [subscriptions, setSubscriptions] = useState<string[]>([]);
    const [selectedSubscription, setSelectedSubscription] = useState<string | undefined>(undefined);
    const [subscriptionValue, setSubscriptionValue] = useState<string>("");

    const [resourceGroups, setResourceGroups] = useState<string[]>([]);
    const [selectedResourceGroup, setSelectedResourceGroup] = useState<string | undefined>(
        undefined,
    );
    const [resourceGroupValue, setResourceGroupValue] = useState<string>("");

    const [locations, setLocations] = useState<string[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<string | undefined>(undefined);
    const [locationValue, setLocationValue] = useState<string>("");

    const [servers, setServers] = useState<string[]>([]);
    const [selectedServer, setSelectedServer] = useState<string | undefined>(undefined);
    const [serverValue, setServerValue] = useState<string>("");

    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDatabase, setSelectedDatabase] = useState<string | undefined>(undefined);
    const [databaseValue, setDatabaseValue] = useState<string>("");

    function setSelectedServerWithFormState(server: string | undefined) {
        if (server === undefined && context?.state.formState.server === "") {
            return; // avoid unnecessary updates
        }

        setSelectedServer(server);

        let serverUri = "";

        if (server) {
            const srv = context?.state.azureServers.find((s) => s.server === server);
            serverUri = srv?.uri || "";
        }

        setConnectionProperty("server", serverUri);
    }

    // #region Effects

    // subscriptions
    useEffect(() => {
        const subs = removeDuplicates(
            context.state.azureSubscriptions.map((sub) => `${sub.name} (${sub.id})`),
        );
        setSubscriptions(subs.sort());

        updateComboboxSelection(
            selectedSubscription,
            setSelectedSubscription,
            setSubscriptionValue,
            subs,
            DefaultSelectionMode.AlwaysSelectNone,
        );
    }, [context.state.azureSubscriptions]);

    // resource groups
    useEffect(() => {
        let activeServers = context.state.azureServers;

        if (selectedSubscription) {
            activeServers = activeServers.filter(
                (server) => server.subscription === selectedSubscription,
            );
        }

        const rgs = removeDuplicates(activeServers.map((server) => server.resourceGroup));
        setResourceGroups(rgs.sort());

        updateComboboxSelection(
            selectedResourceGroup,
            setSelectedResourceGroup,
            setResourceGroupValue,
            rgs,
            DefaultSelectionMode.AlwaysSelectNone,
        );
    }, [subscriptions, selectedSubscription, context.state.azureServers]);

    // locations
    useEffect(() => {
        let activeServers = context.state.azureServers;

        if (selectedSubscription) {
            activeServers = activeServers.filter(
                (server) => server.subscription === selectedSubscription,
            );
        }

        if (selectedResourceGroup) {
            activeServers = activeServers.filter(
                (server) => server.resourceGroup === selectedResourceGroup,
            );
        }

        const locs = removeDuplicates(activeServers.map((server) => server.location));

        setLocations(locs.sort());

        updateComboboxSelection(
            selectedLocation,
            setSelectedLocation,
            setLocationValue,
            locs,
            DefaultSelectionMode.AlwaysSelectNone,
        );
    }, [resourceGroups, selectedResourceGroup, context.state.azureServers]);

    // servers
    useEffect(() => {
        if (context.state.loadingAzureAccountsStatus !== ApiStatus.Loaded) {
            return; // should not be visible if not signed in
        }

        let activeServers = context.state.azureServers;

        if (selectedSubscription) {
            activeServers = activeServers.filter(
                (server) => server.subscription === selectedSubscription,
            );
        }

        if (selectedResourceGroup) {
            activeServers = activeServers.filter(
                (server) => server.resourceGroup === selectedResourceGroup,
            );
        }

        if (selectedLocation) {
            activeServers = activeServers.filter((server) => server.location === selectedLocation);
        }

        const srvs = removeDuplicates(activeServers.map((server) => server.server));
        setServers(srvs.sort());

        // intentionally cleared
        if (selectedServer === "") {
            setServerValue("");
        } else {
            updateComboboxSelection(
                selectedServer,
                setSelectedServerWithFormState,
                setServerValue,
                srvs,
                DefaultSelectionMode.SelectFirstIfAny,
            );
        }
    }, [locations, selectedLocation, context.state.azureServers]);

    // databases
    useEffect(() => {
        if (!selectedServer) {
            return; // should not be visible if no server is selected
        }

        const server = context.state.azureServers.find(
            (server) => server.server === selectedServer,
        );

        if (!server) {
            return;
        }

        const dbs = server.databases;

        setDatabases(dbs.sort());
        setSelectedDatabase(dbs.length === 1 ? dbs[0] : undefined);
    }, [selectedServer]);

    // #endregion

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    return (
        <div>
            <EntraSignInEmpty
                loadAccountStatus={context.state.loadingAzureAccountsStatus}
                brandImageSource={azureLogoColor()}
                signInText={Loc.connectionDialog.signIntoAzureToBrowse}
                linkText={Loc.azure.signIntoAzure}
                loadingText={Loc.azure.loadingAzureAccounts}
                onSignInClick={() =>
                    context.signIntoAzureForBrowse(ConnectionInputMode.AzureBrowse)
                }
            />
            {context.state.loadingAzureAccountsStatus === ApiStatus.Loaded && (
                <>
                    <AzureFilterCombobox
                        label={Loc.connectionDialog.subscriptionLabel}
                        clearable
                        decoration={
                            <>
                                <Button
                                    icon={<Filter16Filled />}
                                    appearance="subtle"
                                    title={Loc.connectionDialog.filterSubscriptions}
                                    onClick={() => {
                                        context.filterAzureSubscriptions();
                                    }}
                                    size="small"
                                />
                                {context.state.loadingAzureSubscriptionsStatus ===
                                ApiStatus.Loading ? (
                                    <Spinner size="tiny" />
                                ) : undefined}
                            </>
                        }
                        content={{
                            valueList: subscriptions,
                            value: subscriptionValue,
                            setValue: setSubscriptionValue,
                            selection: selectedSubscription,
                            setSelection: (sub) => {
                                setSelectedSubscription(sub);

                                if (sub === undefined) {
                                    return;
                                }

                                // Parse subscription ID from the string
                                const openParen = sub.indexOf("(");

                                if (openParen === -1) {
                                    return;
                                }

                                const closeParen = sub.indexOf(")", openParen);

                                if (closeParen === -1) {
                                    return;
                                }

                                const subId = sub.substring(openParen + 1, closeParen); // get the subscription ID from the string

                                if (subId.length === 0) {
                                    return;
                                }

                                context.loadAzureServers(subId);
                            },
                            placeholder: Loc.connectionDialog.azureFilterPlaceholder(
                                Loc.connectionDialog.subscription,
                            ),
                            invalidOptionErrorMessage: Loc.connectionDialog.invalidAzureBrowse(
                                Loc.connectionDialog.subscription,
                            ),
                        }}
                    />
                    <AzureFilterCombobox
                        label={Loc.connectionDialog.resourceGroupLabel}
                        clearable
                        content={{
                            valueList: resourceGroups,
                            value: resourceGroupValue,
                            setValue: setResourceGroupValue,
                            selection: selectedResourceGroup,
                            setSelection: setSelectedResourceGroup,
                            placeholder: Loc.connectionDialog.azureFilterPlaceholder(
                                Loc.connectionDialog.resourceGroup,
                            ),
                            invalidOptionErrorMessage: Loc.connectionDialog.invalidAzureBrowse(
                                Loc.connectionDialog.resourceGroup,
                            ),
                        }}
                    />
                    <AzureFilterCombobox
                        label={Loc.connectionDialog.locationLabel}
                        clearable
                        content={{
                            valueList: locations,
                            value: locationValue,
                            setValue: setLocationValue,
                            selection: selectedLocation,
                            setSelection: setSelectedLocation,
                            placeholder: Loc.connectionDialog.azureFilterPlaceholder(
                                Loc.connectionDialog.location,
                            ),
                            invalidOptionErrorMessage: Loc.connectionDialog.invalidAzureBrowse(
                                Loc.connectionDialog.location,
                            ),
                        }}
                    />
                    <AzureFilterCombobox
                        label={Loc.connectionDialog.serverLabel}
                        required
                        decoration={
                            context.state.loadingAzureServersStatus === ApiStatus.Loading ? (
                                <Spinner size="tiny" />
                            ) : undefined
                        }
                        content={{
                            valueList: servers,
                            value: serverValue,
                            setValue: setServerValue,
                            selection: selectedServer,
                            setSelection: setSelectedServerWithFormState,
                            invalidOptionErrorMessage: Loc.connectionDialog.invalidAzureBrowse(
                                Loc.connectionDialog.server,
                            ),
                        }}
                    />

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
                                        setSelectedDatabase(db);
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
