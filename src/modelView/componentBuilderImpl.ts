/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ComponentImpl } from "./componentImpl";
import { Component, ComponentBuilder, ComponentProperties } from "./interfaces";

export class ComponentBuilderImpl<TComponent extends Component, TPropertyBag extends ComponentProperties> implements ComponentBuilder<TComponent, TPropertyBag> {

    constructor(protected _component: ComponentImpl) {
    }

    component(): TComponent {
        return <TComponent><any>this._component;
    }

    withProperties<U>(properties: U): ComponentBuilder<TComponent, TPropertyBag> {
        return undefined;
    }

    withValidation(validation: (component: TComponent) => boolean | Thenable<boolean>): ComponentBuilder<TComponent, TPropertyBag> {
        return undefined;
    }
}
