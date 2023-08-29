/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Component, ModelBuilder, ModelView } from "./interfaces";
import { ModelBuilderImpl } from "./modelBuilderImpl";
import { ComponentImpl } from "./componentImpl";
import { IWebviewProxy } from "../protocol";
import * as vscode from 'vscode';

export class ModelViewImpl implements ModelView {
    constructor(protected _proxy: IWebviewProxy) {
        this.modelBuilder = new ModelBuilderImpl(_proxy);
    }

    /**
         * Raised when the view closed.
         */
    readonly onClosed: vscode.Event<any>;

    /**
     * The model backing the model-based view
     */
    readonly modelBuilder: ModelBuilder;

    /**
     * Whether or not the model view's root component is valid
     */
    readonly valid: boolean;

    /**
     * Raised when the model view's valid property changes
     */
    readonly onValidityChanged: vscode.Event<boolean>;

    /**
     * Root component passed into initializeModel
     */
    rootComponent: ComponentImpl;

    /**
     * Run the model view root component's validations
     */
    validate(): Thenable<boolean> {
        return undefined;
    }

    /**
     * Initializes the model with a root component definition.
     * Once this has been done, the components will be laid out in the UI and
     * can be accessed and altered as needed.
     */
    initializeModel<T extends Component>(component: T): Thenable<void> {
        this.rootComponent = <any>component as ComponentImpl;
		//root.onValidityChanged(valid => this._onValidityChangedEmitter.fire(valid));
        return new Promise<void>((resolve) => {
            let shape = this.rootComponent.toComponentShape();
            this._proxy.sendEvent('modelView_initializeModel', shape);
            resolve();
        });
    }
}
