/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useMemo, useState } from "react";
import { ConnectionDialogContext } from "../../connectionDialogStateProvider";
import FabricExplorerHeader from "./fabricExplorerHeader.component";
import { FabricWorkspaceContentsList } from "./fabricWorkspaceContentsList.component";
import { FabricWorkspacesList } from "./fabricWorkspacesList.component";
import {
    InputOnChangeData,
    MenuCheckedValueChangeData,
    MenuCheckedValueChangeEvent,
} from "@fluentui/react-components";
import {
    FabricSqlDbInfo,
    FabricWorkspaceInfo,
} from "../../../../../sharedInterfaces/connectionDialog";
import { Status } from "../../../../../sharedInterfaces/webview";
import { useFabricExplorerStyles } from "./fabricExplorer.styles";

export const FabricExplorer = ({
    fabricWorkspaces,
    fabricWorkspacesLoadStatus,
    onSelectAccountId,
    onSelectTenantId,
    onSelectWorkspace,
    onSelectDatabase,
}: FabricExplorerProps) => {
    const context = useContext(ConnectionDialogContext);

    if (context === undefined) {
        return undefined;
    }

    const fabricStyles = useFabricExplorerStyles();

    const [searchFilter, setSearchFilter] = useState<string>("");
    const [typeFilter, setTypeFilter] = useState<string[]>(["Show All"]);

    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);

    const selectedWorkspace = useMemo(() => {
        if (fabricWorkspaces.length === 0 || !selectedWorkspaceId) {
            return undefined;
        }

        return fabricWorkspaces.find((w) => w.id === selectedWorkspaceId);
    }, [fabricWorkspaces, selectedWorkspaceId]);

    function handleSearchInputChanged(_: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) {
        setSearchFilter(data.value);
    }

    function handleDatabaseSelected(database: FabricSqlDbInfo) {
        onSelectDatabase(database);
    }

    function handleWorkspaceSelected(workspace: FabricWorkspaceInfo) {
        setSelectedWorkspaceId(workspace.id);
        onSelectWorkspace(workspace);
    }

    function handleFilterOptionChanged(
        _: MenuCheckedValueChangeEvent,
        { name, checkedItems }: MenuCheckedValueChangeData,
    ) {
        if (name === "sqlType") {
            setTypeFilter(checkedItems);
        }
    }

    function handleSelectAccountId(accountId: string) {
        onSelectAccountId(accountId);
    }

    function handleSelectTenantId(tenantId: string) {
        onSelectTenantId(tenantId);
    }

    return (
        <>
            <FabricExplorerHeader
                searchValue={searchFilter}
                selectedTypeFilters={typeFilter}
                azureAccounts={context.state.azureAccounts}
                azureTenants={context.state.azureTenants}
                selectedAccountId={context.state.selectedAccountId}
                selectedTenantId={context.state.selectedTenantId}
                onSelectAccountId={handleSelectAccountId}
                onSelectTenantId={handleSelectTenantId}
                onSearchInputChanged={handleSearchInputChanged}
                onFilterOptionChanged={handleFilterOptionChanged}
            />
            <div className={fabricStyles.container}>
                <FabricWorkspacesList
                    workspaces={fabricWorkspaces}
                    selectedWorkspace={selectedWorkspace}
                    fabricWorkspacesLoadStatus={fabricWorkspacesLoadStatus}
                    onSelectWorkspace={handleWorkspaceSelected}
                />
                <FabricWorkspaceContentsList
                    fabricWorkspacesLoadStatus={context.state.fabricWorkspacesLoadStatus}
                    selectedWorkspace={selectedWorkspace}
                    searchFilter={searchFilter}
                    typeFilter={typeFilter}
                    onSelectDatabase={handleDatabaseSelected}
                />
            </div>
        </>
    );
};

export interface FabricExplorerProps {
    fabricWorkspaces: FabricWorkspaceInfo[];
    fabricWorkspacesLoadStatus: Status;
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSelectWorkspace: (workspace: FabricWorkspaceInfo) => void;
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
}
