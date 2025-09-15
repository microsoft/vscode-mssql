/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Refactored to use the FormWebviewController pattern so the webview can render FormField
   components exactly like the Connection dialog. */

import * as vscode from "vscode";
import { FormItemType } from "../sharedInterfaces/form";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogWebviewState,
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
} from "../sharedInterfaces/publishDialog";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
    ) {
        const initialFormState: IPublishForm = {
            profileName: "",
            serverName: "",
            databaseName: getFileNameWithoutExt(projectFilePath),
            publishTarget: "existingServer",
            sqlCmdVariables: {},
        };

        const formComponents: Partial<Record<keyof IPublishForm, PublishDialogFormItemSpec>> = {
            profileName: {
                propertyName: "profileName",
                type: FormItemType.Input,
                label: Loc.ProfileLabel,
                required: false,
                placeholder: Loc.ProfilePlaceholder ?? "",
            },
            serverName: {
                propertyName: "serverName",
                type: FormItemType.Input,
                label: Loc.ServerLabel,
                required: false,
                placeholder: Loc.ServerLabel ?? "",
            },
            databaseName: {
                propertyName: "databaseName",
                type: FormItemType.Input,
                label: Loc.DatabaseLabel,
                required: true,
                placeholder: Loc.DatabaseLabel ?? "",
                validate: (_state, value) => {
                    const isValid = (value as string).trim().length > 0;
                    return {
                        isValid,
                        validationMessage: isValid ? "" : (Loc.DatabaseRequiredMessage ?? ""),
                    };
                },
            },
            publishTarget: {
                propertyName: "publishTarget",
                type: FormItemType.Dropdown,
                label: Loc.PublishTargetLabel,
                required: true,
                options: [
                    {
                        displayName: Loc.PublishTargetExisting ?? "Existing SQL server",
                        value: "existingServer",
                    },
                    {
                        displayName: Loc.PublishTargetContainer ?? "Local development container",
                        value: "localContainer",
                    },
                ],
            },
        };

        const initialState: PublishDialogWebviewState = {
            formState: initialFormState,
            formComponents,
            projectFilePath,
            inProgress: false,
            lastPublishResult: undefined,
            message: undefined,
        };

        super(context, _vscodeWrapper, "publishDialog", "publishDialog", initialState, {
            title: Loc.Title,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "schemaCompare_dark.svg"),
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "schemaCompare_light.svg",
                ),
            },
        });
    }

    protected get reducers() {
        const reducerMap = new Map<any, any>();

        reducerMap.set(
            "setPublishValues",
            async (state: PublishDialogWebviewState, payload: any) => {
                if (payload) {
                    state.formState = { ...state.formState, ...payload };
                    if (payload.projectFilePath) {
                        state.projectFilePath = payload.projectFilePath;
                    }
                }
                this.updateState(state);
                return state;
            },
        );

        reducerMap.set("publishNow", async (state: PublishDialogWebviewState, _payload: any) => {
            // Placeholder publish action; replace with deploy logic.
            state.inProgress = false;
            state.message = { type: "info", text: "Publish action placeholder." };
            this.updateState(state);
            return state;
        });

        reducerMap.set("generatePublishScript", async (state: PublishDialogWebviewState) => {
            state.message = { type: "info", text: "Generate script placeholder." };
            this.updateState(state);
            return state;
        });

        reducerMap.set("openPublishAdvanced", async (state: PublishDialogWebviewState) => {
            state.message = { type: "info", text: "Advanced settings placeholder." };
            this.updateState(state);
            return state;
        });

        reducerMap.set("cancelPublish", async (state: PublishDialogWebviewState) => {
            state.inProgress = false;
            state.message = { type: "info", text: "Publish canceled." };
            this.updateState(state);
            return state;
        });

        reducerMap.set("selectPublishProfile", async (state: PublishDialogWebviewState) => {
            state.message = { type: "info", text: "Select profile placeholder." };
            this.updateState(state);
            return state;
        });

        reducerMap.set(
            "savePublishProfile",
            async (state: PublishDialogWebviewState, payload: any) => {
                if (payload?.profileName) {
                    state.formState.profileName = payload.profileName;
                }
                state.message = { type: "info", text: "Save profile placeholder." };
                this.updateState(state);
                return state;
            },
        );

        return reducerMap;
    }

    protected getActiveFormComponents(_state: PublishDialogWebviewState) {
        return [
            "publishTarget",
            "profileName",
            "serverName",
            "databaseName",
        ] as (keyof IPublishForm)[];
    }

    public async updateItemVisibility(): Promise<void> {
        return;
    }
}

function getFileNameWithoutExt(filePath: string): string {
    if (!filePath) {
        return "";
    }
    const parts = filePath.replace(/\\/g, "/").split("/");
    const last = parts[parts.length - 1];
    return last.replace(/\.[^/.]+$/, "");
}
