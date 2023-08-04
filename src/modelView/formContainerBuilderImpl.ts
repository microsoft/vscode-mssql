/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { assign } from 'underscore';
import { ComponentBuilderImpl } from './componentBuilderImpl';
import { ComponentImpl, InternalItemConfig } from './componentImpl';
import { ModelBuilderImpl } from './modelBuilderImpl';
import * as azdata from './interfaces';

class ContainerBuilderImpl<TComponent extends azdata.Component, TLayout, TItemLayout, TPropertyBag extends azdata.ComponentProperties> extends ComponentBuilderImpl<TComponent, TPropertyBag> implements azdata.ContainerBuilder<TComponent, TLayout, TItemLayout, TPropertyBag> {
	constructor(componentWrapper: ComponentImpl) {
		super(componentWrapper);
	}

	withLayout(layout: TLayout): azdata.ContainerBuilder<TComponent, TLayout, TItemLayout, TPropertyBag> {
		this._component.layout = layout;
		return this;
	}

	withItems(components: azdata.Component[], itemLayout?: TItemLayout): azdata.ContainerBuilder<TComponent, TLayout, TItemLayout, TPropertyBag> {
		this._component.itemConfigs = components.map(item => {
			let componentWrapper = item as ComponentImpl;
			return new InternalItemConfig(componentWrapper, itemLayout);
		});
		return this;
	}
}

class GenericContainerBuilder<T extends azdata.Component, TLayout, TItemLayout, TPropertyBag extends azdata.ComponentProperties> extends ContainerBuilderImpl<T, TLayout, TItemLayout, TPropertyBag> {
	constructor(type: azdata.ModelComponentTypes, id: string) {
		super(new ComponentImpl(undefined, type, id));
	}
}

export class FormContainerBuilderImpl extends GenericContainerBuilder<azdata.FormContainer, azdata.FormLayout, azdata.FormItemLayout, azdata.ComponentProperties> implements azdata.FormBuilder {
	constructor(type: azdata.ModelComponentTypes, id: string, private _builder: ModelBuilderImpl) {
		super(type, id);
	}

	withFormItems(components: (azdata.FormComponent | azdata.FormComponentGroup)[], itemLayout?: azdata.FormItemLayout): azdata.FormBuilder {
		this.addFormItems(components, itemLayout);
		return this;
	}

	private convertToItemConfig(formComponent: azdata.FormComponent, itemLayout?: azdata.FormItemLayout): InternalItemConfig {
		let componentWrapper = formComponent.component as ComponentImpl;
		if (formComponent.required && componentWrapper) {
			componentWrapper.required = true;
		}
		if (formComponent.title && componentWrapper) {
			componentWrapper.ariaLabel = formComponent.title;
			// if (componentWrapper instanceof LoadingComponentWrapper) {
			// 	componentWrapper.component.ariaLabel = formComponent.title;
			// 	let containedComponent = componentWrapper.component as any;
			// 	if (containedComponent.required) {
			// 		componentWrapper.required = containedComponent.required;
			// 	}
			// }
		}
		let actions: string[] = undefined;
		if (formComponent.actions) {
			actions = formComponent.actions.map(action => {
				let actionComponentWrapper = action as ComponentImpl;
				return actionComponentWrapper.id;
			});
		}

		return new InternalItemConfig(componentWrapper, assign({}, itemLayout || {}, {
			title: formComponent.title,
			actions: actions,
			isFormComponent: true,
			required: componentWrapper.required
		}));
	}

	private addComponentActions(formComponent: azdata.FormComponent, itemLayout?: azdata.FormItemLayout): void {
		if (formComponent.actions) {
			formComponent.actions.forEach(component => {
				let componentWrapper = component as ComponentImpl;
				this._component.addItem(componentWrapper, itemLayout);
			});
		}
	}

	private removeComponentActions(formComponent: azdata.FormComponent): void {
		if (formComponent.actions) {
			formComponent.actions.forEach(component => {
				let componentWrapper = component as ComponentImpl;
				this._component.removeItem(componentWrapper);
			});
		}
	}

	addFormItems(formComponents: Array<azdata.FormComponent | azdata.FormComponentGroup>, itemLayout?: azdata.FormItemLayout): void {
		formComponents.forEach(formComponent => {
			this.addFormItem(formComponent, itemLayout);
		});
	}

	addFormItem(formComponent: azdata.FormComponent | azdata.FormComponentGroup, itemLayout?: azdata.FormItemLayout): void {
		this.insertFormItem(formComponent, undefined, itemLayout);
	}

	insertFormItem(formComponent: azdata.FormComponent | azdata.FormComponentGroup, index?: number, itemLayout?: azdata.FormItemLayout): void {
		let componentGroup = formComponent as azdata.FormComponentGroup;
		if (componentGroup && componentGroup.components !== undefined) {

            // TODO come back to labels
            // let labelComponent = this._builder.text().component();
			// labelComponent.value = componentGroup.title;
			// this._component.addItem(labelComponent, { isGroupLabel: true }, index);

			let componentIndex = index ? index + 1 : undefined;
			componentGroup.components.forEach(component => {
				let layout = component.layout || itemLayout;
				let itemConfig = this.convertToItemConfig(component, layout);
				itemConfig.config.isInGroup = true;
				this._component.insertItem(component.component as ComponentImpl, componentIndex, itemConfig.config);
				if (componentIndex) {
					componentIndex++;
				}
				this.addComponentActions(component, layout);
			});
		} else {
			formComponent = formComponent as azdata.FormComponent;
			let itemImpl = this.convertToItemConfig(formComponent, itemLayout);
			this._component.addItem(formComponent.component as ComponentImpl, itemImpl.config, index);
			this.addComponentActions(formComponent, itemLayout);
		}
	}

	removeFormItem(formComponent: azdata.FormComponent | azdata.FormComponentGroup): boolean {
		let componentGroup = formComponent as azdata.FormComponentGroup;
		let result: boolean = false;
		if (componentGroup && componentGroup.components !== undefined) {
			let firstComponent = componentGroup.components[0];
			let index = this._component.itemConfigs.findIndex(x => x.component.id === firstComponent.component.id);
			if (index !== -1) {
				result = this._component.removeItemAt(index - 1);
			}
			componentGroup.components.forEach(element => {
				this.removeComponentActions(element);
				this._component.removeItem(element.component);
			});
		} else {
			formComponent = formComponent as azdata.FormComponent;
			if (formComponent) {
				result = this._component.removeItem(formComponent.component as ComponentImpl);
				this.removeComponentActions(formComponent);
			}
		}
		return result;
	}
}
