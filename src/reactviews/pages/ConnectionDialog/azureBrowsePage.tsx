/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState, JSX } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import {
    Field,
    Option,
    Button,
    Combobox,
    Spinner,
    makeStyles,
    ComboboxProps,
    OptionOnSelectData,
    SelectionEvents,
} from "@fluentui/react-components";
import { Filter16Filled } from "@fluentui/react-icons";
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
    const [subscriptionValue, setSubscriptionValue] = useState<string>("");

    const [resourceGroups, setResourceGroups] = useState<string[]>([]);
    const [selectedResourceGroup, setSelectedResourceGroup] = useState<
        string | undefined
    >(undefined);
    const [resourceGroupValue, setResourceGroupValue] = useState<string>("");

    const [locations, setLocations] = useState<string[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<
        string | undefined
    >(undefined);
    const [locationValue, setLocationValue] = useState<string>("");

    const [servers, setServers] = useState<string[]>([]);
    const [selectedServer, setSelectedServer] = useState<string | undefined>(
        undefined,
    );
    const [serverValue, setServerValue] = useState<string>("");

    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDatabase, setSelectedDatabase] = useState<
        string | undefined
    >(undefined);
    const [databaseValue, setDatabaseValue] = useState<string>("");

    // #region Effects

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

        // intentionally cleared
        if (selectedServer === "") {
            setServerValue("");
        } else {
            // if there is no current selection or if the selection is no longer in the list of options (due to changed filters),
            // set selection to the first option (if any)
            if (
                selectedServer === undefined ||
                !srvs.includes(selectedServer)
            ) {
                setSelectedServer(srvs.length > 0 ? srvs[0] : undefined);
                setServerValue(srvs.length > 0 ? srvs[0] : "");
            }
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

    // #endregion

    function setConnectionProperty(
        propertyName: keyof IConnectionDialogProfile,
        value: string,
    ) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    return (
        <div>
            <AzureBrowseDropdown
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
                    placeholder: Loc.connectionDialog.azureFilterPlaceholder(
                        Loc.connectionDialog.subscription,
                    ),
                    invalidOptionErrorMessage:
                        Loc.connectionDialog.invalidAzureBrowse(
                            Loc.connectionDialog.subscription,
                        ),
                }}
            />
            <AzureBrowseDropdown
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
                    invalidOptionErrorMessage:
                        Loc.connectionDialog.invalidAzureBrowse(
                            Loc.connectionDialog.resourceGroup,
                        ),
                }}
            />
            <AzureBrowseDropdown
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
                    invalidOptionErrorMessage:
                        Loc.connectionDialog.invalidAzureBrowse(
                            Loc.connectionDialog.location,
                        ),
                }}
            />
            <AzureBrowseDropdown
                label={Loc.connectionDialog.serverLabel}
                required
                decoration={
                    context.state.loadingAzureServersStatus ===
                    ApiStatus.Loading ? (
                        <Spinner size="tiny" />
                    ) : undefined
                }
                content={{
                    valueList: servers,
                    value: serverValue,
                    setValue: setServerValue,
                    selection: selectedServer,
                    setSelection: (srv) => {
                        setSelectedServer(srv);
                        setConnectionProperty(
                            "server",
                            srv ? srv + ".database.windows.net" : "",
                        );
                    },
                    invalidOptionErrorMessage:
                        Loc.connectionDialog.invalidAzureBrowse(
                            Loc.connectionDialog.server,
                        ),
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

const useFieldDecorationStyles = makeStyles({
    decoration: {
        display: "flex",
        alignItems: "center",
        columnGap: "4px",
    },
});

const AzureBrowseDropdown = ({
    label,
    required,
    clearable,
    content,
    decoration,
    props,
}: {
    label: string;
    required?: boolean;
    clearable?: boolean;
    content: {
        /** list of valid values for the combo box */
        valueList: string[];
        /** currently-selected value from `valueList` */
        selection?: string;
        /** callback when the user has selected a value from `valueList` */
        setSelection: (value: string | undefined) => void;
        /** currently-entered text in the combox, may not be a valid selection value if the user is typing */
        value: string;
        /** callback when the user types in the combobox */
        setValue: (value: string) => void;
        /** placeholder text for the combobox */
        placeholder?: string;
        /** message displayed if focus leaves this combobox and `value` is not a valid value from `valueList` */
        invalidOptionErrorMessage: string;
    };
    decoration?: JSX.Element;
    props?: Partial<ComboboxProps>;
}) => {
    const formStyles = useFormStyles();
    const decorationStyles = useFieldDecorationStyles();
    const [validationMessage, setValidationMessage] = useState<string>("");

    // clear validation message as soon as value is valid
    useEffect(() => {
        if (content.valueList.includes(content.value)) {
            setValidationMessage("");
        }
    }, [content.value]);

    // only display validation error if focus leaves the field and the value is not valid
    const onBlur = () => {
        if (content.value) {
            setValidationMessage(
                content.valueList.includes(content.value)
                    ? ""
                    : content.invalidOptionErrorMessage,
            );
        }
    };

    const onOptionSelect: (
        _: SelectionEvents,
        data: OptionOnSelectData,
    ) => void = (_, data: OptionOnSelectData) => {
        content.setSelection(
            data.selectedOptions.length > 0 ? data.selectedOptions[0] : "",
        );
        content.setValue(data.optionText ?? "");
    };

    function onInput(ev: React.ChangeEvent<HTMLInputElement>) {
        content.setValue(ev.target.value);
    }

    return (
        <div className={formStyles.formComponentDiv}>
            <Field
                label={
                    decoration ? (
                        <div className={decorationStyles.decoration}>
                            {label}
                            {decoration}
                        </div>
                    ) : (
                        label
                    )
                }
                orientation="horizontal"
                required={required}
                validationMessage={validationMessage}
                onBlur={onBlur}
            >
                <Combobox
                    {...props}
                    value={content.value}
                    selectedOptions={
                        content.selection ? [content.selection] : []
                    }
                    onInput={onInput}
                    onOptionSelect={onOptionSelect}
                    placeholder={content.placeholder}
                    clearable={clearable}
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
