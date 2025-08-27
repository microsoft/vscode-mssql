/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import {
    Button,
    Label,
    makeStyles,
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
    FabricWorkspaceInfo,
    IAzureAccount,
    IConnectionDialogProfile,
    SqlArtifactTypes,
} from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";
import { useAccordionStyles } from "../../common/styles";
import { FabricExplorer } from "./components/fabric/fabricExplorer.component";

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
        paddingLeft: "6px",
        paddingBottom: "6px",
        paddingTop: "6px",
    },
    connectionAuthGroup: {
        padding: "10px",
        border: "0.5px solid var(--vscode-editorWidget-border)",
        borderRadius: "2px",
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

    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    useEffect(() => {
        if (
            context.state.loadingAzureAccountsStatus === ApiStatus.Loaded &&
            context.state.azureAccounts &&
            !context.state.selectedAccountId
        ) {
            const firstAccount = context.state.azureAccounts[0];
            if (firstAccount) {
                context.selectAzureAccount(firstAccount.id);
            }
        }
    }, [
        context.state.loadingAzureAccountsStatus,
        context.state.azureAccounts,
        // context.state.selectedAccountId
    ]);

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    function handleSelectAccountId(accountId: string) {
        context!.selectAzureAccount(accountId);
    }

    function handleSelectTenantId(tenantId: string) {
        context!.selectAzureTenant(tenantId);
    }

    function handleSelectWorkspace(workspace: FabricWorkspaceInfo) {
        context!.selectFabricWorkspace(workspace.id);
    }

    function handleDatabaseSelected(selectedServer: FabricSqlDbInfo) {
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
                    <Label>{Loc.connectionDialog.fabricWorkspaces}</Label>
                    <div className={styles.workspaceContainer}>
                        <FabricExplorer
                            fabricWorkspaces={context.state.fabricWorkspaces}
                            fabricWorkspacesLoadStatus={context.state.fabricWorkspacesLoadStatus}
                            onSelectAccountId={handleSelectAccountId}
                            onSelectTenantId={handleSelectTenantId}
                            onSelectWorkspace={handleSelectWorkspace}
                            onSelectDatabase={handleDatabaseSelected}
                        />
                    </div>

                    {context.state.formState.server && (
                        <div className={styles.connectionAuthGroup}>
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
