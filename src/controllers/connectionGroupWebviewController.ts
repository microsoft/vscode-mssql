/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import {
    ConnectionGroupState,
    ConnectionGroupReducers,
    ConnectionGroupSpec,
    ConnectionGroupConnectionProfile,
} from "../sharedInterfaces/connectionGroup";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { Deferred } from "../protocol";
import * as Loc from "../constants/locConstants";
import { IConnectionGroup } from "../models/interfaces";
import * as Utils from "../models/utils";
import { ConnectionConfig } from "../connectionconfig/connectionconfig";
import { ConnectionStore } from "../models/connectionStore";
import { FormState } from "../sharedInterfaces/form";
import { CreateConnectionGroupDialogProps } from "../sharedInterfaces/connectionDialog";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class ConnectionGroupWebviewController extends ReactWebviewPanelController<
    ConnectionGroupState,
    ConnectionGroupReducers,
    boolean
> {
    public readonly initialized: Deferred<void> = new Deferred<void>();

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private connectionConfig: ConnectionConfig,
        private connectionGroupToEdit?: IConnectionGroup,
    ) {
        super(
            context,
            vscodeWrapper,
            "ConnectionGroup",
            "ConnectionGroup",
            {
                existingGroupName: connectionGroupToEdit?.name,
                name: connectionGroupToEdit?.name || "",
                description: connectionGroupToEdit?.description || "",
                color: connectionGroupToEdit?.color || "",
                message: "",
            },
            {
                title: connectionGroupToEdit
                    ? Loc.ConnectionGroup.editExistingGroup(connectionGroupToEdit.name)
                    : Loc.ConnectionGroup.createNewGroup,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
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
                    this.logger.verbose("Updating existing connection group", payload);
                    await this.connectionConfig.updateGroup({
                        ...this.connectionGroupToEdit,
                        name: payload.name,
                        description: payload.description,
                        color: payload.color,
                    });
                } else {
                    this.logger.verbose("Creating new connection group", payload);
                    await this.connectionConfig.addGroup(createConnectionGroupFromSpec(payload));
                }

                sendActionEvent(
                    TelemetryViews.ConnectionGroup,
                    TelemetryActions.SaveConnectionGroup,
                    { newOrEdit: this.connectionGroupToEdit ? "edit" : "new" },
                );

                this.dialogResult.resolve(true);
                await this.panel.dispose();
            } catch (err) {
                state.message = getErrorMessage(err);
                sendErrorEvent(
                    TelemetryViews.ConnectionGroup,
                    TelemetryActions.SaveConnectionGroup,
                    err,
                    true, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    { newOrEdit: this.connectionGroupToEdit ? "edit" : "new" },
                );
            }

            return state;
        });
    }
}

export function createConnectionGroupFromSpec(spec: ConnectionGroupState): IConnectionGroup {
    return {
        name: spec.name,
        description: spec.description,
        color: spec.color,
        id: Utils.generateGuid(),
    };
}

/**
 * Opens the connection group dialog with the initial state.
 */
export function openConnectionGroupDialog(state) {
    state.dialog = {
        type: "createConnectionGroup",
        props: {},
    } as CreateConnectionGroupDialogProps;

    return state;
}

/**
 * Shared function for controllers to create a connection group from the provided spec.
 * This function will add the group to the connection store and update the form state of the controller.
 * @param connectionGroupSpec - The specification for the connection group to create.
 * @param connectionStore - The connection store to add the group to.
 * @param telemetryView - The telemetry view to send events to.
 * @param state - The form state of the controller.
 * @param formErrorObject - An object to store any error messages that occur during the creation process.
 * @param connectionProfile - The connection profile to update with the new group ID.
 * @return A promise that resolves to the updated form state.
 */
export async function createConnectionGroup(
    connectionGroupSpec: ConnectionGroupSpec,
    connectionStore: ConnectionStore,
    telemetryView: TelemetryViews,
    state: FormState<any, any, any>,
    formErrorObject: string | string[],
    connectionProfile: ConnectionGroupConnectionProfile,
): Promise<FormState<any, any, any>> {
    const addedGroup = createConnectionGroupFromSpec(connectionGroupSpec);

    try {
        await connectionStore.connectionConfig.addGroup(addedGroup);
        sendActionEvent(telemetryView, TelemetryActions.SaveConnectionGroup, {
            newOrEdit: "new",
        });
    } catch (err) {
        const errorMessage = getErrorMessage(err);
        if (Array.isArray(formErrorObject)) {
            formErrorObject.push(errorMessage);
        } else {
            formErrorObject = errorMessage;
        }
        sendErrorEvent(
            telemetryView,
            TelemetryActions.SaveConnectionGroup,
            err,
            false, // includeErrorMessage
            undefined, // errorCode
            err.Name, // errorType
            {
                failure: err.Name,
            },
        );
    }

    sendActionEvent(telemetryView, TelemetryActions.SaveConnectionGroup);
    state.formComponents.groupId.options = await connectionStore.getConnectionGroupOptions();

    // Close the dialog
    if ("dialog" in state) {
        state.dialog = undefined;
    }
    connectionProfile.groupId = addedGroup.id;
    return state;
}
