/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Refactored to use the FormWebviewController pattern so the webview can render FormField
   components exactly like the Connection dialog. */

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogWebviewState,
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
} from "../sharedInterfaces/publishDialog";
import { generatePublishFormComponents, groupAdvancedOptions } from "./formComponentHelpers";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogWebviewState,
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
        schemaCompareOptionsResult?: mssql.SchemaCompareOptionsResult,
    ) {
        const initialFormState: IPublishForm = {
            profileName: "",
            serverName: "",
            databaseName: getFileNameWithoutExt(projectFilePath),
            publishTarget: "existingServer",
            sqlCmdVariables: {},
        };

        const initialState: PublishDialogWebviewState = {
            formState: initialFormState,
            formComponents: {},
            projectFilePath,
            inProgress: false,
            lastPublishResult: undefined,
            message: undefined,
            connectionComponents: {
                mainOptions: [
                    ...(PublishProjectWebViewController.mainOptions as (keyof IPublishForm)[]),
                ],
                groupedAdvancedOptions: [],
            } as any,
            defaultDeploymentOptionsResult: schemaCompareOptionsResult,
        } as PublishDialogWebviewState;

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

        // async initialize so component generation can be async (mirrors connection dialog pattern)
        void this.initializeDialog(projectFilePath);
    }

    private async initializeDialog(projectFilePath: string) {
        // Load publish form components
        this.state.formComponents = await generatePublishFormComponents(
            this.state.defaultDeploymentOptionsResult,
        );

        // Configure which items are main vs advanced
        this.state.connectionComponents = {
            mainOptions: [...PublishProjectWebViewController.mainOptions],
            groupedAdvancedOptions: [],
        } as any;

        this.state.connectionComponents.groupedAdvancedOptions = groupAdvancedOptions(
            this.state.formComponents as Record<keyof IPublishForm, PublishDialogFormItemSpec>,
        );

        // if schema compare defaults were passed in, map matching option keys into formState
        const defaults = this.state.defaultDeploymentOptionsResult?.defaultDeploymentOptions;
        if (defaults) {
            // boolean options -> set matching form fields
            const bools = defaults.booleanOptionsDictionary ?? {};
            for (const key of Object.keys(bools)) {
                if ((this.state.formComponents as any)[key]) {
                    // @ts-ignore set only when a corresponding form field exists
                    (this.state.formState as any)[key] = bools[key].value;
                }
            }

            // excludeObjectTypes -> if publish form has matching control
            if (
                (defaults as mssql.DeploymentOptions).excludeObjectTypes &&
                (this.state.formComponents as any)["excludeObjectTypes"]
            ) {
                (this.state.formState as any)["excludeObjectTypes"] = (
                    defaults as any
                ).excludeObjectTypes.value;
            }

            // exclude object types defaults -> set per-object checkbox components (exclude_{type})
            const excludedList: string[] = (defaults as any).excludeObjectTypes?.value ?? [];
            const objectTypes = defaults.objectTypesDictionary ?? {};
            for (const key of Object.keys(objectTypes)) {
                const propName = `exclude_${key}`;
                if ((this.state.formComponents as any)[propName]) {
                    (this.state.formState as any)[propName] = excludedList.includes(key);
                }
            }
        }

        // keep initial project path and computed database name
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        await this.updateItemVisibility();
        this.updateState();
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

function getFileNameWithoutExt(filePath: string): string {
    if (!filePath) {
        return "";
    }
    const parts = filePath.replace(/\\/g, "/").split("/");
    const last = parts[parts.length - 1];
    return last.replace(/\.[^/.]+$/, "");
}
