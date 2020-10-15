/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

/**
 * Represents display information for an account.
 */
export interface IAccountDisplayInfo {
    /**
     * account provider (eg, Work/School vs Microsoft Account)
     */
    accountType: AccountType;
    /**
     * User id that identifies the account, such as "user@contoso.com".
     */
    userId: string;
    /**
     * A display name that identifies the account, such as "User Name".
     */
    displayName: string;
    /**
     * email for AAD
     */
    email?: string;
    /**
     * name of account
     */
    name: string;
}

/**
 * Represents a key that identifies an account.
 */
export interface IAccountKey {
    /**
     * Identifier for the account, unique to the provider
     */
    id: string;
    /**
     * Identifier of the provider
     */
    providerId: string;
    /**
     * Version of the account
     */
    accountVersion?: any;
}

/**
 * Represents an account.
 */
export interface IAccount {
    /**
     * The key that identifies the account
     */
    key: IAccountKey;
    /**
     * Display information for the account
     */
    displayInfo: IAccountDisplayInfo;
    /**
     * Custom properties stored with the account
     */
    properties: any;
    /**
     * Indicates if the account needs refreshing
     */
    isStale: boolean;
    /**
     * Indicates if the account is signed in
     */
    isSignedIn?: boolean;
}

export enum AccountType {
    Microsoft = 'microsoft',
    WorkSchool = 'work_school'
}
