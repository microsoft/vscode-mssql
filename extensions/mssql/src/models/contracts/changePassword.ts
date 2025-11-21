/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import {
  ChangePasswordParams,
  ChangePasswordResult,
} from "../../sharedInterfaces/changePassword";

export namespace ChangePasswordRequest {
  export const type = new RequestType<
    ChangePasswordParams,
    ChangePasswordResult,
    void,
    void
  >("connection/changepassword");
}
