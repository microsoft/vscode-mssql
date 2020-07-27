interface KVProvider {
    set(key: string, value: string): Promise<void>;
    get(key: string, value: string): Promise<void>;
    clear(): Promise<void>;
}

interface SecureStorageProvider extends KVProvider {

}