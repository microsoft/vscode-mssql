/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useMemo, useState } from "react";
import { ConnectionDialogContext } from "../../connectionDialogStateProvider";
import FabricWorkspaceFilter from "../fabricWorkspaceFilter";
import { WorkspaceContentsList } from "../fabricWorkspaceViewer";
import { WorkspacesList } from "../fabricWorkspacesList";
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
import { useFabricBrowserStyles } from "../fabricWorkspaceViewer.styles";

export const FabricExplorer = ({
    fabricWorkspaces,
    fabricWorkspacesLoadStatus,
    onSelectTenantId,
    onSelectWorkspace,
    onSelectDatabase,
}: FabricExplorerProps) => {
    const context = useContext(ConnectionDialogContext);

    if (context === undefined) {
        return undefined;
    }

    const fabricStyles = useFabricBrowserStyles();

    const [searchFilter, setSearchFilter] = useState<string>("");
    const [typeFilter, setTypeFilter] = useState<string[]>(["Show All"]);

    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);
    const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);

    const selectedWorkspace = useMemo(() => {
        return fabricWorkspaces.find((w) => w.id === selectedWorkspaceId);
    }, [fabricWorkspaces, selectedWorkspaceId]);

    function handleSearchInputChanged(_: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) {
        setSearchFilter(data.value);
    }

    function handleDatabaseSelected(database: FabricSqlDbInfo) {
        setSelectedRowId(database.id);
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

    function handleSelectTenantId(tenantId: string) {
        onSelectTenantId(tenantId);
    }

    return (
        <>
            <FabricWorkspaceFilter
                searchValue={searchFilter}
                selectedTypeFilters={typeFilter}
                azureTenants={context.state.azureTenants}
                selectedTenantId={context.state.selectedTenantId}
                onSearchInputChanged={handleSearchInputChanged}
                onFilterOptionChanged={handleFilterOptionChanged}
                onSelectTenantId={handleSelectTenantId}
            />
            <div className={fabricStyles.container}>
                <WorkspacesList
                    workspaces={fabricWorkspaces}
                    selectedWorkspace={selectedWorkspace}
                    fabricWorkspacesLoadStatus={fabricWorkspacesLoadStatus}
                    onSelectWorkspace={handleWorkspaceSelected}
                />
                <WorkspaceContentsList
                    fabricWorkspacesLoadStatus={context.state.fabricWorkspacesLoadStatus}
                    fabricWorkspaces={context.state.fabricWorkspaces}
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
    onSelectTenantId: (tenantId: string) => void;
    onSelectWorkspace: (workspace: FabricWorkspaceInfo) => void;
    onSelectDatabase: (database: FabricSqlDbInfo) => void;
}
