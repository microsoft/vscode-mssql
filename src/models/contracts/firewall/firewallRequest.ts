/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from 'vscode-languageclient';
import { IAccount } from '../azure/accountInterfaces';

// ------------------------------- < Resource Events > ------------------------------------
export namespace CreateFirewallRuleRequest {
    export const type = new RequestType<ICreateFirewallRuleParams, ICreateFirewallRuleResponse, void, void>('resource/createFirewallRule');
}

export namespace HandleFirewallRuleRequest {
    export const type = new RequestType<IHandleFirewallRuleParams, IHandleFirewallRuleResponse, void, void>('resource/handleFirewallRule');
}

// Firewall rule interfaces


export interface ICreateFirewallRuleParams {
    account: IAccount;
    serverName: string;
    startIpAddress: string;
    endIpAddress: string;
    securityTokenMappings: {};
}

export interface ICreateFirewallRuleResponse {
    result: boolean;
    errorMessage: string;
}

export interface IHandleFirewallRuleParams {
    errorCode: number;
    errorMessage: string;
    connectionTypeId: string;
}

export interface IHandleFirewallRuleResponse {
    result: boolean;
    ipAddress: string;
}

export interface IFirewallIpAddressRange {
    startIpAddress: string;
    endIpAddress: string;
}
