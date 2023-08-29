/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ComponentImpl } from "./componentImpl";
import { DropDownComponent, ModelComponentTypes, ComponentEventType, CategoryValue} from "./interfaces";
import { Emitter } from "vscode-languageclient";
import * as vscode from 'vscode';
import { IWebviewProxy } from "./modelViewProtocol";

export class DropDownImpl extends ComponentImpl implements DropDownComponent {

	constructor(_proxy: IWebviewProxy, id: string) {
		super(_proxy, ModelComponentTypes.DropDown, id);
		this.properties = {};
		this._emitterMap.set(ComponentEventType.onDidChange, new Emitter<any>());
	}

	public get value(): string | CategoryValue {
		let val = this.properties['value'];
		if (!this.editable && !val && this.values && this.values.length > 0) {
			val = this.values[0];
		}
		return val;
	}
	public set value(v: string | CategoryValue) {
		this.setProperty('value', v);
	}

	public get values(): string[] | CategoryValue[] {
		return this.properties['values'];
	}
	public set values(v: string[] | CategoryValue[]) {
		this.setProperty('values', v);
	}

	public get editable(): boolean {
		return this.properties['editable'];
	}
	public set editable(v: boolean) {
		this.setProperty('editable', v);
	}

	public get fireOnTextChange(): boolean {
		return this.properties['fireOnTextChange'];
	}
	public set fireOnTextChange(v: boolean) {
		this.setProperty('fireOnTextChange', v);
	}

	public get loading(): boolean {
		return this.properties['loading'];
	}

	public set loading(v: boolean) {
		this.setProperty('loading', v);
	}

	public get loadingText(): string {
		return this.properties['loadingText'];
	}

	public set loadingText(v: string) {
		this.setProperty('loadingText', v);
	}

	public get onValueChanged(): vscode.Event<any> {
		let emitter = this._emitterMap.get(ComponentEventType.onDidChange);
		return emitter && emitter.event;
	}
}