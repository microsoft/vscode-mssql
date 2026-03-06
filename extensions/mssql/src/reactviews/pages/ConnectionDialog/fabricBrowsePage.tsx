/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { Label, makeStyles } from "@fluentui/react-components";
import {
    AuthenticationType,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import {
    FabricSqlDbInfo,
    FabricWorkspaceInfo,
    SqlArtifactTypes,
} from "../../../sharedInterfaces/fabric";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";
import { FabricExplorer } from "./components/fabric/fabricExplorer.component";
import { getTypeDisplayName } from "./components/fabric/fabricWorkspaceContentsList.component";

export const FabricBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    const loadingAzureAccountsStatus = useConnectionDialogSelector(
        (s) => s.loadingAzureAccountsStatus,
    );
    const azureAccounts = useConnectionDialogSelector((s) => s.azureAccounts);
    const selectedAccountId = useConnectionDialogSelector((s) => s.selectedAccountId);
    const selectedTenantId = useConnectionDialogSelector((s) => s.selectedTenantId);
    if (context === undefined) {
        return undefined;
    }

    const styles = useStyles();

    useEffect(() => {
        if (
            loadingAzureAccountsStatus === ApiStatus.Loaded &&
            azureAccounts &&
            !selectedAccountId
        ) {
            const firstAccount = azureAccounts[0];
            if (firstAccount) {
                context.selectAzureAccount(firstAccount.id);
            }
        }
    }, [loadingAzureAccountsStatus, azureAccounts]);

    useEffect(() => {
        if (selectedAccountId) {
            setConnectionProperty("accountId", selectedAccountId);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        if (selectedTenantId) {
            setConnectionProperty("tenantId", selectedTenantId);
        }
    }, [selectedTenantId]);

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

    const hasAccounts = (azureAccounts?.length ?? 0) > 0;

    return (
        <div>
            <EntraSignInEmpty
                loadAccountStatus={loadingAzureAccountsStatus}
                hasAccounts={hasAccounts}
                brandImageSource={fabricLogoColor()}
                signInText={Loc.connectionDialog.signIntoFabricToBrowse}
                linkText={Loc.connectionDialog.signIntoFabric}
                loadingText={Loc.connectionDialog.loadingFabricAccounts}
                onSignInClick={() => {
                    context.signIntoAzureForBrowse(ConnectionInputMode.FabricBrowse);
                }}
            />
            {loadingAzureAccountsStatus === ApiStatus.Loaded && hasAccounts && (
                <>
                    <div className={styles.componentGroupHeader}>
                        <Label>{Loc.connectionDialog.fabricWorkspaces}</Label>
                    </div>
                    <div className={styles.componentGroupContainer}>
                        <FabricExplorer
                            onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                            onSelectAccountId={handleSelectAccountId}
                            onSelectTenantId={handleSelectTenantId}
                            onSelectWorkspace={handleSelectWorkspace}
                            onSelectDatabase={handleDatabaseSelected}
                        />
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

function generateProfileName(database: FabricSqlDbInfo) {
    return `${database.displayName} (${getTypeDisplayName(database.type)})`;
}
