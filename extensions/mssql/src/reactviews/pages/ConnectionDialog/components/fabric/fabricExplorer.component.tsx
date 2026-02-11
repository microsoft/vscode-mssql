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
import { useFabricExplorerStyles } from "./fabricExplorer.styles";

export const FabricExplorer = ({
    onSignIntoMicrosoftAccount,
    onSelectAccountId,
    onSelectTenantId,
    onSelectWorkspace,
    onSelectDatabase,
}: FabricExplorerProps) => {
    const fabricWorkspaces = useConnectionDialogSelector((s) => s.fabricWorkspaces);

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
                onSignIntoMicrosoftAccount={handleSignIntoMicrosoftAccount}
                onSelectAccountId={handleSelectAccountId}
                onSelectTenantId={handleSelectTenantId}
                onSearchValueChanged={handleSearchValueChanged}
            />
            <div className={fabricStyles.workspaceExplorer}>
                <FabricWorkspacesList
                    workspaces={fabricWorkspaces}
                    selectedWorkspace={selectedWorkspace}
                    onSelectWorkspace={handleWorkspaceSelected}
                />
                <FabricWorkspaceContentsList
                    selectedWorkspace={selectedWorkspace}
                    searchFilter={searchFilter}
                    onSelectDatabase={handleDatabaseSelected}
                />
            </div>
        </>
    );
};

export interface FabricExplorerProps {
    onSignIntoMicrosoftAccount: () => void;
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSelectWorkspace: (workspace: FabricWorkspaceInfo) => void;
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
}
