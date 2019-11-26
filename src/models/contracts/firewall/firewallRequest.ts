/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { RequestType } from 'vscode-languageclient';

// ------------------------------- < Resource Events > ------------------------------------
export namespace CreateFirewallRuleRequest {
	export const type = new RequestType<CreateFirewallRuleParams, CreateFirewallRuleResponse, void, void>('resource/createFirewallRule');
}

export namespace HandleFirewallRuleRequest {
	export const type = new RequestType<HandleFirewallRuleParams, HandleFirewallRuleResponse, void, void>('resource/handleFirewallRule');
}

// Firewall rule interfaces

/**
 * Represents display information for an account.
 */
export interface AccountDisplayInfo {
    /**
     * A display name that offers context for the account, such as "Contoso".
     */
    contextualDisplayName: string;
    /**
     * account provider (eg, Work/School vs Microsoft Account)
     */
    accountType: string;
    /**
     * A display name that identifies the account, such as "User Name".
     */
    displayName: string;
    /**
     * User id that identifies the account, such as "user@contoso.com".
     */
    userId: string;
}

/**
 * Represents a key that identifies an account.
 */
export interface AccountKey {
    /**
     * Identifier of the provider
     */
    providerId: string;
    /**
     * Any arguments that identify an instantiation of the provider
     */
    providerArgs?: any;
    /**
     * Identifier for the account, unique to the provider
     */
    accountId: string;
}

/**
 * Represents an account.
 */
export interface Account {
    /**
     * The key that identifies the account
     */
    key: AccountKey;
    /**
     * Display information for the account
     */
    displayInfo: AccountDisplayInfo;
    /**
     * Custom properties stored with the account
     */
    properties: any;
    /**
     * Indicates if the account needs refreshing
     */
    isStale: boolean;
}

export interface CreateFirewallRuleParams {
	account: Account;
	serverName: string;
	startIpAddress: string;
	endIpAddress: string;
	securityTokenMappings: {};
}

export interface CreateFirewallRuleResponse {
	result: boolean;
	errorMessage: string;
}

export interface HandleFirewallRuleParams {
	errorCode: number;
	errorMessage: string;
	connectionTypeId: string;
}

export interface HandleFirewallRuleResponse {
	result: boolean;
	ipAddress: string;
}

export interface FirewallIpAddressRange {
    startIpAddress: string,
    endIpAddress: string
}
