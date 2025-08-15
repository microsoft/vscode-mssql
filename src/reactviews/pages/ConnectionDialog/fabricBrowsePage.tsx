/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import {
    Button,
    InputOnChangeData,
    Label,
    Link,
    List,
    ListItem,
    makeStyles,
    MenuCheckedValueChangeData,
    MenuCheckedValueChangeEvent,
    Spinner,
    Textarea,
} from "@fluentui/react-components";
import { Filter16Filled } from "@fluentui/react-icons";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { removeDuplicates } from "../../common/utils";
import { DefaultSelectionMode, updateComboboxSelection } from "../../common/comboboxHelper";
import { AzureFilterCombobox } from "./AzureFilterCombobox.component";
import { FabricWorkspaceViewer } from "./components/fabricWorkspaceViewer";
import FabricWorkspaceFilter from "./components/fabricWorkspaceFilter";

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
    const [selectedServer, setSelectedServer] = useState<string | undefined>(undefined);
    const [serverValue, setServerValue] = useState<string>("");

    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDatabase, setSelectedDatabase] = useState<string | undefined>(undefined);
    const [databaseValue, setDatabaseValue] = useState<string>("");

    // Filter state
    const [searchFilter, setSearchFilter] = useState<string>("");
    const [typeFilter, setTypeFilter] = useState<string[]>(["Show All"]);

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

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    const handleSearchInputChanged = (
        _: ChangeEvent<HTMLInputElement>,
        data: InputOnChangeData,
    ) => {
        setSearchFilter(data.value);
    };

    const handleFilterOptionChanged = (
        _: MenuCheckedValueChangeEvent,
        { name, checkedItems }: MenuCheckedValueChangeData,
    ): void => {
        if (name === "sqlType") {
            setTypeFilter(checkedItems);
        }
    };

    return (
        <div>
            {context.state.loadingAzureAccountsStatus === ApiStatus.NotStarted && (
                <div className={styles.notSignedInContainer}>
                    <img
                        className={styles.icon}
                        src={fabricLogoColor()}
                        alt={Loc.connectionDialog.signIntoFabricToBrowse}
                    />
                    <div>{Loc.connectionDialog.signIntoFabricToBrowse}</div>
                    <Link
                        className={styles.signInLink}
                        onClick={() => {
                            context.signIntoAzureForBrowse();
                        }}>
                        {Loc.azure.signIntoAzure}
                    </Link>
                </div>
            )}
            {context.state.loadingAzureAccountsStatus === ApiStatus.Loading && (
                <div className={styles.notSignedInContainer}>
                    <img
                        className={styles.icon}
                        src={fabricLogoColor()}
                        alt={Loc.connectionDialog.signIntoFabricToBrowse}
                    />
                    <div>Loading Fabric Accounts</div>
                    <Spinner size="large" />
                </div>
            )}
            {context.state.loadingAzureAccountsStatus === ApiStatus.Loaded && (
                <>
                    <Label>Workspaces</Label>
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
                        />
                        <FabricWorkspaceViewer
                            fabricServerInfo={context.state.fabricServers}
                            searchFilter={searchFilter}
                            typeFilter={typeFilter}
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
