/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Emitter } from "vscode-languageclient";
import { Component, ComponentEventType, DisplayType, IComponentEventArgs, IComponentShape, IItemConfig, ModelComponentTypes, ModelViewAction } from "./interfaces";
import * as vscode from 'vscode';
import { assign } from "underscore";
import { IWebviewProxy } from "./modelViewProtocol";

export class InternalItemConfig {
	constructor(private _component: ComponentImpl, public config: any) { }

	public toIItemConfig(): IItemConfig {
		return {
			config: this.config,
			componentShape: this._component.toComponentShape()
		};
	}

	public get component(): Component {
		return this._component;
	}
}

export class ComponentImpl implements Component {
	public properties: { [key: string]: any } = {};
	public layout: any;
	public itemConfigs: InternalItemConfig[];
	public customValidations: ((component: ThisType<ComponentImpl>) => boolean | Thenable<boolean>)[] = [];
	private _valid: boolean = true;
	private _onValidityChangedEmitter = new Emitter<boolean>();
	public readonly onValidityChanged = this._onValidityChangedEmitter.event;

	private _onErrorEmitter = new Emitter<Error>();
	public readonly onError: vscode.Event<Error> = this._onErrorEmitter.event;
	protected _emitterMap = new Map<ComponentEventType, Emitter<any>>();

	constructor(
		protected _proxy: IWebviewProxy,
        protected _type: ModelComponentTypes,
		protected _id: string,) {
		this.properties = {};
		this.itemConfigs = [];
	}

	public get id(): string {
		return this._id;
	}

	public get type(): ModelComponentTypes {
		return this._type;
	}

	public get items(): Component[] {
		return undefined;
        //return this.itemConfigs.map(itemConfig => itemConfig.component);
	}

	public get enabled(): boolean {
		let isEnabled = this.properties['enabled'];
		return (isEnabled === undefined) ? true : isEnabled;
	}

	public set enabled(value: boolean) {
		this.setProperty('enabled', value);
	}

	public get height(): number | string {
		return this.properties['height'];
	}

	public set height(v: number | string) {
		this.setProperty('height', v);
	}

	public get width(): number | string {
		return this.properties['width'];
	}

	public set width(v: number | string) {
		this.setProperty('width', v);
	}

	public get required(): boolean {
		return this.properties['required'];
	}
	public set required(v: boolean) {
		this.setProperty('required', v);
	}

	public get display(): DisplayType {
		return this.properties['display'];
	}
	public set display(v: DisplayType) {
		this.setProperty('display', v);
	}

	public get ariaLabel(): string {
		return this.properties['ariaLabel'];
	}

	public set ariaLabel(v: string) {
		this.setProperty('ariaLabel', v);
	}

	public get ariaRole(): string {
		return this.properties['ariaRole'];
	}

	public set ariaRole(v: string) {
		this.setProperty('ariaRole', v);
	}

	public get ariaSelected(): boolean {
		return this.properties['ariaSelected'];
	}

	public set ariaSelected(v: boolean) {
		this.setProperty('ariaSelected', v);
	}

	public get ariaHidden(): boolean {
		return this.properties['ariaHidden'];
	}

	public set ariaHidden(v: boolean) {
		this.setProperty('ariaHidden', v);
	}

	public get CSSStyles(): { [key: string]: string } {
		return this.properties['CSSStyles'];
	}

	public set CSSStyles(cssStyles: { [key: string]: string }) {
		this.setProperty('CSSStyles', cssStyles);
	}

	public toComponentShape(): IComponentShape {
		return <IComponentShape>{
			id: this.id,
			type: this.type,
			layout: this.layout,
			properties: this.properties,
			itemConfigs: this.itemConfigs ? this.itemConfigs.map<IItemConfig>(item => item.toIItemConfig()) : undefined
		};
	}

	public clearItems(): Thenable<void> {
		this.itemConfigs = [];
		//return this._proxy.$clearContainer(this._handle, this.id);
        return undefined;
	}

	public addItems(items: Array<Component>, itemLayout?: any): void {
		items = items.filter(item => {
			if (this.itemConfigs.find(itemConfig => itemConfig.component.id === item.id)) {
				//this._logService.warn(`Trying to add duplicate component ${item.id} to container ${this.id}`);
				return false;
			}
			return true;
		});
		if (items.length === 0) {
			return;
		}
		const itemConfigs = items.map(item => {
			return {
				itemConfig: this.createAndAddItemConfig(item, itemLayout).toIItemConfig()
			};
		});
		//this._proxy.$addToContainer(this._handle, this.id, itemConfigs).then(undefined, (err) => this.handleError(err));
	}

	public removeItemAt(index: number): boolean {
		if (index >= 0 && index < this.itemConfigs.length) {
			let itemConfig = this.itemConfigs[index];
			//this._proxy.$removeFromContainer(this._handle, this.id, itemConfig.toIItemConfig());
			this.itemConfigs.splice(index, 1);
			return true;
		}
		return false;
	}

	public removeItem(item: Component): boolean {
		let index = this.itemConfigs.findIndex(c => c.component.id === item.id);
		if (index >= 0 && index < this.itemConfigs.length) {
			return this.removeItemAt(index);
		}
		return false;
	}

	public insertItem(item: Component, index: number, itemLayout?: any) {
		this.addItem(item, itemLayout, index);
	}

	public addItem(item: Component, itemLayout?: any, index?: number): void {
		if (this.itemConfigs.find(itemConfig => itemConfig.component.id === item.id)) {
			//this._logService.warn(`Trying to add duplicate component ${item.id} to container ${this.id}`);
			return;
		}
		const config = this.createAndAddItemConfig(item, itemLayout, index);
		//this._proxy.$addToContainer(this._handle, this.id, [{ itemConfig: config.toIItemConfig(), index }]).then(undefined, (err) => this.handleError(err));
	}

	/**
	 * Creates the internal item config for the component and adds it to the list of child configs for this component.
	 * @param item The child component to add
	 * @param itemLayout The optional layout to apply to the child component
	 * @param index The optional index to insert the child component at
	 */
	private createAndAddItemConfig(item: Component, itemLayout?: any, index?: number): InternalItemConfig {
		const itemImpl = item as ComponentImpl;
		if (!itemImpl) {
			throw new Error("Unknown component type. Must use ModelBuilder to create objects");
		}
		const config = new InternalItemConfig(itemImpl, itemLayout);
		if (index !== undefined && index >= 0 && index <= this.items.length) {
			this.itemConfigs.splice(index, 0, config);
		} else if (!index) {
			this.itemConfigs.push(config);
		} else {
			throw new Error("The index is invalid.");
		}
		return config;
	}

	public setLayout(layout: any): Thenable<void> {
		//return this._proxy.$setLayout(this._handle, this.id, layout);
        return undefined;
	}

	public setItemLayout(item: Component, itemLayout: any): boolean {
		const itemConfig = this.itemConfigs.find(c => c.component.id === item.id);
		if (itemConfig) {
			itemConfig.config = itemLayout;
			//this._proxy.$setItemLayout(this._handle, this.id, itemConfig.toIItemConfig()).then(undefined, onUnexpectedError);
		}
		return false;
	}

	public updateProperties(properties: { [key: string]: any }): Thenable<void> {
		this.properties = assign(this.properties, properties);
		return this.notifyPropertyChanged();
	}

	public updateProperty(key: string, value: any): Thenable<void> {
		return this.setProperty(key, value);
	}

	public updateCssStyles(cssStyles: { [key: string]: string }): Thenable<void> {
		this.properties.CSSStyles = assign(this.properties.CSSStyles || {}, cssStyles);
		return this.notifyPropertyChanged();
	}

	protected notifyPropertyChanged(): Thenable<void> {
		//return this._proxy.$setProperties(this._handle, this._id, this.properties);
        return undefined;
	}

	public registerEvent(): Thenable<boolean> {
		//return this._proxy.$registerEvent(this._handle, this._id).then(() => true);
        return undefined;
	}

	public onEvent(eventArgs: IComponentEventArgs) {
		if (eventArgs && eventArgs.eventType === ComponentEventType.PropertiesChanged) {
			this.properties = eventArgs.args;
		} else if (eventArgs && eventArgs.eventType === ComponentEventType.validityChanged) {
			this._valid = eventArgs.args;
			this._onValidityChangedEmitter.fire(this._valid);
		} else if (eventArgs) {
			let emitter = this._emitterMap.get(eventArgs.eventType);
			if (emitter) {
				emitter.fire(eventArgs.args);
			}
		}
	}

	protected setDataProvider(): Thenable<void> {
        return undefined;
		//return this._proxy.$setDataProvider(this._handle, this._id);
	}

	protected async setProperty(key: string, value: any): Promise<void> {
		if (!this.properties[key] || this.properties[key] !== value) {
			// Only notify the front end if a value has been updated
			this.properties[key] = value;
			return this.notifyPropertyChanged();
		}
		return Promise.resolve();
	}

	private handleError(err: Error): void {
		this._onErrorEmitter.fire(err);
	}

	public async runCustomValidations(): Promise<boolean> {
		let isValid = true;
		try {
			await Promise.all(this.customValidations.map(async validation => {
				if (!await validation(this)) {
					isValid = false;
				}
			}));
		} catch (e) {
			isValid = false;
		}
		return isValid;
	}

	public validate() {
		//return this._proxy.$validate(this._handle, this._id);
        return undefined;
	}

	public get valid(): boolean {
		return this._valid;
	}

	public focus() {
		//return this._proxy.$focus(this._handle, this._id);
        return undefined;
	}

	public doAction(action: ModelViewAction, ...args: any[]): Thenable<void> {
		//return this._proxy.$doAction(this._handle, this._id, action, ...args);
        return undefined;
	}
}