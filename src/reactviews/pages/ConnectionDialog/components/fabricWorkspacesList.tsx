/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    List,
    ListItem,
    Label,
    Spinner,
    Tooltip,
    Text,
    mergeClasses,
    SelectionItemId,
} from "@fluentui/react-components";
import { FabricWorkspaceInfo } from "../../../../sharedInterfaces/connectionDialog";
import { useCallback, SyntheticEvent } from "react";
import { ErrorCircleRegular, PeopleTeamRegular } from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { useStyles } from "./fabricWorkspaceViewer.styles";
import { ApiStatus } from "../../../../sharedInterfaces/webview";

interface Props {
    workspaces: FabricWorkspaceInfo[];
    onWorkspaceSelect: (workspace: FabricWorkspaceInfo) => void;
    selectedWorkspace?: FabricWorkspaceInfo;
}

export const WorkspacesList = ({ workspaces, onWorkspaceSelect, selectedWorkspace }: Props) => {
    const styles = useStyles();

    if (!workspaces || workspaces.length === 0) {
        return <Label>{Loc.connectionDialog.noWorkspacesAvailable}</Label>;
    }

    const selectedItems: SelectionItemId[] = selectedWorkspace ? [selectedWorkspace.id] : [];

    const onSelectionChange = useCallback(
        (_: SyntheticEvent | Event, data: { selectedItems: SelectionItemId[] }) => {
            if (data.selectedItems.length > 0) {
                const selectedId = data.selectedItems[0] as string;
                const workspace = workspaces.find((w) => w.id === selectedId);
                if (workspace) {
                    onWorkspaceSelect(workspace);
                }
            }
        },
        [workspaces, onWorkspaceSelect],
    );

    return (
        <List
            role="listbox"
            aria-label={Loc.connectionDialog.workspaces}
            selectionMode="single"
            navigationMode="composite"
            selectedItems={selectedItems}
            onSelectionChange={onSelectionChange}>
            {workspaces.map((workspace) => (
                <ListItem
                    key={workspace.id}
                    value={workspace.id}
                    className={mergeClasses(
                        styles.workspaceItem,
                        selectedItems.includes(workspace.id) && styles.workspaceItemSelected,
                    )}
                    aria-label={workspace.displayName}
                    title={workspace.displayName}
                    checkmark={null}>
                    <div style={{ display: "flex", alignItems: "center", minHeight: "20px" }}>
                        {/* Icon container with consistent styling */}
                        <div className={styles.iconContainer}>
                            {/* display error if workspace status is errored */}
                            {workspace.loadStatus.status === ApiStatus.Error && (
                                <Tooltip
                                    content={workspace.loadStatus.message ?? ""}
                                    relationship="label">
                                    <ErrorCircleRegular style={{ width: "100%", height: "100%" }} />
                                </Tooltip>
                            )}
                            {/* display loading spinner */}
                            {workspace.loadStatus.status === ApiStatus.Loading && (
                                <Spinner
                                    size="extra-tiny"
                                    style={{ width: "100%", height: "100%" }}
                                />
                            )}
                            {/* display workspace icon */}
                            {(workspace.loadStatus.status === ApiStatus.Loaded ||
                                workspace.loadStatus.status === ApiStatus.NotStarted) && (
                                <PeopleTeamRegular style={{ width: "100%", height: "100%" }} />
                            )}
                        </div>

                        <Text
                            style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                            }}>
                            {workspace.displayName}
                        </Text>
                    </div>
                </ListItem>
            ))}
        </List>
    );
};
