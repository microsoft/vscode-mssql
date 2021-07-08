import { Component, Output, EventEmitter, Inject, forwardRef, OnInit } from '@angular/core';
import {ISlickRange} from '../../../../../models/interfaces';
import {ShortcutService} from './../services/shortcuts.service';
import * as Constants from './../constants';

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