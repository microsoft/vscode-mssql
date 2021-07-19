/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Component, OnInit, Inject, forwardRef, ViewChild, ViewChildren, QueryList, ElementRef,
    EventEmitter, ChangeDetectorRef, AfterViewChecked } from '@angular/core';
import { DataService } from './../services/data.service';

/** enableProdMode */
import {enableProdMode} from '@angular/core';
enableProdMode();

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


// tslint:disable:max-line-length
// const template =  `
// <div class = "window" style="
// position: absolute;
// overflow: visible;
// width: 300px;
// height: 300px;
// left: 369px;
// top: 45px;
// border: 1px solid black;
// background-color: white;"
// >

// </div>
// <div class = "topBox" style = "
// position: absolute;
// overflow: visible;
// width: 300px;
// height: 34px;
// left: 369px;
// top: 45px;
// border: 1px solid black;
// background-color: rgba(230,230,230,1);">
// </div>

// <div id="controlContainer"></div>

// <div class = "lowBox" style = "
// position: absolute;
// overflow: visible;
// width: 300px;
// height: 34px;
// left: 369px;
// top: 312px;
// border: 1px solid black;
// background-color: rgba(230,230,230,1);">
// </div>

// `;

export class ItemDescriptor {
	constructor(public descriptor: IComponentDescriptor, public config: any) { }
}

/**
 * Defines a component and can be used to map from the model-backed version of the
 * world to the frontend UI;
 *
 * @export
 */
 export interface IComponentDescriptor {
	/**
	 * The type of this component. Used to map to the correct angular selector
	 * when loading the component
	 */
	type: string;
	/**
	 * A unique ID for this component
	 */
	id: string;

    /**
     * Temporary place to stick the label
     */
    label: string;
}

const template =  `
<div id="controlContainer">
    <div *ngFor="let item of items">
        <model-component-wrapper [descriptor]="item.descriptor">
        </model-component-wrapper>
    </div>
</div>
`;
// tslint:enable:max-line-length

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    host: { '(window:keydown)': 'keyEvent($event)'
    },
    template: template,
    providers: [DataService],
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

    protected items: ItemDescriptor[];

    public labelValue: string = 'Not initialized';

    constructor(@Inject(forwardRef(() => DataService)) public dataService: DataService,
                @Inject(forwardRef(() => ElementRef)) private _el: ElementRef,
                @Inject(forwardRef(() => ChangeDetectorRef)) private _cd: ChangeDetectorRef) {
        this.items = [];
    }

    /**
     * Called by Angular when the component is initialized
     */
    ngOnInit(): void {
        const self = this;
        this.dataService.config.then((config) => {
            this.config = config;
        });

        this.dataService.dataEventObs.subscribe(event => {
            switch (event.type) {
                case 'start':
                    this.labelValue = 'start message received - '  + event.data;
                    this._cd.detectChanges();
                    break;

                case 'modelView_initializeModel':
                    this.buildFormLayout(event.data);
                    break;

                default:
                    console.error('Unexpected proxy event type "' + event.type + '" sent');
                    break;
            }
        });
        this.dataService.sendReadyEvent(this.uri);
    }

    buildFormLayout(componentShape: any): void {
        this.items = [];

        let controlContainer: HTMLElement = document.getElementById('controlContainer');
        if (!controlContainer) {
            this.dataService.showWarning('controlContainer is null');
            return;
        }

        let nextComponentId: number = 0;
        for (let i = 0; i < componentShape.itemConfigs.length; ++i) {
            let itemConfig: any = componentShape.itemConfigs[i];
            let title = itemConfig.config.title;
            let type = itemConfig.componentShape.type;
            let id = itemConfig.componentShape.id;
            if (type == ModelComponentTypes.Button) {
                let buttonItem: ItemDescriptor = {
                    descriptor: {
                        type: ModelComponentTypes.Button.toString(),
                        id: id,
                        label: title
                    },
                    config: undefined
                };
                this.items.push(buttonItem);
            } else if (type == ModelComponentTypes.InputBox) {
                let textItem: ItemDescriptor = {
                    descriptor: {
                        type: ModelComponentTypes.InputBox.toString(),
                        id: id,
                        label: title
                    },
                    config: undefined
                };
                this.items.push(textItem);
            }

            ++nextComponentId;
        }

        this._cd.detectChanges();
    }

    ngAfterViewChecked(): void {
    }
}
