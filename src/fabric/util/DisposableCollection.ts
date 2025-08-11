import * as vscode from 'vscode';

export interface IDisposableCollection {
    /**
     * Adds the disposable to the collection
     */
    add(disposable: { dispose(): any }): void;
}

export class DisposableCollection implements IDisposableCollection {
    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Pushes the disposable to the context's subscriptions.
     * @param disposable The disposable to add.
     */
    public add(disposable: { dispose(): any }): void {
        this.context.subscriptions.push(disposable);
    }
}