/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
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
import { locConstants as Loc } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import EntraSignInEmpty from "./components/entraSignInEmpty.component";
import { SqlExplorer } from "./components/fabric/sqlExplorer.component";

export const azureLogoColor = () => {
    return require(`../../media/azure-color.svg`);
};

export const AzureBrowsePage = () => {
    const context = useContext(ConnectionDialogContext);
    const formState = useConnectionDialogSelector((s) => s.formState);
    const azureAccounts = useConnectionDialogSelector((s) => s.azureAccounts);
    const loadingAzureAccountsStatus = useConnectionDialogSelector(
        (s) => s.loadingAzureAccountsStatus,
    );
    const azureSubscriptions = useConnectionDialogSelector((s) => s.azureSubscriptions);
    const azureSubscriptionsLoadStatus = useConnectionDialogSelector(
        (s) => s.azureSubscriptionsLoadStatus,
    );
    const favoritedAzureSubscriptionIds = useConnectionDialogSelector(
        (s) => s.favoritedAzureSubscriptionIds,
    );
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const mainOptions = useConnectionDialogSelector((s) => s.connectionComponents.mainOptions);

    if (context === undefined) {
        return undefined;
    }

    const styles = useStyles();

    function setConnectionProperty(propertyName: keyof IConnectionDialogProfile, value: string) {
        context!.formAction({ propertyName, value, isAction: false });
    }

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
                    <SqlExplorer
                        collections={azureSubscriptions}
                        collectionsLoadStatus={azureSubscriptionsLoadStatus}
                        favoritedIds={favoritedAzureSubscriptionIds}
                        showTypeFilter={false}
                        showResourceGroupColumn={true}
                        expandableServers={true}
                        onSignIntoMicrosoftAccount={() =>
                            context.signIntoAzureForBrowse(ConnectionInputMode.AzureBrowse)
                        }
                        onSelectAccountId={(id) => context.selectAzureAccount(id)}
                        onSelectTenantId={(id) => context.setSelectedTenantId(id)}
                        onToggleFavorite={(id) =>
                            context.toggleFavoriteCollection(id, ConnectionInputMode.AzureBrowse)
                        }
                        onSignIntoTenant={() => context.signIntoTenantForBrowse()}
                        onSelectCollection={(ws) => {
                            context.selectSqlCollection(ws.id);
                        }}
                        onSelectDatabase={(db) => {
                            setConnectionProperty("server", db.server);
                            if (db.databases.length > 0) {
                                setConnectionProperty("database", db.databases[0]);
                            }
                        }}
                        strings={{
                            title: Loc.connectionDialog.azureDatabases,
                            collectionListLabel: Loc.connectionDialog.azureSubscriptions,
                            collectionSearchPlaceholder: Loc.connectionDialog.searchSubscriptions,
                            noCollectionsFoundMessage: Loc.connectionDialog.noSubscriptionsFound,
                            selectCollectionMessage:
                                Loc.connectionDialog.selectASubscriptionToViewServers,
                            loadingCollectionsMessage: Loc.connectionDialog.loadingSubscriptions,
                            errorLoadingCollectionsMessage:
                                Loc.connectionDialog.errorLoadingSubscriptions,
                            loadingDatabasesMessage:
                                Loc.connectionDialog.loadingServersInSubscription,
                            errorLoadingDatabasesMessage: Loc.connectionDialog.errorLoadingServers,
                            noDatabasesInCollectionMessage:
                                Loc.connectionDialog.noServersFoundInSubscription,
                            collapseCollectionListLabel:
                                Loc.connectionDialog.collapseAzureSubscriptionExplorer,
                            expandCollectionListLabel:
                                Loc.connectionDialog.expandAzureSubscriptionExplorer,
                        }}
                    />

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
