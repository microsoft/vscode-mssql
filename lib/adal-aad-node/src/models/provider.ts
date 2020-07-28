export interface ProviderSettings {
    displayName: string;
    id: string;
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
}