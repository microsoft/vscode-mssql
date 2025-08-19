/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import {
    Button,
    Dropdown,
    InfoLabel,
    Input,
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
import FabricWorkspaceBrowseBy from "./components/fabricWorkspaceBrowseBy";

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
    workspaceHeader: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        marginBottom: "10px",
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
                    <div>
                        <div className={styles.formRow} style={{ marginBottom: "2px" }}>
                            <InfoLabel>Account</InfoLabel>
                            <Input style={{ width: "410px" }} />
                        </div>
                        <Button style={{ marginBottom: "10px" }}>Sign in</Button>
                    </div>

                    <div className={styles.formRow} style={{ marginBottom: "10px" }}>
                        <InfoLabel>Tenant ID</InfoLabel>
                        <Dropdown style={{ width: "410px" }} />
                    </div>

                    <div className={styles.formRow}>
                        <InfoLabel>Authentication Type</InfoLabel>
                        <Dropdown style={{ width: "410px" }} />
                    </div>

                    <Label>{Loc.connectionDialog.workspaces}</Label>
                    <div className={styles.workspaceContainer}>
                        <div className={styles.workspaceContentPadding}>
                            <div className={styles.workspaceHeader}>
                                <FabricWorkspaceBrowseBy />
                                <FabricWorkspaceFilter
                                    onSearchInputChanged={handleSearchInputChanged}
                                    onFilterOptionChanged={handleFilterOptionChanged}
                                    searchValue={searchFilter}
                                    selectedTypeFilters={typeFilter}
                                />
                            </div>
                            <FabricWorkspaceViewer
                                fabricServerInfo={context.state.fabricServers}
                                searchFilter={searchFilter}
                                typeFilter={typeFilter}
                            />
                        </div>
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
