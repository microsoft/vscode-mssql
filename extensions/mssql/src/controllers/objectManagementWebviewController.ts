/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementCancelNotification,
    ObjectManagementDialogType,
    ObjectManagementFormItemSpec,
    ObjectManagementFormState,
    ObjectManagementHelpNotification,
    ObjectManagementReducers,
    ObjectManagementScriptRequest,
    ObjectManagementSubmitRequest,
    ObjectManagementWebviewState,
} from "../sharedInterfaces/objectManagement";
import VscodeWrapper from "./vscodeWrapper";
import { ObjectManagementService } from "../services/objectManagementService";
import { generateGuid } from "../models/utils";
import { getErrorMessage } from "../utils/utils";
import * as LocConstants from "../constants/locConstants";
import { FormWebviewController } from "../forms/formWebviewController";
import { FormItemSpec } from "../sharedInterfaces/form";

export abstract class ObjectManagementWebviewController extends FormWebviewController<
    ObjectManagementFormState,
    ObjectManagementWebviewState,
    ObjectManagementFormItemSpec,
    ObjectManagementReducers,
    string
> {
    protected readonly contextId = generateGuid();
    protected readonly objectManagementService: ObjectManagementService;
    protected readonly dialogType: ObjectManagementDialogType;
    protected readonly connectionUri: string;
    protected readonly serverName: string;
    protected readonly databaseName?: string;
    protected readonly parentUrn?: string;
    protected readonly objectUrn?: string;

    /**
     * Constructor for ObjectManagementWebviewController
     * @param context extension context
     * @param vscodeWrapper vscode wrapper instance
     * @param objectManagementService object management service instance
     * @param dialogType type of the dialog
     * @param dialogTitle title of the dialog
     * @param webviewTitle title of the webview tab
     * @param sourceFile source file path
     * @param connectionUri connection URI
     * @param serverName server name
     * @param databaseName database name
     * @param parentUrn parent URN
     * @param objectUrn object URN
     */
    protected constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        dialogType: ObjectManagementDialogType,
        dialogTitle: string,
        webviewTitle: string,
        sourceFile: string,
        connectionUri: string,
        serverName: string,
        databaseName?: string,
        parentUrn?: string,
        objectUrn?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            sourceFile,
            sourceFile,
            {
                viewModel: {
                    dialogType,
                },
                isLoading: true,
                dialogTitle,

                // Initial empty form state
                formState: {} as ObjectManagementFormState,
                formComponents: {},
                formErrors: [],

                // Empty file browser state
                ownerUri: connectionUri,
                fileFilterOptions: [],
                fileBrowserState: undefined,
                defaultFileBrowserExpandPath: "",
                dialog: undefined,
            },
            {
                title: webviewTitle,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                },
                preserveFocus: true,
            },
        );

        this.objectManagementService = objectManagementService;
        this.dialogType = dialogType;
        this.connectionUri = connectionUri;
        this.serverName = serverName;
        this.databaseName = databaseName;
        this.parentUrn = parentUrn;
        this.objectUrn = objectUrn;

        this.registerRpcHandlers();
    }

    protected abstract initializeDialog(): Promise<void>;
    protected abstract handleSubmit(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult>;
    protected abstract handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult>;

    protected abstract get helpLink(): string;

    protected start(): void {
        void this.initializeDialog();
    }

    protected updateWebviewState(partial: Partial<ObjectManagementWebviewState>): void {
        this.state = {
            ...this.state,
            ...partial,
        };
    }

    protected async disposeView(): Promise<void> {
        try {
            await this.objectManagementService.disposeView(this.contextId);
        } catch {
            // Best effort cleanup only.
        }
    }

    protected async openScriptInEditor(script: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument({
                language: "sql",
                content: script,
            });
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            this.logger.error(`Failed to open script: ${getErrorMessage(error)}`);
            void this.vscodeWrapper.showErrorMessage(LocConstants.msgScriptingEditorFailed);
        }
    }

    protected closeDialog(result?: string): void {
        this.dialogResult.resolve(result);
        this.panel.dispose();
    }

    private async handleSubmitRequest(
        payload: ObjectManagementActionParams,
    ): Promise<ObjectManagementActionResult> {
        if (payload.dialogType !== this.dialogType) {
            return { success: false, errorMessage: LocConstants.msgObjectManagementUnknownDialog };
        }

        return await this.handleSubmit(payload.params);
    }

    private async handleScriptRequest(
        payload: ObjectManagementActionParams,
    ): Promise<ObjectManagementActionResult> {
        if (payload.dialogType !== this.dialogType) {
            return { success: false, errorMessage: LocConstants.msgObjectManagementUnknownDialog };
        }

        return await this.handleScript(payload.params);
    }

    private registerRpcHandlers(): void {
        this.onRequest(ObjectManagementSubmitRequest.type, async (params) => {
            return await this.handleSubmitRequest(params);
        });

        this.onRequest(ObjectManagementScriptRequest.type, async (params) => {
            return await this.handleScriptRequest(params);
        });

        this.onNotification(ObjectManagementCancelNotification.type, () => {
            void this.disposeView();
            this.dialogResult.resolve(undefined);
            this.panel.dispose();
        });

        this.onNotification(ObjectManagementHelpNotification.type, () => {
            void this.vscodeWrapper.openExternal(this.helpLink);
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: ObjectManagementWebviewState,
    ): (keyof ObjectManagementFormState)[] {
        return Object.keys(state.formComponents) as (keyof ObjectManagementFormState)[];
    }

    // This can be overridden by subclasses to provide form components
    protected setFormComponents(): Record<
        string,
        FormItemSpec<
            ObjectManagementFormState,
            ObjectManagementWebviewState,
            ObjectManagementFormItemSpec
        >
    > {
        return {};
    }
}
