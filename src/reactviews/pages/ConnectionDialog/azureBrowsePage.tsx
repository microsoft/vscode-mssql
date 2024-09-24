/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
// import { FormField } from "../../common/forms/form.component";
import { ConnectButton } from "./components/connectButton.component";
import { Dropdown, Field, Option, Button } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants } from "../../common/locConstants";
import { TestConnectionButton } from "./components/testConnectionButton.component";

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
            context.state.azureDatabases.map((server) => server.subscription),
        );
        setSubscriptions(subs);

        if (!selectedSubscription && subs.length === 1) {
            setSelectedSubscription(subs[0]);
        }
    }, [context.state.azureDatabases]);

    useEffect(() => {
        let activeServers = context.state.azureDatabases;

        if (selectedSubscription) {
            activeServers = activeServers.filter(
                (server) => server.subscription === selectedSubscription,
            );
        }

        const rgs = removeDuplicates(
            activeServers.map((server) => server.resourceGroup),
        );
        setResourceGroups(rgs);

        // if current selection is no longer in the list of options,
        // set selection to undefined (if multiple options) or the only option (if only one)
        if (selectedResourceGroup && !rgs.includes(selectedResourceGroup)) {
            setSelectedResourceGroup(rgs.length === 1 ? rgs[0] : undefined);
        }
    }, [subscriptions, selectedSubscription]);

    useEffect(() => {
        let activeServers = context.state.azureDatabases;

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

        setLocations(locs);

        // if current selection is no longer in the list of options,
        // set selection to undefined (if multiple options) or the only option (if only one)
        if (selectedLocation && !locs.includes(selectedLocation)) {
            setSelectedLocation(locs.length === 1 ? locs[0] : undefined);
        }
    }, [resourceGroups, selectedResourceGroup]);

    useEffect(() => {
        let activeServers = context.state.azureDatabases;

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
        setServers(srvs);

        // if current selection is no longer in the list of options,
        // set selection to undefined (if multiple options) or the only option (if only one)
        if (selectedServer && !srvs.includes(selectedServer)) {
            setSelectedServer(srvs.length === 1 ? srvs[0] : undefined);
        }
    }, [locations, selectedLocation]);

    useEffect(() => {
        if (!selectedServer) {
            return; // should not be visible if no server is selected
        }

        const dbs = context.state.azureDatabases.find(
            (server) => server.server === selectedServer,
        )!.databases;

        setDatabases(dbs);
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
                label="Subscription"
                clearable
                content={{
                    valueList: subscriptions,
                    setValue: setSelectedSubscription,
                    currentValue: selectedSubscription,
                }}
            />
            <AzureBrowseDropdown
                label="Resource Group"
                clearable
                content={{
                    valueList: resourceGroups,
                    setValue: setSelectedResourceGroup,
                    currentValue: selectedResourceGroup,
                }}
            />
            <AzureBrowseDropdown
                label="Location"
                clearable
                content={{
                    valueList: locations,
                    setValue: setSelectedLocation,
                    currentValue: selectedLocation,
                }}
            />
            <AzureBrowseDropdown
                label="Server"
                required
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
                        label="Database"
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
                        .filter((opt) => !["server", "database"].includes(opt))
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
                    {locConstants.connectionDialog.advancedSettings}
                </Button>
                <div className={formStyles.formNavTrayRight}>
                    <TestConnectionButton
                        className={formStyles.formNavTrayButton}
                    />
                    <ConnectButton className={formStyles.formNavTrayButton} />
                </div>
            </div>
        </div>
    );
};

const AzureBrowseDropdown = ({
    label,
    required,
    clearable,
    content,
}: {
    label: string;
    required?: boolean;
    clearable?: boolean;
    content: {
        valueList: string[];
        setValue: (value: string | undefined) => void;
        currentValue?: string;
    };
}) => {
    const formStyles = useFormStyles();

    return (
        <div className={formStyles.formComponentDiv}>
            <Field label={label} orientation="horizontal" required={required}>
                <Dropdown
                    value={content.currentValue ?? ""}
                    selectedOptions={
                        content.currentValue ? [content.currentValue] : []
                    }
                    clearable={clearable}
                    onOptionSelect={(_event, data) => {
                        if (data.optionValue === content.currentValue) {
                            return;
                        }

                        content.setValue(data.optionValue);
                    }}
                >
                    {content.valueList.map((loc, idx) => {
                        return (
                            <Option key={idx} value={loc}>
                                {loc}
                            </Option>
                        );
                    })}
                </Dropdown>
            </Field>
        </div>
    );
};
