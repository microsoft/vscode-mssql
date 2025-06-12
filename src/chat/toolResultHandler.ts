/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import { NotificationType } from "vscode-languageclient";

// /**
//  * API for handling tool result subscriptions.
//  */
// export interface IToolResultHandler {
//     waitForResult<T>(responseId: string): Promise<T>;
// }

// /**
//  * Generic notification payload for tool results.
//  */
// export interface ToolResultNotification<T> {
//     responseId: string;
//     result?: T;
//     error?: string;
// }

// export interface MssqlToolRequestResponse {
//     responseId: string;
// }

// export namespace ToolResultNotification {
//     export const type = new NotificationType<ToolResultNotification<unknown>, void>(
//         "tools/result-notification",
//     );
// }
