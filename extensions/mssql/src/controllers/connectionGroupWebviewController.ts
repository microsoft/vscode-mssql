/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WebviewPanelController } from "./webviewPanelController";
import {
    ConnectionGroupState,
    ConnectionGroupReducers,
    ConnectionGroupSpec,
    CreateConnectionGroupDialogProps,
} from "../sharedInterfaces/connectionGroup";
import {
    sendActionEvent,
    sendErrorEvent,
    IExtensionContextService,
} from "extension-toolkit/vscode";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getErrorMessage, uuid } from "../utils/utils";
import { Deferred } from "../protocol";
import * as Loc from "../constants/locConstants";
import { IConnectionGroup } from "../models/interfaces";
import { ConnectionConfig, IConnectionConfig } from "../connectionconfig/connectionconfig";
import ConnectionManager from "./connectionManager";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class ConnectionGroupWebviewController extends WebviewPanelController<
    ConnectionGroupState,
    ConnectionGroupReducers,
    boolean
> {
    public readonly initialized: Deferred<void> = new Deferred<void>();

    constructor(
        private connectionGroupToEdit: IConnectionGroup | undefined,
        parentGroupId: string | undefined,
        @IExtensionContextService contextService: IExtensionContextService,
        @IConnectionConfig private connectionConfig: ConnectionConfig,
    ) {
        const groups = connectionConfig.getGroupsFromSettings();
        super(
            contextService.context,
            "connectionGroup",
            "ConnectionGroup",
            getConnectionGroupDialogState(groups, connectionGroupToEdit, parentGroupId),
            {
                title: connectionGroupToEdit
                    ? Loc.ConnectionGroup.editExistingGroup(connectionGroupToEdit.name)
                    : Loc.ConnectionGroup.createNewGroup,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        contextService.context.extensionUri,
                        "media",
                        "connectionGroup_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        contextService.context.extensionUri,
                        "media",
                        "connectionGroup_dark.svg",
                    ),
                },
            },
        );
        this.registerRpcHandlers();
        this.updateState();

        this.initialized.resolve();
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerRpcHandlers(): void {
        this.registerReducer("closeDialog", async (state) => {
            this.dialogResult.resolve(false);
            this.panel.dispose();
            return state;
        });

        this.registerReducer("saveConnectionGroup", async (state, payload) => {
            try {
                if (this.connectionGroupToEdit) {
                    this.logger.debug("Updating existing connection group", payload);
                    const updated = await this.connectionConfig.updateGroup({
                        ...this.connectionGroupToEdit,
                        name: payload.name,
                        description: payload.description,
                        color: payload.color,
                        parentId: payload.parentId,
                    });
                    if (!updated) {
                        return state;
                    }
                } else {
                    this.logger.debug("Creating new connection group", payload);
                    await this.connectionConfig.addGroup(createConnectionGroupFromSpec(payload));
                }

                sendActionEvent(
                    TelemetryViews.ConnectionGroup,
                    TelemetryActions.SaveConnectionGroup,
                    { additionalProps: { newOrEdit: this.connectionGroupToEdit ? "edit" : "new" } },
                );

                this.dialogResult.resolve(true);
                await this.panel.dispose();
            } catch (err) {
                state.message = getErrorMessage(err);
                sendErrorEvent(
                    TelemetryViews.ConnectionGroup,
                    TelemetryActions.SaveConnectionGroup,
                    {
                        error: err,
                        includeErrorMessage: true,
                        additionalProps: { newOrEdit: this.connectionGroupToEdit ? "edit" : "new" },
                    },
                );
            }

            return state;
        });
    }
}

export function createConnectionGroupFromSpec(spec: ConnectionGroupSpec): IConnectionGroup {
    return {
        name: spec.name,
        description: spec.description,
        color: spec.color,
        parentId: spec.parentId,
        id: uuid(),
        configSource: vscode.ConfigurationTarget.Global,
    };
}

/**
 * Builds connection group dialog state, excluding parent choices that would create a cycle.
 */
export function getConnectionGroupDialogState(
    groups: IConnectionGroup[],
    connectionGroupToEdit?: IConnectionGroup,
    parentGroupId?: string,
): ConnectionGroupState {
    const excludedGroupIds = new Set<string>();
    if (connectionGroupToEdit) {
        excludedGroupIds.add(connectionGroupToEdit.id);

        let foundDescendant = true;
        while (foundDescendant) {
            foundDescendant = false;
            for (const group of groups) {
                if (
                    group.parentId &&
                    excludedGroupIds.has(group.parentId) &&
                    !excludedGroupIds.has(group.id)
                ) {
                    excludedGroupIds.add(group.id);
                    foundDescendant = true;
                }
            }
        }
    }

    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const parentGroups = groups
        .filter((group) => !excludedGroupIds.has(group.id))
        .map((group) => ({
            id: group.id,
            name: getParentGroupDisplayName(group, groupsById),
            color: group.color,
            isRoot: group.id === ConnectionConfig.ROOT_GROUP_ID,
        }))
        .sort((a, b) => {
            if (a.isRoot !== b.isRoot) {
                return a.isRoot ? -1 : 1;
            }
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
    const rootGroup = parentGroups.find((group) => group.isRoot);
    const requestedParentId =
        parentGroupId ?? connectionGroupToEdit?.parentId ?? rootGroup?.id ?? "";

    return {
        existingGroupName: connectionGroupToEdit?.name,
        name: connectionGroupToEdit?.name || "",
        description: connectionGroupToEdit?.description || "",
        color: connectionGroupToEdit?.color || "",
        parentId: parentGroups.some((group) => group.id === requestedParentId)
            ? requestedParentId
            : (rootGroup?.id ?? parentGroups[0]?.id ?? ""),
        parentGroups,
        message: "",
    };
}

function getParentGroupDisplayName(
    group: IConnectionGroup,
    groupsById: Map<string, IConnectionGroup>,
): string {
    const path = [group.name];
    const visitedGroupIds = new Set([group.id]);
    let parentId = group.parentId;

    while (parentId && parentId !== ConnectionConfig.ROOT_GROUP_ID) {
        if (visitedGroupIds.has(parentId)) {
            break;
        }
        visitedGroupIds.add(parentId);

        const parent = groupsById.get(parentId);
        if (!parent) {
            break;
        }
        path.unshift(parent.name);
        parentId = parent.parentId;
    }

    return path.join(" / ");
}

/**
 * Shared function to get the default properties for the Create Connection Group dialog.
 */
export function getDefaultConnectionGroupDialogProps(
    groups: IConnectionGroup[],
): CreateConnectionGroupDialogProps {
    return {
        type: "createConnectionGroup",
        props: getConnectionGroupDialogState(groups),
    };
}

/**
 * Shared function for controllers to create a connection group from the provided spec.
 * This function will add the group to the connection store.
 * @param connectionGroupSpec - The specification for the connection group to create.
 * @param connectionManager - The connection manager to use for adding the group.
 * @param telemetryView - The telemetry view to send events to.
 * @return A promise that resolves to the created connection group or an error message.
 */
export async function createConnectionGroup(
    connectionGroupSpec: ConnectionGroupSpec,
    connectionManager: ConnectionManager,
    telemetryView: TelemetryViews,
): Promise<IConnectionGroup | string> {
    const addedGroup = createConnectionGroupFromSpec(connectionGroupSpec);

    try {
        await connectionManager.connectionStore.connectionConfig.addGroup(addedGroup);
        sendActionEvent(telemetryView, TelemetryActions.SaveConnectionGroup, {
            additionalProps: {
                newOrEdit: "new",
            },
        });
    } catch (err) {
        const errorMessage = getErrorMessage(err);
        sendErrorEvent(telemetryView, TelemetryActions.SaveConnectionGroup, {
            error: err,
            includeErrorMessage: false,
            errorType: err.Name,
            additionalProps: {
                failure: err.Name,
            },
        });
        return errorMessage;
    }

    sendActionEvent(telemetryView, TelemetryActions.SaveConnectionGroup);
    return addedGroup;
}
