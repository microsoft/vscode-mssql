/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./media/button';
import { ChangeDetectorRef, Component, ElementRef, forwardRef, Inject, Input, OnDestroy, ViewChild } from '@angular/core';



enum ButtonType {
	File = 'File',
	Normal = 'Normal',
	Informational = 'Informational'
}

@Component({
	selector: 'modelview-button',
	template: `
	<button class = "cancelButton" style = "
position: absolute;
overflow: visible;
height: 15px;
width: 70px;
left: 595px;
top: 325px;
font-size: 10px;
font-family: Helvetica;
">
Cancel

</button>
	`
})

export class ButtonComponent{
	public fileType: string = '.sql';
}