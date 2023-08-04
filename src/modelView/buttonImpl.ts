/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Emitter } from "vscode-languageclient";
import { ComponentImpl } from "./componentImpl";
import { ButtonComponent, ComponentEventType, ModelComponentTypes } from "./interfaces";
import * as vscode from 'vscode';
import { IWebviewProxy } from "./modelViewProtocol";

export class ButtonImpl extends ComponentImpl implements ButtonComponent {

	constructor(_proxy: IWebviewProxy, id: string) {
		super(_proxy, ModelComponentTypes.Button, id);
		this.properties = {};
		this._emitterMap.set(ComponentEventType.onDidClick, new Emitter<any>());
	}

	public get label(): string {
		return this.properties['label'];
	}
	public set label(v: string) {
		this.setProperty('label', v);
	}

	public get fileType(): string {
		return this.properties['fileType'];
	}
	public set fileType(v: string) {
		this.setProperty('fileType', v);
	}

	public get onDidClick(): vscode.Event<any> {
		let emitter = this._emitterMap.get(ComponentEventType.onDidClick);
		return emitter && emitter.event ? emitter.event : undefined;
	}

	public fireOnDidClick(): void {
		let emitter = this._emitterMap.get(ComponentEventType.onDidClick);
		if (emitter && emitter.event) {
			emitter.fire(undefined);
		}
	}
}