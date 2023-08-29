/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { TextComponentProperties, ModelComponentTypes } from "./interfaces";
import { ComponentImpl } from "./componentImpl";
import { IWebviewProxy } from "./modelViewProtocol";

export class TextComponentImpl extends ComponentImpl implements TextComponentProperties {

	constructor(_proxy: IWebviewProxy, id: string) {
		super(_proxy, ModelComponentTypes.Text, id,);
		this.properties = {};
	}

	public get value(): string {
		return this.properties['value'];
	}
	public set value(v: string) {
		this.setProperty('value', v);
	}

	public get title(): string {
		return this.properties['title'];
	}
	public set title(title: string) {
		this.setProperty('title', title);
	}

	public get requiredIndicator(): boolean {
		return this.properties['requiredIndicator'];
	}
	public set requiredIndicator(requiredIndicator: boolean) {
		this.setProperty('requiredIndicator', requiredIndicator);
	}
}