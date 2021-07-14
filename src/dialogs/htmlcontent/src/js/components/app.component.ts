/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Component, OnInit, Inject, forwardRef, ViewChild, ViewChildren, QueryList, ElementRef,
    EventEmitter, ChangeDetectorRef, AfterViewChecked } from '@angular/core';
import { IObservableCollection, SlickGrid, VirtualizedCollection } from 'angular2-slickgrid';
import { ISlickRange, FieldType, IColumnDefinition, IGridDataRow,
    IGridIcon, IMessage, IRange, ISelectionData, DbCellValue } from '../../../../../models/interfaces';
import { DataService } from './../services/data.service';
import { ShortcutService } from './../services/shortcuts.service';
import { ContextMenu } from './contextmenu.component';
import { MessagesContextMenu } from './messagescontextmenu.component';

import * as Constants from './../constants';
import * as Utils from './../utils';

/** enableProdMode */
import {enableProdMode} from '@angular/core';
enableProdMode();

// text selection helper library
declare let rangy;

export enum ModelComponentTypes {
	NavContainer,
	DivContainer,
	FlexContainer,
	SplitViewContainer,
	Card,
	InputBox,
	DropDown,
	DeclarativeTable,
	ListBox,
	Button,
	CheckBox,
	RadioButton,
	WebView,
	Text,
	Table,
	DashboardWidget,
	DashboardWebview,
	Form,
	Group,
	Toolbar,
	LoadingComponent,
	TreeComponent,
	FileBrowserTree,
	Editor,
	DiffEditor,
	Hyperlink,
	Image,
	RadioCardGroup,
	ListView,
	TabbedPanel,
	Separator,
	PropertiesContainer,
	InfoBox,
	Slider
}

export interface IGridDataSet {
    dataRows: IObservableCollection<IGridDataRow>;
    columnDefinitions: IColumnDefinition[];
    resized: EventEmitter<any>;
    totalRows: number;
    batchId: number;
    resultId: number;
    maxHeight: number | string;
    minHeight: number | string;
}

// tslint:disable:max-line-length
const template =  `
<div class = "window" style="
position: absolute;
overflow: visible;
width: 300px;
height: 300px;
left: 369px;
top: 45px;
border: 1px solid black;
background-color: white;"
>

</div>
<div class = "topBox" style = "
position: absolute;
overflow: visible;
width: 300px;
height: 34px;
left: 369px;
top: 45px;
border: 1px solid black;
background-color: rgba(230,230,230,1);">
</div>

<div id="controlContainer"></div>

<div class = "lowBox" style = "
position: absolute;
overflow: visible;
width: 300px;
height: 34px;
left: 369px;
top: 312px;
border: 1px solid black;
background-color: rgba(230,230,230,1);">
</div>

`;
// tslint:enable:max-line-length

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    host: { '(window:keydown)': 'keyEvent($event)',
        '(window:gridnav)': 'keyEvent($event)',
        '(window:resize)' : 'resizeResults()'
     },
    template: template,
    providers: [DataService, ShortcutService],
    styles: [`
    .errorMessage {
        color: var(--color-error);
    }
    .batchMessage {
        padding-left: 20px;
    }
    `]
})

export class AppComponent implements OnInit, AfterViewChecked {
    private config;
    private uri: string;

    public labelValue: string = 'Not initialized';

    constructor(@Inject(forwardRef(() => DataService)) public dataService: DataService,
                @Inject(forwardRef(() => ElementRef)) private _el: ElementRef,
                @Inject(forwardRef(() => ChangeDetectorRef)) private _cd: ChangeDetectorRef) {}

    /**
     * Called by Angular when the component is initialized
     */
    ngOnInit(): void {
        const self = this;
        //this.setupResizeBind();


        this.dataService.config.then((config) => {
            this.config = config;
            // self._messageActive = self.config.messagesDefaultOpen;
            // self.resultsFontSize = self.config.resultsFontSize;
            // this.shortcuts.stringCodeFor('event.toggleMessagePane').then((result) => {
            //     self.messageShortcut = result;
            // });
            // this.shortcuts.stringCodeFor('event.toggleResultPane').then((result) => {
            //     self.resultShortcut = result;
            // });
        });
        this.dataService.dataEventObs.subscribe(event => {
            switch (event.type) {
                case 'start':
                    this.labelValue = 'start message received - '  + event.data;
                    this._cd.detectChanges();
                    break;
                case 'complete':
                    break;
                case 'message':
                    break;
                case 'resultSet':
                    break;

                case 'modelView_initializeModel':
                    this.buildFormLayout(event.data);
                    let componentShape = JSON.stringify(event.data);
                    this.dataService.showWarning(componentShape);
                    console.error(componentShape);
                    break;

                default:
                    console.error('Unexpected proxy event type "' + event.type + '" sent');
                    break;
            }
        });
        this.dataService.sendReadyEvent(this.uri);

        this.dataService.showWarning('Warning from dialog component');
    }

    buildFormLayout(componentShape: any): void {
        let controlContainer: HTMLElement = document.getElementById('controlContainer');
        if (!controlContainer) {
            this.dataService.showWarning('controlContainer is null');
            return;
        }

        for (let i = 0; i < componentShape.itemConfigs.length; ++i) {
            let itemConfig: any = componentShape.itemConfigs[i];
            let title = itemConfig.config.title;
            let type = itemConfig.componentShape.type;
            if (type == ModelComponentTypes.Button) {
                let button = document.createElement('button');
                button.innerText = title;
                button.onclick = event => {
                    this.dataService.showWarning('button clicked');
                };
                controlContainer.appendChild(button);
            }

        }
    }


    ngAfterViewChecked(): void {
    }

    /**
     * Perform copy and do other actions for context menu on the messages component
     */
    handleMessagesContextClick(event: {type: string, selectedRange: IRange}): void {
        switch (event.type) {
            case 'copySelection':
                // let selectedText = event.selectedRange.text();
                // this.executeCopy(selectedText);
                break;
            default:
                break;
        }
    }

    openMessagesContextMenu(event: any): void {
    }
}
