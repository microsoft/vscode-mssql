/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as os from "os";
import { IFabricEnvironmentProvider } from "../settings/FabricEnvironmentProvider";
import {
    getSessionProviderForEnvironment,
    msSessionProvider,
    msSessionProviderPPE,
} from "./helpers";
import { TelemetryService } from "../telemetry/TelemetryService";
import { ITokenAcquisitionService, TokenRequestOptions } from "./TokenAcquisitionService";

export class FakeTokenAcquisitionService implements ITokenAcquisitionService {
    getArmAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null> {
        throw new Error("Method not implemented.");
    }
    private readonly msSessionChangedEmitter = new vscode.EventEmitter<void>();
    public readonly msSessionChanged = this.msSessionChangedEmitter.event;

    async getSessionInfo(
        options: TokenRequestOptions,
        extraScopes?: string[],
    ): Promise<vscode.AuthenticationSession | null> {
        const session = {
            id: "fake-session-id",
            scopes: extraScopes,
            accessToken: await this.getToken(),
            account: { id: "fake-account-id", label: "fake-account-label" },
            // idToken: '{"email":"fake-user@microsoft.com", "tid":"fake-tenant-id"}'
        };
        return Promise.resolve(session as vscode.AuthenticationSession);
    }
    async getMsAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
    ): Promise<string | null> {
        return await this.getToken();
    }

    private async getToken(): Promise<string | null> {
        const tokenFilePath = vscode.Uri.file(`${os.homedir()}/.fabric-token`);
        try {
            const token = await vscode.workspace.fs.readFile(tokenFilePath);
            return Buffer.from(token).toString("utf8");
        } catch (error) {
            console.error("Error reading token file:", error);
            return null;
        }
    }
}
