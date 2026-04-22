/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useMemo } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { Label, makeStyles } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { SqlCollectionInfo, SqlDbInfo } from "../../../sharedInterfaces/fabric";
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus, Status } from "../../../sharedInterfaces/webview";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";
import { SqlExplorer } from "./components/fabric/sqlExplorer.component";

export const azureLogoColor = () => {
    return require(`../../media/azure-color.svg`);
};

export const AzureBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    const formState = useConnectionDialogSelector((s) => s.formState);
    const azureServers = useConnectionDialogSelector((s) => s.azureServers);
    const azureAccounts = useConnectionDialogSelector((s) => s.azureAccounts);
    const loadingAzureAccountsStatus = useConnectionDialogSelector(
        (s) => s.loadingAzureAccountsStatus,
    );
    const azureSubscriptions = useConnectionDialogSelector((s) => s.azureSubscriptions);
    const loadingAzureSubscriptionsStatus = useConnectionDialogSelector(
        (s) => s.loadingAzureSubscriptionsStatus,
    );
    const selectedAccountId = useConnectionDialogSelector((s) => s.selectedAccountId);
    const selectedTenantId = useConnectionDialogSelector((s) => s.selectedTenantId);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const mainOptions = useConnectionDialogSelector((s) => s.connectionComponents.mainOptions);

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

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

    // Map Azure subscriptions + servers to SqlCollectionInfo[] shape
    const subscriptionWorkspaces = useMemo((): SqlCollectionInfo[] => {
        let subs = azureSubscriptions;
        if (selectedTenantId) {
            subs = subs.filter((sub) => sub.tenantId === selectedTenantId);
        }

        return subs.map((sub) => {
            const subKey = `${sub.name} (${sub.id})`;
            const subServers = azureServers.filter((s) => s.subscription === subKey);

            const databases: SqlDbInfo[] = subServers.map((srv) => ({
                id: srv.server,
                server: srv.uri,
                displayName: srv.server,
                database: "",
                type: "AzureSqlServer",
                collectionId: sub.id,
                collectionName: sub.name,
                tenantId: sub.tenantId,
                resourceGroup: srv.resourceGroup,
            }));

            const loadStatus: Status = {
                status: sub.loaded ? ApiStatus.Loaded : ApiStatus.Loading,
            };

            return {
                id: sub.id,
                displayName: sub.name,
                tenantId: sub.tenantId,
                databases,
                loadStatus,
            };
        });
    }, [azureSubscriptions, azureServers, selectedTenantId]);

    const subscriptionsLoadStatus = useMemo(
        (): Status => ({ status: loadingAzureSubscriptionsStatus }),
        [loadingAzureSubscriptionsStatus],
    );

    const hasAccounts = (azureAccounts?.length ?? 0) > 0;

    return (
        <div>
            <EntraSignInEmpty
                loadAccountStatus={loadingAzureAccountsStatus}
                hasAccounts={hasAccounts}
                brandImageSource={azureLogoColor()}
                signInText={Loc.connectionDialog.signIntoAzureToBrowse}
                linkText={Loc.azure.signIntoAzure}
                loadingText={Loc.azure.loadingAzureAccounts}
                onSignInClick={() =>
                    context.signIntoAzureForBrowse(ConnectionInputMode.AzureBrowse)
                }
            />
            {loadingAzureAccountsStatus === ApiStatus.Loaded && hasAccounts && (
                <>
                    <div className={styles.componentGroupHeader}>
                        <Label>{Loc.connectionDialog.azureSubscriptions}</Label>
                    </div>
                    <div className={styles.componentGroupContainer}>
                        <SqlExplorer
                            workspaces={subscriptionWorkspaces}
                            workspacesLoadStatus={subscriptionsLoadStatus}
                            workspaceListLabel={Loc.connectionDialog.azureSubscriptions}
                            workspaceSearchPlaceholder={Loc.connectionDialog.searchSubscriptions}
                            noWorkspacesFoundMessage={Loc.connectionDialog.noSubscriptionsFound}
                            selectWorkspaceMessage={
                                Loc.connectionDialog.selectASubscriptionToViewServers
                            }
                            loadingWorkspacesMessage={Loc.connectionDialog.loadingSubscriptions}
                            errorLoadingWorkspacesMessage={
                                Loc.connectionDialog.errorLoadingSubscriptions
                            }
                            loadingDatabasesMessage={
                                Loc.connectionDialog.loadingServersInSubscription
                            }
                            errorLoadingDatabasesMessage={Loc.connectionDialog.errorLoadingServers}
                            noDatabasesInWorkspaceMessage={
                                Loc.connectionDialog.noServersFoundInSubscription
                            }
                            showTypeFilter={false}
                            showResourceGroupColumn={true}
                            onSignIntoMicrosoftAccount={() =>
                                context.signIntoAzureForBrowse(ConnectionInputMode.AzureBrowse)
                            }
                            onSelectAccountId={(id) => context.selectAzureAccount(id)}
                            onSelectTenantId={(id) => context.setSelectedTenantId(id)}
                            onSelectWorkspace={(_ws) => {
                                /* no-op: servers auto-loaded for all subscriptions */
                            }}
                            onSelectDatabase={(db) => {
                                setConnectionProperty("server", db.server);
                                if (db.database) {
                                    setConnectionProperty("database", db.database);
                                }
                            }}
                        />
                    </div>

                    {formState.server && (
                        <>
                            <div
                                className={styles.componentGroupHeader}
                                style={{ marginTop: "16px" }}>
                                <Label>{Loc.connectionDialog.connectionAuthentication}</Label>
                            </div>
                            <div className={styles.componentGroupContainer}>
                                {mainOptions
                                    .filter(
                                        // filter out inputs that are manually handled
                                        (opt) => !["server", "database"].includes(opt),
                                    )
                                    .map((inputName, idx) => {
                                        const component =
                                            formComponents[
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
                                                formState={formState}
                                                component={component}
                                                idx={idx}
                                                props={{ orientation: "horizontal" }}
                                            />
                                        );
                                    })}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

const useStyles = makeStyles({
    componentGroupHeader: {
        marginBottom: "8px",
    },
    componentGroupContainer: {
        padding: "8px",
        border: "0.5px solid var(--vscode-editorWidget-border)",
        borderRadius: "2px",
    },
});
