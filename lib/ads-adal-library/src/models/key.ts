/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
interface KVProvider {
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string | undefined | null>;
    clear(): Promise<void>;
    remove(key: string): Promise<boolean>;
}
// used for token storage
export interface SecureStorageProvider extends KVProvider {

}

// used for various caching

export interface CachingProvider extends KVProvider {
    findCredentials(key: string): Promise<{
        account: string;
        password: string;
    }[] | undefined>;
}
export { };

