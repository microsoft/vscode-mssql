/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import MainController from "../controllers/mainController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { FormWebviewController } from "../forms/formWebviewController";
import {
    FabricProvisioningFormState,
    FabricProvisioningWebviewState,
    FabricProvisioningFormItemSpec,
    FabricProvisioningReducers,
} from "../sharedInterfaces/fabricProvisioning";
import { ApiStatus } from "../sharedInterfaces/webview";
import { getAccounts } from "../connectionconfig/azureHelpers";
import { getErrorMessage } from "../utils/utils";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../sharedInterfaces/form";
import { ConnectionDialog, refreshTokenLabel } from "../constants/locConstants";
import { AzureController } from "../azure/azureController";
import { IToken } from "../azure/msal/msalAzureAuth";

export class FabricProvisioningWebviewController extends FormWebviewController<
    FabricProvisioningFormState,
    FabricProvisioningWebviewState,
    FabricProvisioningFormItemSpec,
    FabricProvisioningReducers
> {
    requiredInputs: FabricProvisioningFormItemSpec[];
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
    ) {
        super(
            context,
            vscodeWrapper,
            "fabricProvisioning",
            "fabricProvisioning",
            new FabricProvisioningWebviewState(),
            {
                title: "Fabric Provisioning",
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "connectionDialogEditor_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "connectionDialogEditor_light.svg",
                    ),
                },
            },
        );
        void this.initialize();
    }

    private async initialize() {
        this.state.loadState = ApiStatus.Loading;
        const connectionGroupOptions =
            await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
        this.state.formState = {
            accountId: "",
            groupId: connectionGroupOptions[0].value,
            databaseName: "",
            workspace: "",
        } as FabricProvisioningFormState;
        const azureAccountOptions = await getAccounts(
            this.mainController.azureAccountService,
            this.logger,
        );
        const azureActionButtons = await this.getAzureActionButtons();
        this.state.formComponents = this.setFabricProvisioningFormComponents(
            azureAccountOptions,
            azureActionButtons,
        );
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {}

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: FabricProvisioningWebviewState,
    ): (keyof FabricProvisioningFormState)[] {
        return Object.keys(state.formComponents) as (keyof FabricProvisioningFormState)[];
    }

    private setFabricProvisioningFormComponents(
        azureAccountOptions: FormItemOptions[],
        azureActionButtons: FormItemActionButton[],
    ): Record<
        string,
        FormItemSpec<
            FabricProvisioningFormState,
            FabricProvisioningWebviewState,
            FabricProvisioningFormItemSpec
        >
    > {
        const createFormItem = (
            spec: Partial<FabricProvisioningFormItemSpec>,
        ): FabricProvisioningFormItemSpec =>
            ({
                required: false,
                isAdvancedOption: false,
                ...spec,
            }) as FabricProvisioningFormItemSpec;

        return {
            accountId: createFormItem({
                propertyName: "accountId",
                label: ConnectionDialog.fabricAccount,
                required: true,
                type: FormItemType.Dropdown,
                options: azureAccountOptions,
                placeholder: ConnectionDialog.selectAnAccount,
                actionButtons: azureActionButtons,
                validate: (_state: FabricProvisioningWebviewState, value: string) => ({
                    isValid: !!value,
                    validationMessage: value ? "" : ConnectionDialog.azureAccountIsRequired,
                }),

                isAdvancedOption: false,
            }),
        };
    }

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        const actionButtons: FormItemActionButton[] = [];
        actionButtons.push({
            label: ConnectionDialog.signIn,
            id: "azureSignIn",
            callback: async () => {
                const account = await this.mainController.azureAccountService.addAccount();
                this.logger.verbose(
                    `Added Azure account '${account.displayInfo?.displayName}', ${account.key.id}`,
                );

                const accountsComponent = this.getFormComponent(this.state, "accountId");

                if (!accountsComponent) {
                    this.logger.error("Account component not found");
                    return;
                }

                accountsComponent.options = await getAccounts(
                    this.mainController.azureAccountService,
                    this.logger,
                );

                this.logger.verbose(
                    `Read ${accountsComponent.options.length} Azure accounts: ${accountsComponent.options.map((a) => a.value).join(", ")}`,
                );

                this.state.formState.accountId = account.key.id;

                this.logger.verbose(`Selecting '${account.key.id}'`);

                this.updateState();
            },
        });

        if (this.state.formState.accountId) {
            let session: IToken;
            const account = (await this.mainController.azureAccountService.getAccounts()).find(
                (account) => account.displayInfo.userId === this.state.formState.accountId,
            );
            if (account) {
                let isTokenExpired = false;
                try {
                    session = await this.mainController.azureAccountService.getAccountSecurityToken(
                        account,
                        undefined,
                    );
                    isTokenExpired = !AzureController.isTokenValid(
                        session.token,
                        session.expiresOn,
                    );
                } catch (err) {
                    this.logger.verbose(
                        `Error getting token or checking validity; prompting for refresh. Error: ${getErrorMessage(err)}`,
                    );

                    this.vscodeWrapper.showErrorMessage(
                        "Error validating Entra authentication token; you may need to refresh your token.",
                    );

                    isTokenExpired = true;
                }

                if (isTokenExpired) {
                    actionButtons.push({
                        label: refreshTokenLabel,
                        id: "refreshToken",
                        callback: async () => {
                            const account = (
                                await this.mainController.azureAccountService.getAccounts()
                            ).find(
                                (account) =>
                                    account.displayInfo.userId === this.state.formState.accountId,
                            );
                            if (account) {
                                try {
                                    session =
                                        await this.mainController.azureAccountService.getAccountSecurityToken(
                                            account,
                                            undefined,
                                        );
                                    this.logger.log("Token refreshed", session.expiresOn);
                                } catch (err) {
                                    this.logger.error(
                                        `Error refreshing token: ${getErrorMessage(err)}`,
                                    );
                                }
                            }
                        },
                    });
                }
            }
        }
        return actionButtons;
    }
}
