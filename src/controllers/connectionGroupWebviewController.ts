/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { ConnectionGroupState, ConnectionGroupReducers } from "../sharedInterfaces/connectionGroup";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { Deferred } from "../protocol";
import * as Loc from "../constants/locConstants";
import { IConnectionGroup } from "../models/interfaces";
import * as Utils from "../models/utils";
import { ConnectionConfig } from "../connectionconfig/connectionconfig";

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
