/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import {
    Field,
    Option,
    Button,
    Combobox,
    Spinner,
    makeStyles,
} from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";

function removeDuplicates<T>(array: T[]): T[] {
    return Array.from(new Set(array));
}

export const AzureBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    const formStyles = useFormStyles();
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    if (context === undefined) {
        return undefined;
    }

    const [subscriptions, setSubscriptions] = useState<string[]>([]);
    const [selectedSubscription, setSelectedSubscription] = useState<
        string | undefined
    >(undefined);

    const [resourceGroups, setResourceGroups] = useState<string[]>([]);
    const [selectedResourceGroup, setSelectedResourceGroup] = useState<
        string | undefined
    >(undefined);

    const [locations, setLocations] = useState<string[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<
        string | undefined
    >(undefined);

    const [servers, setServers] = useState<string[]>([]);
    const [selectedServer, setSelectedServer] = useState<string | undefined>(
        undefined,
    );

    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDatabase, setSelectedDatabase] = useState<
        string | undefined
    >(undefined);

    useEffect(() => {
        const subs = removeDuplicates(
            context.state.azureSubscriptions.map(
                (sub) => `${sub.name} (${sub.id})`,
            ),
        );
        setSubscriptions(subs.sort());

        if (!selectedSubscription && subs.length === 1) {
            setSelectedSubscription(subs[0]);
        }
    }, [context.state.azureSubscriptions]);

    useEffect(() => {
        let activeServers = context.state.azureServers;

        if (selectedSubscription) {
            activeServers = activeServers.filter(
                (server) => server.subscription === selectedSubscription,
            );
        }

        const rgs = removeDuplicates(
            activeServers.map((server) => server.resourceGroup),
        );
        setResourceGroups(rgs.sort());

        // if current selection is no longer in the list of options,
        // set selection to undefined (if multiple options) or the only option (if only one)
        if (selectedResourceGroup && !rgs.includes(selectedResourceGroup)) {
            setSelectedResourceGroup(rgs.length === 1 ? rgs[0] : undefined);
        }
    }, [subscriptions, selectedSubscription, context.state.azureServers]);

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

        const locs = removeDuplicates(
            activeServers.map((server) => server.location),
        );

        setLocations(locs.sort());

        // if current selection is no longer in the list of options,
        // set selection to undefined (if multiple options) or the only option (if only one)
        if (selectedLocation && !locs.includes(selectedLocation)) {
            setSelectedLocation(locs.length === 1 ? locs[0] : undefined);
        }
    }, [resourceGroups, selectedResourceGroup, context.state.azureServers]);

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

        if (selectedLocation) {
            activeServers = activeServers.filter(
                (server) => server.location === selectedLocation,
            );
        }

        const srvs = removeDuplicates(
            activeServers.map((server) => server.server),
        );
        setServers(srvs.sort());

        // if current selection is no longer in the list of options,
        // set selection to undefined (if multiple options) or the only option (if only one)
        if (selectedServer && !srvs.includes(selectedServer)) {
            setSelectedServer(srvs.length === 1 ? srvs[0] : undefined);
        }
    }, [locations, selectedLocation, context.state.azureServers]);

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

    function setConnectionProperty(
        propertyName: keyof IConnectionDialogProfile,
        value: string,
    ) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    return (
        <div>
            <AzureBrowseDropdown
                label={Loc.connectionDialog.subscription}
                clearable
                loadState={context.state.loadingAzureSubscriptionsStatus}
                content={{
                    valueList: subscriptions,
                    setValue: (sub) => {
                        setSelectedSubscription(sub);

                        if (sub === undefined) {
                            return;
                        }

                        // TODO: swap out subscription ID parsing for an AzureSubscriptionInfo
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
                    currentValue: selectedSubscription,
                }}
            />
            <AzureBrowseDropdown
                label={Loc.connectionDialog.resourceGroup}
                clearable
                content={{
                    valueList: resourceGroups,
                    setValue: setSelectedResourceGroup,
                    currentValue: selectedResourceGroup,
                }}
            />
            <AzureBrowseDropdown
                label={Loc.connectionDialog.location}
                clearable
                content={{
                    valueList: locations,
                    setValue: setSelectedLocation,
                    currentValue: selectedLocation,
                }}
            />
            <AzureBrowseDropdown
                label={Loc.connectionDialog.server}
                required
                loadState={context.state.loadingAzureServersStatus}
                content={{
                    valueList: servers,
                    setValue: (srv) => {
                        setSelectedServer(srv);
                        setConnectionProperty(
                            "server",
                            srv ? srv + ".database.windows.net" : "",
                        );
                    },
                    currentValue: selectedServer,
                }}
            />

            {selectedServer && (
                <>
                    <FormField
                        context={context}
                        component={
                            context.state.connectionComponents.components[
                                "trustServerCertificate"
                            ] as FormItemSpec<IConnectionDialogProfile>
                        }
                        idx={0}
                        props={{ orientation: "horizontal" }}
                    />
                    <AzureBrowseDropdown
                        label={Loc.connectionDialog.database}
                        clearable
                        content={{
                            valueList: databases,
                            setValue: (db) => {
                                setSelectedDatabase(db);
                                setConnectionProperty("database", db ?? "");
                            },
                            currentValue: selectedDatabase,
                        }}
                    />
                    {context.state.connectionComponents.mainOptions
                        .filter(
                            // filter out inputs that are manually placed above
                            (opt) =>
                                ![
                                    "server",
                                    "database",
                                    "trustServerCertificate",
                                ].includes(opt),
                        )
                        .map((inputName, idx) => {
                            const component =
                                context.state.connectionComponents.components[
                                    inputName as keyof IConnectionDialogProfile
                                ];
                            if (component.hidden === true) {
                                return undefined;
                            }

                            return (
                                <FormField
                                    key={idx}
                                    context={context}
                                    component={
                                        component as FormItemSpec<IConnectionDialogProfile>
                                    }
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
                    shape="square"
                    onClick={(_event) => {
                        setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                    }}
                    className={formStyles.formNavTrayButton}
                >
                    {Loc.connectionDialog.advancedSettings}
                </Button>
                <div className={formStyles.formNavTrayRight}>
                    <ConnectButton className={formStyles.formNavTrayButton} />
                </div>
            </div>
        </div>
    );
};

const useLoadableStyles = makeStyles({
    loadable: {
        display: "flex",
        alignItems: "center",
        columnGap: "4px",
    },
});

const AzureBrowseDropdown = ({
    label,
    required,
    clearable,
    loadState,
    content,
}: {
    label: string;
    required?: boolean;
    clearable?: boolean;
    loadState?: ApiStatus;
    content: {
        valueList: string[];
        setValue: (value: string | undefined) => void;
        currentValue?: string;
    };
}) => {
    const formStyles = useFormStyles();
    const loadableStyles = useLoadableStyles();

    const onInput = (ev: React.ChangeEvent<HTMLInputElement>) => {
        content.setValue(ev.target.value);
    };

    return (
        <div className={formStyles.formComponentDiv}>
            <Field
                label={
                    loadState === ApiStatus.Loading ? (
                        <div className={loadableStyles.loadable}>
                            {label}
                            {loadState === ApiStatus.Loading && (
                                <Spinner size="tiny" />
                            )}
                        </div>
                    ) : (
                        label
                    )
                }
                orientation="horizontal"
                required={required}
            >
                <Combobox
                    value={content.currentValue ?? ""}
                    selectedOptions={
                        content.currentValue ? [content.currentValue] : []
                    }
                    clearable={clearable}
                    onInput={onInput}
                    onOptionSelect={(_event, data) => {
                        if (data.optionValue === content.currentValue) {
                            return;
                        }

                        content.setValue(data.optionValue);
                    }}
                >
                    {content.valueList.map((val, idx) => {
                        return (
                            <Option key={idx} value={val}>
                                {val}
                            </Option>
                        );
                    })}
                </Combobox>
            </Field>
        </div>
    );
};
