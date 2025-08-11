import { IFabricExtensionServiceCollection } from '@fabric/vscode-fabric-api';

export interface ICoreServiceCollectionProvider {
    getCollection(): IFabricExtensionServiceCollection;
}

export class CoreServiceCollectionProvider implements ICoreServiceCollectionProvider {
    private _collection: IFabricExtensionServiceCollection | undefined;
    
    public getCollection(): IFabricExtensionServiceCollection {
        if (!this._collection) {
            throw new Error('service collection has not been set');
        }
        return this._collection;
    }

    public setCollection(collection: IFabricExtensionServiceCollection): void {
        this._collection = collection;
    }
}