import { ComponentImpl } from "./componentImpl";
import { DropDownComponent, ModelComponentTypes, ComponentEventType, CategoryValue} from "./interfaces";
import { Emitter } from "vscode-languageclient";
import * as vscode from 'vscode';

export class DropDownWrapper extends ComponentImpl implements DropDownComponent {

	constructor(id: string) {
		super(ModelComponentTypes.DropDown, id);
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