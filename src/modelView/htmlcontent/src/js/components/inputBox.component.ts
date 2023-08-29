/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ChangeDetectorRef, Component, ElementRef, forwardRef, Inject, Input, OnDestroy, ViewChild } from '@angular/core';
import { IComponentDescriptor } from './app.component';

@Component({
	selector: 'modelview-inputbox',
	template: `
    <span>{{this.label}}:<span>
	<input type=text />
`
})
export class InputBoxComponent {
	public descriptor: IComponentDescriptor;

	private get label(): string {
		return this.descriptor ? this.descriptor.label : '';
	}

	private set label(newValue: string) {
	}
}
