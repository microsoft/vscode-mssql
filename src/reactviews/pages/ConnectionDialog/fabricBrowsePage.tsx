/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ConnectButton } from "./components/connectButton.component";
import { Button, Label, makeStyles } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    AuthenticationType,
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import {
    FabricSqlDbInfo,
    FabricWorkspaceInfo,
    SqlArtifactTypes,
} from "../../../sharedInterfaces/fabric";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";
import { FabricExplorer } from "./components/fabric/fabricExplorer.component";
import { getTypeDisplayName } from "./components/fabric/fabricWorkspaceContentsList.component";

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
    }, [context.state.loadingAzureAccountsStatus, context.state.azureAccounts]);

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    function handleSignIntoMicrosoftAccount() {
        context?.signIntoAzureForBrowse(ConnectionInputMode.FabricBrowse);
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

    async function handleDatabaseSelected(database: FabricSqlDbInfo) {
        switch (database.type) {
            case SqlArtifactTypes.SqlAnalyticsEndpoint: {
                const serverUrl = await context!.getSqlAnalyticsEndpointUriFromFabric(database);
                setConnectionProperty("server", serverUrl);
                setConnectionProperty("profileName", generateProfileName(database));
                setConnectionProperty("authenticationType", AuthenticationType.AzureMFA);

                return;
            }
            case SqlArtifactTypes.SqlDatabase:
                setConnectionProperty("server", database.server);
                setConnectionProperty("database", database.database);
                setConnectionProperty("profileName", generateProfileName(database));
                setConnectionProperty("authenticationType", AuthenticationType.AzureMFA);

                return;
            default:
                context!.log("Unknown server type selected.", "error");
        }
    }

    const hasAccounts = (context.state.azureAccounts?.length ?? 0) > 0;

    return (
        <div>
            <EntraSignInEmpty
                loadAccountStatus={context.state.loadingAzureAccountsStatus}
                hasAccounts={hasAccounts}
                brandImageSource={fabricLogoColor()}
                signInText={Loc.connectionDialog.signIntoFabricToBrowse}
                linkText={Loc.connectionDialog.signIntoFabric}
                loadingText={Loc.connectionDialog.loadingFabricAccounts}
                onSignInClick={() => {
                    context.signIntoAzureForBrowse(ConnectionInputMode.FabricBrowse);
                }}
            />
            {context.state.loadingAzureAccountsStatus === ApiStatus.Loaded && hasAccounts && (
                <>
                    <div className={styles.componentGroupHeader}>
                        <Label>{Loc.connectionDialog.fabricWorkspaces}</Label>
                    </div>
                    <div className={styles.componentGroupContainer}>
                        <FabricExplorer
                            fabricWorkspaces={context.state.fabricWorkspaces}
                            fabricWorkspacesLoadStatus={context.state.fabricWorkspacesLoadStatus}
                            onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                            onSelectAccountId={handleSelectAccountId}
                            onSelectTenantId={handleSelectTenantId}
                            onSelectWorkspace={handleSelectWorkspace}
                            onSelectDatabase={handleDatabaseSelected}
                        />
                    </div>

                    {context.state.formState.server && (
                        <>
                            <div
                                className={styles.componentGroupHeader}
                                style={{ marginTop: "16px" }}>
                                <Label>{Loc.connectionDialog.connectionAuthentication}</Label>
                            </div>
                            <div className={styles.componentGroupContainer}>
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
const useStyles = makeStyles({
    icon: {
        width: "75px",
        height: "75px",
        marginBottom: "10px",
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
    componentGroupHeader: {
        marginBottom: "8px",
    },
    componentGroupContainer: {
        padding: "8px",
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

function generateProfileName(database: FabricSqlDbInfo) {
    return `${database.displayName} (${getTypeDisplayName(database.type)})`;
}
