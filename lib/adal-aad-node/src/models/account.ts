<<<<<<< HEAD
=======
import { ProviderSettings } from "./provider";

>>>>>>> lib
export interface AzureAccount {
    key: AccountKey;
    properties: AzureAccountProperties;
    isStale: boolean;
    delete?: boolean;
}

export interface AccountKey {
    id: string;
    providerId: string;
    accountVersion?: string;
}

export interface Tenant {
    id: string;
    displayName: string;
    userId?: string;
    tenantCategory?: string;
}

export enum AzureAuthType {
    AuthCodeGrant = 0,
    DeviceCode = 1
}

interface AzureAccountProperties {
    /**
     * Auth type of azure used to authenticate this account.
     */
    azureAuthType?: AzureAuthType;

<<<<<<< HEAD
    providerSettings: AzureAccountProviderMetadata;
=======
    providerSettings: ProviderSettings;
>>>>>>> lib
    /**
     * Whether or not the account is a Microsoft account
     */
    isMsAccount: boolean;

    /**
     * A list of tenants (aka directories) that the account belongs to
     */
    tenants: Tenant[];

}
<<<<<<< HEAD

interface AzureAccountProviderMetadata {
    id: string;
    displayName: string;
    args?: any;
    settings?: {};
}
=======
>>>>>>> lib
