/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Node seam kept out of testable modules (mirrors the codebase's io seams). */
import * as dnsModule from "dns";

export const dns = dnsModule.promises;
