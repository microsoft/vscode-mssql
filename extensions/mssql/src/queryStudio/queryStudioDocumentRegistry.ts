/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One QueryStudioDocumentModel per TextDocument URI (doc 04 §4.2): multiple
 * panels attach to one model and share connection/session/results; divergent
 * sessions require the explicit Duplicate-as-New-Query command. Pure map +
 * refcount logic lives here (unit-testable); VS Code wiring stays in the
 * editor provider.
 */

export interface RegistryModel {
    readonly uriKey: string;
    /** Panels currently attached. */
    panelCount: number;
    dispose(): void | Promise<void>;
}

export class QueryStudioDocumentRegistry<TModel extends RegistryModel> {
    private models = new Map<string, TModel>();

    constructor(private readonly factory: (uriKey: string) => TModel) {}

    get size(): number {
        return this.models.size;
    }

    peek(uriKey: string): TModel | undefined {
        return this.models.get(uriKey);
    }

    /** Get-or-create the shared model and attach one panel. */
    attach(uriKey: string): TModel {
        let model = this.models.get(uriKey);
        if (!model) {
            model = this.factory(uriKey);
            this.models.set(uriKey, model);
        }
        model.panelCount++;
        return model;
    }

    /**
     * Detach one panel; the model disposes when the LAST panel detaches
     * (session close, RowStore/spill cleanup — doc 04 §7.3 runs in the
     * model's dispose).
     */
    detach(uriKey: string): { disposed: boolean } {
        const model = this.models.get(uriKey);
        if (!model) {
            return { disposed: false };
        }
        model.panelCount = Math.max(0, model.panelCount - 1);
        if (model.panelCount === 0) {
            this.models.delete(uriKey);
            void model.dispose();
            return { disposed: true };
        }
        return { disposed: false };
    }

    /**
     * URI changed (Save As re-resolve): re-key when the old model survives,
     * else the caller creates fresh. Status interop re-keying happens in the
     * model's own rebind hook.
     */
    rekey(oldUriKey: string, newUriKey: string): boolean {
        const model = this.models.get(oldUriKey);
        if (!model || this.models.has(newUriKey)) {
            return false;
        }
        this.models.delete(oldUriKey);
        this.models.set(newUriKey, model);
        return true;
    }

    /** Extension deactivate: sweep everything. */
    async disposeAll(): Promise<void> {
        const models = [...this.models.values()];
        this.models.clear();
        for (const model of models) {
            try {
                await model.dispose();
            } catch {
                // sweep continues
            }
        }
    }
}
