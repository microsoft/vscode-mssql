/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
export interface ProviderSettings {
    displayName: string;
    id: string;
    clientId: string;
    loginEndpoint: string;
    portalEndpoint: string;
    redirectUri: string;
    resources: ProviderResources;
}

export interface ProviderResources {
    windowsManagementResource: AADResource;
    azureManagementResource: AADResource;
    graphResource?: AADResource;
    databaseResource?: AADResource;
    ossRdbmsResource?: AADResource;
    azureKeyVaultResource?: AADResource;
    azureDevopsResource?: AADResource;
}

export interface AADResource {
    id: string;
    resource: string;
    endpoint: string;
}

/**
 * Parameters to initialize a connection to a database
 */
export interface Credential {
    /**
     * Unique ID identifying the credential
     */
    credentialId: string;

    /**
     * password
     */
    password: string;
}

export interface CredentialProvider {
    handle: number;

    saveCredential(credentialId: string, password: string): Thenable<boolean>;

    readCredential(credentialId: string): Thenable<Credential>;

    deleteCredential(credentialId: string): Thenable<boolean>;
}