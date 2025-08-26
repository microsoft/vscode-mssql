/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useState } from "react";
import { ConnectionDialogContext } from "../../connectionDialogStateProvider";
import FabricWorkspaceFilter from "../fabricWorkspaceFilter";
import { FabricWorkspaceViewer } from "../fabricWorkspaceViewer";
import { WorkspacesList } from "../fabricWorkspacesList";
import {
    InputOnChangeData,
    MenuCheckedValueChangeData,
    MenuCheckedValueChangeEvent,
} from "@fluentui/react-components";

export const FabricBrowsePage = ({ fabricWorkspaces }: FabricExplorerProps) => {
    const context = useContext(ConnectionDialogContext);
    if (context === undefined) {
        return undefined;
    }

    const [searchFilter, setSearchFilter] = useState<string>("");
    const [typeFilter, setTypeFilter] = useState<string[]>(["Show All"]);

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
        <>
            <FabricWorkspaceFilter
                onSearchInputChanged={handleSearchInputChanged}
                onFilterOptionChanged={handleFilterOptionChanged}
                searchValue={searchFilter}
                selectedTypeFilters={typeFilter}
                selectTenantId={(id) => {
                    context.selectAzureTenant(id);
                }}
                azureTenants={context.state.azureTenants}
                selectedTenantId={context.state.selectedTenantId}
            />
            <WorkspacesList
                workspaces={fabricWorkspaces}
                onWorkspaceSelect={handleWorkspaceSelect}
                selectedWorkspace={selectedWorkspace}
                fabricWorkspacesLoadStatus={fabricWorkspacesLoadStatus}
            />
            <FabricWorkspaceViewer
                fabricWorkspacesLoadStatus={context.state.fabricWorkspacesLoadStatus}
                fabricWorkspaces={context.state.fabricWorkspaces}
                searchFilter={searchFilter}
                typeFilter={typeFilter}
                selectFabricWorkspace={context.selectFabricWorkspace}
                onSelectDatabase={handleServerSelected}
            />
        </>
    );
};

export interface FabricExplorerProps {
    fabricWorkspaces: [];
}
