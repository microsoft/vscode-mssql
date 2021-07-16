/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Emitter } from "vscode-languageclient";
import * as vscode from 'vscode';
import { ComponentImpl } from "./componentImpl";
import { ModelComponentTypes, InputBoxComponent, ComponentEventType, InputBoxInputType } from "./interfaces";

export class InputBoxImpl extends ComponentImpl implements InputBoxComponent {

	constructor(id: string) {
		super(ModelComponentTypes.InputBox, id,);
		this.properties = {};
		this._emitterMap.set(ComponentEventType.onDidChange, new Emitter<any>());
		this._emitterMap.set(ComponentEventType.onEnterKeyPressed, new Emitter<string>());
	}

	public get value(): string {
		return this.properties['value'];
	}
	public set value(v: string) {
		this.setProperty('value', v);
	}

	public get ariaLive(): string {
		return this.properties['ariaLive'];
	}
	public set ariaLive(v: string) {
		this.setProperty('ariaLive', v);
	}

	public get placeHolder(): string {
		return this.properties['placeHolder'];
	}
	public set placeHolder(v: string) {
		this.setProperty('placeHolder', v);
	}

	public get title(): string {
		return this.properties['title'];
	}
	public set title(v: string) {
		this.setProperty('title', v);
	}

	public get rows(): number {
		return this.properties['rows'];
	}
	public set rows(v: number) {
		this.setProperty('rows', v);
	}

	public get min(): number {
		return this.properties['min'];
	}
	public set min(v: number) {
		this.setProperty('min', v);
	}

	public get max(): number {
		return this.properties['max'];
	}
	public set max(v: number) {
		this.setProperty('max', v);
	}

	public get columns(): number {
		return this.properties['columns'];
	}
	public set columns(v: number) {
		this.setProperty('columns', v);
	}

	public get multiline(): boolean {
		return this.properties['multiline'];
	}
	public set multiline(v: boolean) {
		this.setProperty('multiline', v);
	}

	public get inputType(): InputBoxInputType {
		return this.properties['inputType'];
	}
	public set inputType(v: InputBoxInputType) {
		this.setProperty('inputType', v);
	}

	public get stopEnterPropagation(): boolean {
		return this.properties['stopEnterPropagation'];
	}
	public set stopEnterPropagation(v: boolean) {
		this.setProperty('stopEnterPropagation', v);
	}

	public get validationErrorMessage(): string {
		return this.properties['validationErrorMessage'];
	}
	public set validationErrorMessage(v: string) {
		this.setProperty('validationErrorMessage', v);
	}

	public get maxLength(): number | undefined {
		return this.properties['maxLength'];
	}

	public set maxLength(v: number | undefined) {
		this.setProperty('maxLength', v);
	}

	public get onTextChanged(): vscode.Event<any> {
		let emitter = this._emitterMap.get(ComponentEventType.onDidChange);
		return emitter && emitter.event;
	}

	public get onEnterKeyPressed(): vscode.Event<string> {
		const emitter = this._emitterMap.get(ComponentEventType.onEnterKeyPressed);
		return emitter && emitter.event;
	}
}
