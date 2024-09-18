/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as coreAuth from "@azure/core-auth";
import { IToken } from "../models/contracts/azure";

/**
 * TokenCredential wrapper to only return the given token.
 * Azure clients usually get a type of credential with a getToken function.
 * Since in mssql extension we get the token differently, we need this wrapper class to just return
 * that token value
 */
export class TokenCredentialWrapper implements coreAuth.TokenCredential {
    constructor(private _token: IToken) {}

    public getToken(
        _: string | string[],
        __?: coreAuth.GetTokenOptions,
    ): Promise<coreAuth.AccessToken | null> {
        return Promise.resolve({
            token: this._token.token,
            expiresOnTimestamp: this._token.expiresOn || 0,
        });
    }
}
