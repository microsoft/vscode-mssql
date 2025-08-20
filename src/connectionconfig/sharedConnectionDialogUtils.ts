/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormItemActionButton, FormItemSpec } from "../sharedInterfaces/form";
import { ConnectionDialog, refreshTokenLabel } from "../constants/locConstants";
import { AzureController } from "../azure/azureController";
import { getErrorMessage } from "../utils/utils";
import { getAccounts } from "./azureHelpers";
import { FormWebviewController } from "../forms/formWebviewController";
import { Logger } from "../models/logger";
import { AzureAccountService } from "../services/azureAccountService";
import VscodeWrapper from "../controllers/vscodeWrapper";

/**
 * Generates action buttons related to Azure account sign-in and token refresh
 * for a given `FormWebviewController`.
 *
 * Adds a **Sign In** button that allows users to sign into an Azure account,
 * updates the form state with the selected account, and invokes
 * `handlePostSignInUpdates` after a successful login.
 *
 * Optionally adds a **Refresh Token** button if `refreshAccountTokenCondition`
 * is true and the current account token is expired or invalid.
 *
 * @param accountFormController The webview controller managing the account form state.
 * @param accountsComponent The form item spec for the account selection dropdown.
 * @param azureAccountService The Azure account service used to add accounts and fetch tokens.
 * @param logger Logger for capturing verbose, error, and diagnostic messages.
 * @param vscodeWrapper VS Code wrapper for showing user-facing messages.
 * @param handlePostSignInUpdates Callback invoked after sign-in to handle MFA or other updates.
 * @param refreshAccountTokenCondition Optional flag (default = true). If true,
 *        evaluates token validity and conditionally adds a refresh token action button.
 * @returns A list of `FormItemActionButton`s to be rendered in the form.
 */
export async function getAccountActionButtons(
    accountFormController: FormWebviewController<any, any, any, any>,
    accountsComponent: FormItemSpec<any, any, any>,
    azureAccountService: AzureAccountService,
    logger: Logger,
    vscodeWrapper: VscodeWrapper,
    handlePostSignInUpdates: (changedField: string) => Promise<void>,
    refreshAccountTokenCondition: boolean = true,
): Promise<FormItemActionButton[]> {
    console.log(accountsComponent);
    console.log(accountFormController);
    const accountFormComponentId = "accountId";
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

            accountFormController.state.formState.accountId = account.key.id;
            logger.verbose(`Selecting '${account.key.id}'`);

            accountFormController.updateState();
            await handlePostSignInUpdates(accountFormComponentId);
        },
    });

    if (refreshAccountTokenCondition && accountFormController.state.formState.accountId) {
        const account = (await azureAccountService.getAccounts()).find(
            (account) =>
                account.displayInfo.userId === accountFormController.state.formState.accountId,
        );

        if (account) {
            let isTokenExpired = false;
            try {
                const session = await azureAccountService.getAccountSecurityToken(
                    account,
                    undefined,
                );
                isTokenExpired = !AzureController.isTokenValid(session.token, session.expiresOn);
            } catch (err) {
                logger.verbose(
                    `Error getting token or checking validity; prompting for refresh. Error: ${getErrorMessage(err)}`,
                );

                vscodeWrapper.showErrorMessage(
                    "Error validating Entra authentication token; you may need to refresh your token.",
                );

                isTokenExpired = true;
            }

            if (isTokenExpired) {
                actionButtons.push({
                    label: refreshTokenLabel,
                    id: "refreshToken",
                    callback: async () => {
                        const account = (await azureAccountService.getAccounts()).find(
                            (account) =>
                                account.displayInfo.userId ===
                                accountFormController.state.formState.accountId,
                        );
                        if (account) {
                            try {
                                const session = await azureAccountService.getAccountSecurityToken(
                                    account,
                                    undefined,
                                );
                                logger.log("Token refreshed", session.expiresOn);
                            } catch (err) {
                                logger.error(`Error refreshing token: ${getErrorMessage(err)}`);
                            }
                        }
                    },
                });
            }
        }
    }
    return actionButtons;
}
