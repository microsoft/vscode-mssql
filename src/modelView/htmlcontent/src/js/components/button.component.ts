/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, forwardRef, Inject, Input, OnDestroy, ViewChild } from '@angular/core';
import { DataService } from '../services/data.service';
import { IComponentDescriptor } from './app.component';

@Component({
	selector: 'modelview-button',
	template: `
	<button #buttonElement (click)='onClick()'>{{this.label}}</button>
`
})
export class ButtonComponent implements AfterViewInit {
	@ViewChild('buttonElement') buttonElement: ElementRef;

	public descriptor: IComponentDescriptor;

	constructor(@Inject(forwardRef(() => DataService)) public dataService: DataService) {
	}

	private get label(): string {
		return this.descriptor ? this.descriptor.label : '';
	}

	private set label(newValue: string) {
	}

	ngAfterViewInit() {
	}

	onClick(): void {
		this.dataService.sendButtonClickEvent(this.descriptor.id);
	}
}
