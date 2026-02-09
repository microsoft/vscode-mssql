/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from "react";
import { useConnectionDialogSelector } from "../../connectionDialogSelector";
import FabricExplorerHeader from "./fabricExplorerHeader.component";
import { FabricWorkspaceContentsList } from "./fabricWorkspaceContentsList.component";
import { FabricWorkspacesList } from "./fabricWorkspacesList.component";
import { FabricSqlDbInfo, FabricWorkspaceInfo } from "../../../../../sharedInterfaces/fabric";
import { Status } from "../../../../../sharedInterfaces/webview";
import { useFabricExplorerStyles } from "./fabricExplorer.styles";
import { useVscodeWebview2 } from "../../../../common/vscodeWebviewProvider2";
import {
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
} from "../../../../../sharedInterfaces/connectionDialog";

export const FabricExplorer = ({
    fabricWorkspaces,
    fabricWorkspacesLoadStatus,
    onSignIntoMicrosoftAccount,
    onSelectAccountId,
    onSelectTenantId,
    onSelectWorkspace,
    onSelectDatabase,
}: FabricExplorerProps) => {
    const azureAccounts = useConnectionDialogSelector((s) => s.azureAccounts);
    const azureTenants = useConnectionDialogSelector((s) => s.azureTenants);
    const selectedAccountId = useConnectionDialogSelector((s) => s.selectedAccountId);
    const selectedTenantId = useConnectionDialogSelector((s) => s.selectedTenantId);
    const loadingAzureTenantsStatus = useConnectionDialogSelector((s) => s.loadingAzureTenantsStatus);
    // const fabricWorkspacesLoadStatus = useConnectionDialogSelector((s) => s.fabricWorkspacesLoadStatus);
    const { themeKind } = useVscodeWebview2<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();

    const fabricStyles = useFabricExplorerStyles();

    const [searchFilter, setSearchFilter] = useState<string>("");

    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);

    const selectedWorkspace = useMemo(() => {
        if (fabricWorkspaces.length === 0 || !selectedWorkspaceId) {
            return undefined;
        }

        return fabricWorkspaces.find((w) => w.id === selectedWorkspaceId);
    }, [fabricWorkspaces, selectedWorkspaceId]);

    function handleSignIntoMicrosoftAccount() {
        onSignIntoMicrosoftAccount();
    }

    function handleSelectAccountId(accountId: string) {
        onSelectAccountId(accountId);
    }

    function handleSelectTenantId(tenantId: string) {
        onSelectTenantId(tenantId);
    }

    function handleWorkspaceSelected(workspace: FabricWorkspaceInfo) {
        setSelectedWorkspaceId(workspace.id);
        onSelectWorkspace(workspace);
    }

    function handleDatabaseSelected(database: FabricSqlDbInfo) {
        onSelectDatabase(database);
    }
    function handleSearchValueChanged(searchValue: string) {
        setSearchFilter(searchValue);
    }

    return (
        <>
            <FabricExplorerHeader
                searchValue={searchFilter}
                azureAccounts={azureAccounts}
                azureTenants={azureTenants}
                selectedAccountId={selectedAccountId}
                selectedTenantId={selectedTenantId}
                azureTenantsLoadStatus={loadingAzureTenantsStatus}
                onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                onSelectAccountId={handleSelectAccountId}
                onSelectTenantId={handleSelectTenantId}
                onSearchValueChanged={handleSearchValueChanged}
            />
            <div className={fabricStyles.workspaceExplorer}>
                <FabricWorkspacesList
                    workspaces={fabricWorkspaces}
                    selectedWorkspace={selectedWorkspace}
                    fabricWorkspacesLoadStatus={fabricWorkspacesLoadStatus}
                    onSelectWorkspace={handleWorkspaceSelected}
                />
                <FabricWorkspaceContentsList
                    fabricWorkspacesLoadStatus={fabricWorkspacesLoadStatus}
                    selectedWorkspace={selectedWorkspace}
                    searchFilter={searchFilter}
                    onSelectDatabase={handleDatabaseSelected}
                    theme={themeKind}
                />
            </div>
        </>
    );
};

export interface FabricExplorerProps {
    fabricWorkspaces: FabricWorkspaceInfo[];
    fabricWorkspacesLoadStatus: Status;
    onSignIntoMicrosoftAccount: () => void;
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSelectWorkspace: (workspace: FabricWorkspaceInfo) => void;
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
}
