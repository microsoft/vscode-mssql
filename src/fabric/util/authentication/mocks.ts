/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import {
    ITokenAcquisitionService,
    TokenRequestOptions,
    VsCodeAuthentication,
} from "./TokenAcquisitionService";
import { IAccountProvider, ITenantSettings } from "./AccountProvider";

export class MockVsCodeAuthentication implements VsCodeAuthentication {
    static readonly instance = new MockVsCodeAuthentication();
    readonly didChangeSessionsEmitter =
        new vscode.EventEmitter<vscode.AuthenticationSessionsChangeEvent>();

    lastRequestProviderId: string | undefined = undefined;
    lastRequestScopes: readonly string[] = [];
    lastRequestOptions: vscode.AuthenticationGetSessionOptions | undefined = undefined;
    responseToProvide: vscode.AuthenticationSession | undefined = undefined;

    onDidChangeSessions = this.didChangeSessionsEmitter.event;
    getSession(
        providerId: string,
        scopes: readonly string[],
        options: vscode.AuthenticationGetSessionOptions,
    ): Thenable<vscode.AuthenticationSession | undefined> {
        this.lastRequestProviderId = providerId;
        this.lastRequestScopes = scopes;
        this.lastRequestOptions = options;
        return Promise.resolve(this.responseToProvide);
    }
}

export class MockTokenAcquisitionService implements ITokenAcquisitionService {
    getArmAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null> {
        throw new Error("Method not implemented.");
    }
    readonly #msSessionChangedEmitter = new vscode.EventEmitter<void>();
    readonly msSessionChanged = this.#msSessionChangedEmitter.event;

    getSessionInfo(
        options: TokenRequestOptions,
        extraScopes?: string[] | undefined,
    ): Promise<vscode.AuthenticationSession | null> {
        return Promise.resolve(null);
    }
    getMsAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[] | undefined,
    ): Promise<string | null> {
        throw new Error("Method not implemented.");
    }
}

export class MockAccountProvider implements IAccountProvider {
    #isSignedIn: boolean = true;

    readonly #onSuccessfulSignInEmitter = new vscode.EventEmitter<void>();
    readonly onSuccessfulSignIn = this.#onSuccessfulSignInEmitter.event;

    readonly #onSignInChangedEmitter = new vscode.EventEmitter<void>();
    readonly onSignInChanged = this.#onSignInChangedEmitter.event;

    readonly #onTenantChangedEmitter = new vscode.EventEmitter<void>();
    readonly onTenantChanged = this.#onTenantChangedEmitter.event;

    public loginCount: number = 0;
    constructor() {
        this.#isSignedIn = true;
    }
    getCurrentTenant(): Promise<ITenantSettings | undefined> {
        throw new Error("Method not implemented.");
    }
    getTenants(): Promise<ITenantSettings[]> {
        throw new Error("Method not implemented.");
    }

    getAccountInfo(
        askToSignIn: boolean,
    ): Promise<vscode.AuthenticationSessionAccountInformation | null> {
        throw new Error("Method not implemented.");
    }
    async signIn(): Promise<boolean> {
        this.#isSignedIn = true;
        this.loginCount++;
        this.#onSuccessfulSignInEmitter.fire();
        return true;
    }
    async isSignedIn(): Promise<boolean> {
        return this.#isSignedIn;
    }
    async getDefaultTelemetryProperties(): Promise<{ [key: string]: string }> {
        return {
            "common.tenantid": "ten-ant-id",
            "common.extmode": "2",
        };
    }
    async getToken(): Promise<string> {
        return "mock token";
    }

    awaitSignIn(): Promise<void> {
        return Promise.resolve();
    }
}
