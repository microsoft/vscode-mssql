import * as vscode from 'vscode';
import { IDisposableCollection } from '../DisposableCollection';

export interface IConfigurationProvider {
    get<T>(key: string, defaultValue: T): T;
    update<T>(key: string, value: T): Thenable<void>;
    onDidConfigurationChange: vscode.Event<string>;
}

export class ConfigurationProvider implements IConfigurationProvider {
    private section: string = 'Fabric';

    // This is a set of keys that we are tracking for changes. Will fire the onDidConfigurationChange event for each key that is changed.
    private keys: Set<string> = new Set<string>();

    private readonly onDidConfigurationChangeEmitter = new vscode.EventEmitter<string>();
    readonly onDidConfigurationChange = this.onDidConfigurationChangeEmitter.event;
    
    public constructor(private disposables: IDisposableCollection) {
        this.disposables.add(vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration(this.section)) {
                this.keys.forEach(key => {
                    // Only fire the event for the keys which have been changed
                    if (e.affectsConfiguration(`${this.section}.${key}`)) {
                        this.onDidConfigurationChangeEmitter.fire(key);
                    }
                });
            }
        }));
    }

    public get<T>(key: string, defaultValue: T): T {
        this.keys.add(key);
        return vscode.workspace.getConfiguration(this.section).get<T>(key, defaultValue);
    }

    public update<T>(key: string, value: T): Thenable<void> {
        this.keys.add(key);
        return vscode.workspace.getConfiguration(this.section).update(key, value, vscode.ConfigurationTarget.Global);
    }
}

