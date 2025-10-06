/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
    PublishDialogState,
} from "../sharedInterfaces/publishDialog";
import { generatePublishFormComponents } from "./formComponentHelpers";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    public static mainOptions: readonly (keyof IPublishForm)[] = [
        "publishTarget",
        "publishProfilePath",
        "serverName",
        "databaseName",
    ];

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
    ) {
        super(
            context,
            _vscodeWrapper,
            "publishProject",
            "publishProject",
            {
                formState: {
                    publishProfilePath: "",
                    serverName: "",
                    databaseName: path.basename(projectFilePath, path.extname(projectFilePath)),
                    publishTarget: "existingServer",
                    sqlCmdVariables: {},
                },
                formComponents: generatePublishFormComponents(),
                projectFilePath,
                inProgress: false,
                lastPublishResult: undefined,
            } as PublishDialogState,
            {
                title: Loc.Title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_light.svg",
                    ),
                },
            },
        );

        // Register reducers after initialization
        this.registerRpcHandlers();

        // Update visibility based on initial publish target
        void this.updateItemVisibility();
    }

    private registerRpcHandlers(): void {
        this.registerReducer("publishNow", async (state: PublishDialogState) => {
            // TODO: implement actual publish logic (currently just clears inProgress)
            state.inProgress = false;
            return state;
        });

        this.registerReducer("generatePublishScript", async (state: PublishDialogState) => {
            // TODO: implement script generation logic
            return state;
        });

        this.registerReducer("selectPublishProfile", async (state: PublishDialogState) => {
            // TODO: implement profile selection logic
            return state;
        });

        this.registerReducer(
            "savePublishProfile",
            async (state: PublishDialogState, _payload: { publishProfileName?: string }) => {
                // TODO: implement profile saving logic using _payload.publishProfileName
                // This should save current form state to a file with the given name
                return state;
            },
        );
    }

    protected getActiveFormComponents(_state: PublishDialogState) {
        return [...PublishProjectWebViewController.mainOptions];
    }

    public updateItemVisibility(): Promise<void> {
        const hidden: (keyof IPublishForm)[] = [];

        // Example visibility: local container target doesn't require a server name
        if (this.state.formState?.publishTarget === "localContainer") {
            hidden.push("serverName");
        }

        for (const component of Object.values(this.state.formComponents)) {
            // mark hidden if the property is in hidden list
            component.hidden = hidden.includes(component.propertyName as keyof IPublishForm);
        }

        return Promise.resolve();
    }
}
