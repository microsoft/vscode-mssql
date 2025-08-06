/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getVsCodeVersionName(): string {
    return process.env.VS_CODE_VERSION_NAME ?? "stable";
}

export function getServerName(): string {
    return process.env.SERVER_NAME ?? "";
}

export function getDatabaseName(): string {
    return process.env.DATABASE_NAME ?? "";
}

export function getAuthenticationType(): string {
    console.log(`===: Checking env.AUTHENTICATION_TYPE: '${process.env.AUTHENTICATION_TYPE}'`);

    return process.env.AUTHENTICATION_TYPE ?? "Integrated";
}

export function getUserName(): string {
    return process.env.USER_NAME ?? "";
}

export function getPassword(): string {
    console.log(`===: Checking env.PASSWORD: '${process.env.PASSWORD}'`);
    return process.env.PASSWORD ?? "";
}

export function getSavePassword(): string {
    return process.env.SAVE_PASSWORD ?? "No";
}

export function getProfileName(): string {
    return process.env.PROFILE_NAME ?? "";
}
