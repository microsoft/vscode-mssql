export interface ProviderSettings {
    displayName: string;
    id: string;
    portalEndpoint: string;
    redirectUri: string;
    resources: ProviderResources;
}

export interface ProviderResources {
    windowsManagementResource: AADResource;
    graphResource?: AADResource;
    azureManagementResource?: AADResource;
    databaseResource?: AADResource;
    ossRdbmsResource?: AADResource;
    azureKeyVaultResource?: AADResource;
    azureDevopsResource?: AADResource;
}

export interface AADResource {
    id: string;
    resource: string;
}