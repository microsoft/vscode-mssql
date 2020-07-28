interface KVProvider {
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string>;
    clear(): Promise<void>;
    remove(key: string): Promise<void>;
}

// used for token storage
export interface SecureStorageProvider extends KVProvider {

}

// used for various caching
export interface CachingProvider extends KVProvider {

}