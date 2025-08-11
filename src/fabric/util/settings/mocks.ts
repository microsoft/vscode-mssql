import { IConfigurationProvider } from './ConfigurationProvider';
import * as vscode from 'vscode';
import { FabricEnvironmentName } from './FabricEnvironment';

export class FakeConfigurationProvider implements IConfigurationProvider {
    constructor() {
        void this.update('Environment', FabricEnvironmentName.MOCK);
    }

    private config: Map<string, any> = new Map<string, any>();
    get<T>(key: string, defaultValue: T): T {
        return this.config.get(key) || defaultValue;
    }
    update<T>(key: string, value: T): Thenable<void> {
        this.config.set(key, value);
        return Promise.resolve();
    }
    clear(): void {
        this.config.clear();
    }
    private onDidConfigurationChangeEmitter = new vscode.EventEmitter<string>();
    readonly onDidConfigurationChange = this.onDidConfigurationChangeEmitter.event;
}