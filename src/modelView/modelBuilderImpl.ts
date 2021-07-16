/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ButtonComponent, ButtonProperties, Component, ComponentBuilder, ComponentProperties, FormBuilder, ModelBuilder, ModelComponentTypes,
	TextComponent, TextComponentProperties, InputBoxComponent, InputBoxProperties, DropDownComponent, DropDownProperties } from "./interfaces";
import { FormContainerBuilderImpl } from "./formContainerBuilderImpl";
import { ComponentBuilderImpl } from "./componentBuilderImpl";
import { ComponentImpl } from "./componentImpl";
import { ButtonImpl } from "./buttonImpl";
import { DropDownImpl } from "./dropdownImpl";
import { InputBoxImpl } from "./inputBoxImpl"
import { TextComponentImpl } from "./textBoxImpl"

export class ModelBuilderImpl implements ModelBuilder {
    private nextComponentId: number;
    private _handle: number = 1;
    private readonly _componentBuilders = new Map<string, ComponentBuilderImpl<any, ComponentProperties>>();

	constructor() {
		this.nextComponentId = 0;
	}

    private getNextComponentId(): string {
		return `component${this._handle}_${this.nextComponentId++}`;
	}

    getComponentBuilder<T extends Component, TPropertyBag extends ComponentProperties>(component: ComponentImpl, id: string): ComponentBuilderImpl<T, TPropertyBag> {
		let componentBuilder: ComponentBuilderImpl<T, TPropertyBag> = new ComponentBuilderImpl<T, TPropertyBag>(component);
		this._componentBuilders.set(id, componentBuilder);
		return componentBuilder;
	}

    button(): ComponentBuilder<ButtonComponent, ButtonProperties> {
		let id = this.getNextComponentId();
		let builder: ComponentBuilderImpl<ButtonComponent, ButtonProperties> = this.getComponentBuilder(new ButtonImpl(id), id);
		this._componentBuilders.set(id, builder);
		return builder;
	}

	formContainer(): FormBuilder {
        let id = this.getNextComponentId();
        let container = new FormContainerBuilderImpl(ModelComponentTypes.Form, id, this);
        this._componentBuilders.set(id, container);
        return container;
    }
	text(): ComponentBuilder<TextComponent, TextComponentProperties> {
		let id = this.getNextComponentId();
		let builder: ComponentBuilderImpl<TextComponent, TextComponentProperties> = this.getComponentBuilder(new TextComponentImpl(id), id);
		this._componentBuilders.set(id, builder);
		return builder;
	}
	inputBox(): ComponentBuilder<InputBoxComponent, InputBoxProperties> {
		let id = this.getNextComponentId();
		let builder: ComponentBuilderImpl<InputBoxComponent, InputBoxProperties> = this.getComponentBuilder(new InputBoxImpl(id), id);
		this._componentBuilders.set(id, builder);
		return builder;
	}
	dropDown(): ComponentBuilder<DropDownComponent, DropDownProperties> {
		let id = this.getNextComponentId();
		let builder: ComponentBuilderImpl<DropDownComponent, DropDownProperties> = this.getComponentBuilder(new DropDownImpl(id), id);
		this._componentBuilders.set(id, builder);
		return builder;
	}
}
