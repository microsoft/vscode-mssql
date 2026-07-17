/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDisposable {
    dispose(): void;
}

export function isDisposable(value: unknown): value is IDisposable {
    return (
        typeof value === "object" &&
        value !== null &&
        "dispose" in value &&
        typeof (value as IDisposable).dispose === "function"
    );
}

export class DisposableStore implements IDisposable {
    private readonly _disposables = new Set<IDisposable>();
    private _isDisposed = false;

    add<T extends IDisposable>(disposable: T): T {
        if (this._isDisposed) {
            disposable.dispose();
        } else {
            this._disposables.add(disposable);
        }

        return disposable;
    }

    clear(): void {
        for (const disposable of [...this._disposables].reverse()) {
            disposable.dispose();
        }

        this._disposables.clear();
    }

    dispose(): void {
        if (!this._isDisposed) {
            this._isDisposed = true;
            this.clear();
        }
    }
}

export abstract class Disposable implements IDisposable {
    private readonly _store = new DisposableStore();

    protected _register<T extends IDisposable>(disposable: T): T {
        return this._store.add(disposable);
    }

    dispose(): void {
        this._store.dispose();
    }
}
