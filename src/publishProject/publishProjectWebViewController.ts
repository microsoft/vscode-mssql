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
        "profileName",
        "serverName",
        "databaseName",
    ];

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
    ) {
        const initialFormState: IPublishForm = {
            profileName: "",
            serverName: "",
            databaseName: path.basename(projectFilePath, path.extname(projectFilePath)),
            publishTarget: "existingServer",
            sqlCmdVariables: {},
        };

        const innerState: PublishDialogState = {
            formState: initialFormState,
            formComponents: {},
            projectFilePath,
            inProgress: false,
            lastPublishResult: undefined,
        } as PublishDialogState;

        const initialState: PublishDialogState = innerState;

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

        // Initialize so component generation can be async
        void this.initializeDialog(projectFilePath);
    }

    private async initializeDialog(projectFilePath: string) {
        // Load publish form components
        this.state.formComponents = await generatePublishFormComponents();

        // keep initial project path and computed database name
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        await this.updateItemVisibility();
        this.updateState();
    }

    protected get reducers() {
        type ReducerFn = (
            state: PublishDialogState,
            payload: unknown,
        ) => Promise<PublishDialogState>;
        const reducerMap = new Map<string, ReducerFn>();

        reducerMap.set(
            "setPublishValues",
            async (
                state: PublishDialogState,
                payload: Partial<IPublishForm> & { projectFilePath?: string },
            ) => {
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

        reducerMap.set("publishNow", async (state: PublishDialogState) => {
            state.inProgress = false;
            this.updateState(state);
            return state;
        });

        reducerMap.set("generatePublishScript", async (state: PublishDialogState) => {
            this.updateState(state);
            return state;
        });

        reducerMap.set("selectPublishProfile", async (state: PublishDialogState) => {
            this.updateState(state);
            return state;
        });

        reducerMap.set(
            "savePublishProfile",
            async (state: PublishDialogState, payload: { profileName?: string }) => {
                if (payload?.profileName) {
                    state.formState.profileName = payload.profileName;
                }
                this.updateState(state);
                return state;
            },
        );

        return reducerMap;
    }

    protected getActiveFormComponents(_state: PublishDialogState) {
        return [...PublishProjectWebViewController.mainOptions];
    }

    public async updateItemVisibility(): Promise<void> {
        const hidden: (keyof IPublishForm)[] = [];

        // Example visibility: local container target doesn't require a server name
        if (this.state.formState?.publishTarget === "localContainer") {
            hidden.push("serverName");
        }

        for (const component of Object.values(this.state.formComponents)) {
            // mark hidden if the property is in hidden list
            component.hidden = hidden.includes(component.propertyName as keyof IPublishForm);
        }

        return;
    }
}
