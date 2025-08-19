/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormItemActionButton, FormItemSpec, FormState } from "../sharedInterfaces/form";
import { ConnectionDialog, refreshTokenLabel } from "../constants/locConstants";
import { AzureController } from "../azure/azureController";
import { getErrorMessage } from "../utils/utils";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { getAccounts } from "./azureHelpers";
import { AzureAccountService } from "../services/azureAccountService";
import { Logger } from "../models/logger";

export async function getAccountActionButtons(
    azureAccountService: AzureAccountService,
    accountsComponent: FormItemSpec<never, never, never>,
    state: FormState<never, never, never>,
    logger: Logger,
): Promise<FormItemActionButton[]> {
    const actionButtons: FormItemActionButton[] = [];
    actionButtons.push({
        label: ConnectionDialog.signIn,
        id: "azureSignIn",
        callback: async () => {
            const account = await azureAccountService.addAccount();
            logger.verbose(
                `Added Azure account '${account.displayInfo?.displayName}', ${account.key.id}`,
            );

            if (!accountsComponent) {
                logger.error("Account component not found");
                return;
            }

            accountsComponent.options = await getAccounts(azureAccountService, logger);

            logger.verbose(
                `Read ${accountsComponent.options.length} Azure accounts: ${accountsComponent.options.map((a) => a.value).join(", ")}`,
            );

            state.formState.accountId = account.key.id;
            logger.verbose(`Selecting '${account.key.id}'`);

            this.updateState();
            await this.handleAzureMFAEdits("accountId");
        },
    });

    if (
        this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA &&
        this.state.connectionProfile.accountId
    ) {
        const account = (await this._mainController.azureAccountService.getAccounts()).find(
            (account) => account.displayInfo.userId === this.state.connectionProfile.accountId,
        );
        if (account) {
            let isTokenExpired = false;
            try {
                const session =
                    await this._mainController.azureAccountService.getAccountSecurityToken(
                        account,
                        undefined,
                    );
                isTokenExpired = !AzureController.isTokenValid(session.token, session.expiresOn);
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
                            await this._mainController.azureAccountService.getAccounts()
                        ).find(
                            (account) =>
                                account.displayInfo.userId ===
                                this.state.connectionProfile.accountId,
                        );
                        if (account) {
                            try {
                                const session =
                                    await this._mainController.azureAccountService.getAccountSecurityToken(
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
