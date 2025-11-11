/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthenticationResult, DeviceCodeRequest, PublicClientApplication } from "@azure/msal-node";
import * as vscode from "vscode";
import * as LocalizedConstants from "../../constants/locConstants";
import VscodeWrapper from "../../controllers/vscodeWrapper";
import { AzureAuthType, IProviderSettings, ITenant } from "../../models/contracts/azure";
import { IDeferred } from "../../models/interfaces";
import { Logger } from "../../models/logger";
import { MsalAzureAuth } from "./msalAzureAuth";

export class MsalAzureDeviceCode extends MsalAzureAuth {
    constructor(
        protected readonly providerSettings: IProviderSettings,
        protected readonly context: vscode.ExtensionContext,
        protected clientApplication: PublicClientApplication,
        protected readonly vscodeWrapper: VscodeWrapper,
        protected readonly logger: Logger,
    ) {
        super(
            providerSettings,
            context,
            clientApplication,
            AzureAuthType.DeviceCode,
            vscodeWrapper,
            logger,
        );
    }

    protected async login(tenant: ITenant): Promise<{
        response: AuthenticationResult;
        authComplete: IDeferred<void, Error>;
    }> {
        let authCompleteDeferred: IDeferred<void, Error>;
        let authCompletePromise = new Promise<void>(
            (resolve, reject) => (authCompleteDeferred = { resolve, reject }),
        );

        let authority = this.loginEndpointUrl + tenant.id;
        this.logger.info(`Authority URL set to: ${authority}`);

        const deviceCodeRequest: DeviceCodeRequest = {
            scopes: this.scopes,
            authority: authority,
            deviceCodeCallback: async (response) => {
                await this.displayDeviceCodeScreen(
                    response.message,
                    response.userCode,
                    response.verificationUri,
                );
            },
        };

        const authResult = await this.clientApplication.acquireTokenByDeviceCode(deviceCodeRequest);
        this.logger.pii(
            `Authentication completed for account: ${authResult?.account!.name}, tenant: ${authResult?.tenantId}`,
        );
        this.closeOnceComplete(authCompletePromise).catch(this.logger.error);

        return {
            response: authResult!,
            authComplete: authCompleteDeferred!,
        };
    }

    private async closeOnceComplete(promise: Promise<void>): Promise<void> {
        await promise;
    }

    public async displayDeviceCodeScreen(
        msg: string,
        userCode: string,
        verificationUrl: string,
    ): Promise<void> {
        // create a notification with the device code message, usercode, and verificationurl
        const selection = await this.vscodeWrapper.showInformationMessage(
            msg,
            LocalizedConstants.msgCopyAndOpenWebpage,
        );
        if (selection === LocalizedConstants.msgCopyAndOpenWebpage) {
            this.vscodeWrapper.clipboardWriteText(userCode);
            await vscode.env.openExternal(vscode.Uri.parse(verificationUrl));
            console.log(msg);
            console.log(userCode);
            console.log(verificationUrl);
        }
        return;
    }
}
