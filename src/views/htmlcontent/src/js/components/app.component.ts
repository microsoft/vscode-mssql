/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, OnInit, Inject, forwardRef, ViewChild, ViewChildren, QueryList, ElementRef,
    EventEmitter, ChangeDetectorRef, AfterViewChecked } from '@angular/core';
import { IColumnDefinition, IObservableCollection, IGridDataRow, ISlickRange, SlickGrid,
    VirtualizedCollection, FieldType } from 'angular2-slickgrid';

import { DataService } from './../services/data.service';
import { ShortcutService } from './../services/shortcuts.service';
import { ContextMenu } from './contextmenu.component';
import { IGridIcon, ISelectionData, IResultMessage } from './../interfaces';

import * as Constants from './../constants';
import * as Utils from './../utils';

/** enableProdMode */
import {enableProdMode} from '@angular/core';
enableProdMode();

enum SelectedTab {
    Results = 0,
    Messages = 1,
}

interface IGridDataSet {
    dataRows: IObservableCollection<IGridDataRow>;
    columnDefinitions: IColumnDefinition[];
    resized: EventEmitter<any>;
    totalRows: number;
    batchId: number;
    resultId: number;
    maxHeight: number | string;
    minHeight: number | string;
}

interface IMessages {
    messages: IResultMessage[];
    hasError: boolean;
    selection: ISelectionData;
    startTime: string;
    endTime: string;
}

    // tslint:disable:max-line-length
const template = `
<div class="fullsize vertBox">
    <div *ngIf="dataSets.length > 0" id="resultspane" class="boxRow header collapsible" [class.collapsed]="!resultActive" (click)="resultActive = !resultActive">
        <span> {{Constants.resultPaneLabel}} </span>
        <span class="shortCut"> {{resultShortcut}} </span>
    </div>
    <div id="results" *ngIf="renderedDataSets.length > 0" class="results vertBox scrollable"
         (onScroll)="onScroll($event)" [scrollEnabled]="scrollEnabled" [class.hidden]="!resultActive">
        <div class="boxRow content horzBox slickgrid" *ngFor="let dataSet of renderedDataSets; let i = index"
            [style.max-height]="dataSet.maxHeight" [style.min-height]="dataSet.minHeight">
            <slick-grid #slickgrid id="slickgrid_{{i}}" [columnDefinitions]="dataSet.columnDefinitions"
                        [ngClass]="i === activeGrid ? 'active' : ''"
                        [dataRows]="dataSet.dataRows"
                        (contextMenu)="openContextMenu($event, dataSet.batchId, dataSet.resultId, i)"
                        enableAsyncPostRender="true"
                        showDataTypeIcon="false"
                        showHeader="true"
                        [resized]="dataSet.resized"
                        (mousedown)="navigateToGrid(i)"
                        class="boxCol content vertBox slickgrid">
            </slick-grid>
            <span class="boxCol content vertBox">
                <div class="boxRow content maxHeight" *ngFor="let icon of dataIcons">
                    <div *ngIf="icon.showCondition()" class="gridIcon">
                        <a class="icon" href="#"
                        (click)="icon.functionality(dataSet.batchId, dataSet.resultId, i)"
                        [title]="icon.hoverText()" [ngClass]="icon.icon()">
                        </a>
                    </div>
                </div>
            </span>
        </div>
    </div>
    <context-menu #contextmenu (clickEvent)="handleContextClick($event)"></context-menu>
    <div id="messagepane" class="boxRow header collapsible" [class.collapsed]="!messageActive" (click)="messageActive = !messageActive" style="position: relative">
        <div id="messageResizeHandle" class="resizableHandle"></div>
        <span> {{Constants.messagePaneLabel}} </span>
        <span class="shortCut"> {{messageShortcut}} </span>
    </div>
    <div id="messages" class="scrollable messages" [class.hidden]="!messageActive && dataSets.length !== 0">
        <br>
        <table id="messageTable">
            <colgroup>
                <col span="1" class="wide">
            </colgroup>
            <tbody *ngIf="messages.length > 0">
                <template ngFor let-imessage [ngForOf]="messages">
                    <tr *ngIf="imessage.selection">
                        <td>[{{imessage.startTime}}]</td>
                        <td>{{Constants.messageStartLabel}}<a href="#" (click)="editorSelection(imessage.selection)">{{Utils.formatString(Constants.lineSelectorFormatted, imessage.selection.startLine + 1)}}</a></td>
                    </tr>
                    <tr *ngFor="let message of imessage.messages">
                        <td></td>
                        <td class="messageValue" [class.errorMessage]="imessage.hasError" style="padding-left: 20px">{{message.message}}</td>
                    </tr>
                </template>
                <tr *ngIf="complete">
                    <td></td>
                    <td>{{Utils.formatString(Constants.elapsedTimeLabel, Utils.parseNumAsTimeString(totalElapseExecution))}}</td>
                </tr>
            </tbody>
            <tbody *ngIf="messages.length === 0">
                <tr>
                    <td>[{{startString}}]</td>
                    <td><img src="dist/images/progress_36x_animation.gif" height="18px"><span style="vertical-align: bottom">{{Constants.executeQueryLabel}}</span></td>
                </tr>
            </tbody>
        </table>
    </div>
    <div id="resizeHandle" [class.hidden]="!resizing" [style.top]="resizeHandleTop"></div>
</div>
`;
    // tslint:enable:max-line-length

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    host: { '(window:keydown)': 'keyEvent($event)', '(window:gridnav)': 'keyEvent($event)' },
    template: template,
    providers: [DataService, ShortcutService],
    styles: [`
    .errorMessage {
        color: var(--color-error);
    }`
    ]
})

export class AppComponent implements OnInit, AfterViewChecked {
    // CONSTANTS
    private scrollTimeOutTime = 200;
    private windowSize = 50;
    private maxScrollGrids = 8;
    // tslint:disable-next-line:no-unused-variable
    private _rowHeight = 29;
    // tslint:disable-next-line:no-unused-variable
    private _defaultNumShowingRows = 8;
    // tslint:disable-next-line:no-unused-variable
    private Constants = Constants;
    // tslint:disable-next-line:no-unused-variable
    private Utils = Utils;
    // the function implementations of keyboard available events
    private shortcutfunc = {
        'event.toggleResultPane': () => {
            this.resultActive = !this.resultActive;
        },
        'event.toggleMessagePane': () => {
            this.messageActive = !this.messageActive;
        },
        'event.nextGrid': () => {
            this.navigateToGrid(this.activeGrid + 1);
        },
        'event.prevGrid': () => {
            this.navigateToGrid(this.activeGrid - 1);
        },
        'event.copySelection': () => {
            let activeGrid = this.activeGrid;
            let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
            this.dataService.copyResults(selection, this.renderedDataSets[activeGrid].batchId, this.renderedDataSets[activeGrid].resultId);
        },
        'event.copyWithHeaders': () => {
            let activeGrid = this.activeGrid;
            let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
            this.dataService.copyResults(selection, this.renderedDataSets[activeGrid].batchId,
                this.renderedDataSets[activeGrid].resultId, true);
        },
        'event.maximizeGrid': () => {
            this.magnify(this.activeGrid);
        },
        'event.selectAll': () => {
            this.slickgrids.toArray()[this.activeGrid].selection = true;
        },
        'event.saveAsCSV': () => {
            let activeGrid = this.activeGrid;
            let batchId = this.renderedDataSets[activeGrid].batchId;
            let resultId = this.renderedDataSets[activeGrid].resultId;
            let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
            this.dataService.sendSaveRequest(batchId, resultId, 'csv', selection);
        },
        'event.saveAsJSON': () => {
            let activeGrid = this.activeGrid;
            let batchId = this.renderedDataSets[activeGrid].batchId;
            let resultId = this.renderedDataSets[activeGrid].resultId;
            let selection = this.slickgrids.toArray()[activeGrid].getSelectedRanges();
            this.dataService.sendSaveRequest(batchId, resultId, 'json', selection);
        }
    };
    // tslint:disable-next-line:no-unused-variable
    private dataIcons: IGridIcon[] = [
        {
            showCondition: () => { return this.dataSets.length > 1; },
            icon: () => {
                return this.renderedDataSets.length === 1
                    ? 'exitFullScreen'
                    : 'extendFullScreen';
            },
            hoverText: () => {
                return this.renderedDataSets.length === 1
                    ? Constants.restoreLabel
                    : Constants.maximizeLabel;
            },
            functionality: (batchId, resultId, index) => {
                this.magnify(index);
            }
        },
        {
            showCondition: () => { return true; },
            icon: () => { return 'saveCsv'; },
            hoverText: () => { return Constants.saveCSVLabel; },
            functionality: (batchId, resultId, index) => {
                let selection = this.slickgrids.toArray()[index].getSelectedRanges();
                if (selection.length <= 1) {
                    this.handleContextClick({type: 'savecsv', batchId: batchId, resultId: resultId, index: index, selection: selection});
                } else {
                    this.dataService.showWarning(Constants.msgCannotSaveMultipleSelections);
                }
            }
        },
        {
            showCondition: () => { return true; },
            icon: () => { return 'saveJson'; },
            hoverText: () => { return Constants.saveJSONLabel; },
            functionality: (batchId, resultId, index) => {
                let selection = this.slickgrids.toArray()[index].getSelectedRanges();
                if (selection.length <= 1) {
                    this.handleContextClick({type: 'savejson', batchId: batchId, resultId: resultId, index: index, selection: selection});
                } else {
                    this.dataService.showWarning(Constants.msgCannotSaveMultipleSelections);
                }
            }
        }
    ];
    // tslint:disable-next-line:no-unused-variable
    private startString = new Date().toLocaleTimeString();
    private config;

    // FIELDS
    // All datasets
    private dataSets: IGridDataSet[] = [];
    // Place holder data sets to buffer between data sets and rendered data sets
    private placeHolderDataSets: IGridDataSet[] = [];
    // Datasets currently being rendered on the DOM
    private renderedDataSets: IGridDataSet[] = this.placeHolderDataSets;
    private messages: IMessages[] = [];
    private scrollTimeOut: number;
    private messagesAdded = false;
    private resizing = false;
    private resizeHandleTop = 0;
    private scrollEnabled = true;
    // tslint:disable-next-line:no-unused-variable
    private resultActive = true;
    // tslint:disable-next-line:no-unused-variable
    private _messageActive = true;
    private firstRender = true;
    // tslint:disable-next-line:no-unused-variable
    private resultsScrollTop = 0;
    // tslint:disable-next-line:no-unused-variable
    private activeGrid = 0;
    private messageShortcut;
    private resultShortcut;
    private totalElapseExecution: number;
    private complete = false;
    @ViewChild('contextmenu') contextMenu: ContextMenu;
    @ViewChildren('slickgrid') slickgrids: QueryList<SlickGrid>;

    set messageActive(input: boolean) {
        this._messageActive = input;
        if (this.resultActive) {
            this.resizeGrids();
        }
    }

    get messageActive(): boolean {
        return this._messageActive;
    }

    constructor(@Inject(forwardRef(() => DataService)) public dataService: DataService,
                @Inject(forwardRef(() => ShortcutService)) private shortcuts: ShortcutService,
                @Inject(forwardRef(() => ElementRef)) private _el: ElementRef,
                @Inject(forwardRef(() => ChangeDetectorRef)) private cd: ChangeDetectorRef) {}

    /**
     * Called by Angular when the object is initialized
     */
    ngOnInit(): void {
        const self = this;
        this.totalElapseExecution = 0;
        this.setupResizeBind();
        this.dataService.config.then((config) => {
            this.config = config;
            self._messageActive = self.config.messagesDefaultOpen;
            this.shortcuts.stringCodeFor('event.toggleMessagePane').then((result) => {
                self.messageShortcut = result;
            });
            this.shortcuts.stringCodeFor('event.toggleResultPane').then((result) => {
                self.resultShortcut = result;
            });
        });
        this.dataService.dataEventObs.subscribe(event => {
            if (event.type === 'complete') {
                self.complete = true;
            } else {
                let batch = event.data;
                let exeTime = Utils.parseTimeString(batch.executionElapsed);
                if (exeTime) {
                    this.totalElapseExecution += <number> exeTime;
                }
                let messages: IMessages = {
                    messages: [],
                    hasError: batch.hasError,
                    selection: batch.selection,
                    startTime: new Date(batch.executionStart).toLocaleTimeString(),
                    endTime: new Date(batch.executionEnd).toLocaleTimeString()
                };
                if (batch.hasError) {
                    self._messageActive = true;
                }
                for (let message of batch.messages) {
                    let date = new Date(message.time);
                    let timeString = date.toLocaleTimeString();
                    messages.messages.push({time: timeString, message: message.message});
                }
                self.messages.push(messages);
                self.messagesAdded = true;
                for (let resultId = 0; resultId < batch.resultSetSummaries.length; resultId++) {
                    let result = batch.resultSetSummaries[resultId];
                    let totalRows = result.rowCount;
                    let columnData = result.columnInfo;
                    let dataSet: IGridDataSet = {
                            dataRows: undefined,
                            columnDefinitions: undefined,
                            totalRows: undefined,
                            resized: undefined,
                            batchId: batch.id,
                            resultId: result.id,
                            maxHeight: undefined,
                            minHeight: undefined
                        };
                    let columnDefinitions = [];

                    for (let i = 0; i < columnData.length; i++) {
                        // Fix column name for showplan queries
                        let columnName = (columnData[i].columnName === 'Microsoft SQL Server 2005 XML Showplan') ?
                                                    'XML Showplan' : columnData[i].columnName;
                        if (columnData[i].isXml || columnData[i].isJson) {
                            let linkType = columnData[i].isXml ? 'xml' : 'json';
                            columnDefinitions.push({
                                id: i.toString(),
                                name: columnName,
                                type: self.stringToFieldType('string'),
                                formatter: self.hyperLinkFormatter,
                                asyncPostRender: self.linkHandler(linkType)
                            });
                        } else {
                            columnDefinitions.push({
                                id: i.toString(),
                                name: columnName,
                                type: self.stringToFieldType('string'),
                                formatter: self.textFormatter
                            });
                        }
                    }
                    let loadDataFunction = (offset: number, count: number): Promise<IGridDataRow[]> => {
                        return new Promise<IGridDataRow[]>((resolve, reject) => {
                            self.dataService.getRows(offset, count, batch.id, result.id).subscribe(rows => {
                                let gridData: IGridDataRow[] = [];
                                for (let i = 0; i < rows.rows.length; i++) {
                                    gridData.push({
                                        values: rows.rows[i]
                                    });
                                }
                                resolve(gridData);
                            });
                        });
                    };

                    let virtualizedCollection = new VirtualizedCollection<IGridDataRow>(self.windowSize,
                                                                                        totalRows,
                                                                                        loadDataFunction,
                                                                                        (index) => {
                                                                                            return { values: [] };
                                                                                        });
                    dataSet.columnDefinitions = columnDefinitions;
                    dataSet.totalRows = totalRows;
                    dataSet.dataRows = virtualizedCollection;
                    // calculate min and max height
                    dataSet.maxHeight = dataSet.totalRows < self._defaultNumShowingRows ?
                                        Math.max((dataSet.totalRows + 1) * self._rowHeight, self.dataIcons.length * 30) + 10 : 'inherit';
                    dataSet.minHeight = dataSet.totalRows > self._defaultNumShowingRows ?
                                        (self._defaultNumShowingRows + 1) * self._rowHeight + 10 : dataSet.maxHeight;
                    self.dataSets.push(dataSet);
                    // Create a dataSet to render without rows to reduce DOM size
                    let undefinedDataSet = JSON.parse(JSON.stringify(dataSet));
                    undefinedDataSet.columnDefinitions = dataSet.columnDefinitions;
                    undefinedDataSet.dataRows = undefined;
                    undefinedDataSet.resized = new EventEmitter();
                    self.placeHolderDataSets.push(undefinedDataSet);
                    self.messagesAdded = true;
                    self.onScroll(0);
                }
            }

        });
    }

    ngAfterViewChecked(): void {
        if (this.messagesAdded) {
            this.messagesAdded = false;
            this.scrollMessages();
        }
    }

    /**
     * Used to convert the string to a enum compatible with SlickGrid
     */
    private stringToFieldType(input: string): FieldType {
        let fieldtype: FieldType;
        switch (input) {
            case 'string':
                fieldtype = FieldType.String;
                break;
            default:
                fieldtype = FieldType.String;
                break;
        }
        return fieldtype;
    }

    /**
     * Send save result set request to service
     */
    handleContextClick(event: {type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}): void {
        switch (event.type) {
            case 'savecsv':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'csv', event.selection);
                break;
            case 'savejson':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'json', event.selection);
                break;
            case 'selectall':
                this.activeGrid = event.index;
                this.shortcutfunc['event.selectAll']();
                break;
            case 'copySelection':
                this.dataService.copyResults(event.selection, event.batchId, event.resultId);
                break;
            case 'copyWithHeaders':
                this.dataService.copyResults(event.selection, event.batchId, event.resultId, true);
                break;
            default:
                break;
        }
    }

    openContextMenu(event: {x: number, y: number}, batchId, resultId, index): void {
        let selection = this.slickgrids.toArray()[index].getSelectedRanges();
        this.contextMenu.show(event.x, event.y, batchId, resultId, index, selection);
    }

    /**
     * Add handler for clicking on xml link
     */
    xmlLinkHandler = (cellRef: string, row: number, dataContext: JSON, colDef: any) => {
        const self = this;
        let value = dataContext[colDef.field];
        $(cellRef).children('.xmlLink').click(function(): void {
            self.dataService.openLink(value, colDef.field, 'xml');
        });
    }

    /**
     * Add handler for clicking on json link
     */
    jsonLinkHandler = (cellRef: string, row: number, dataContext: JSON, colDef: any) => {
        const self = this;
        let value = dataContext[colDef.field];
        $(cellRef).children('.xmlLink').click(function(): void {
            self.dataService.openLink(value, colDef.field, 'json');
        });
    }

    /**
     * Return asyncPostRender handler based on type
     */
    public linkHandler(type: string): Function {
        if (type === 'xml') {
            return this.xmlLinkHandler;
        } else if (type === 'json') {
            return this.jsonLinkHandler;
        }

    }

    /**
     * Format xml field into a hyperlink
     */
    public hyperLinkFormatter(row: number, cell: any, value: any, columnDef: any, dataContext: any): string {
        let valueToDisplay = (value + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let cellClasses = 'grid-cell-value-container';
        if (value) {
            cellClasses += ' xmlLink';
            return '<a class="' + cellClasses + '" href="#" >'
                + valueToDisplay
                + '</a>';
        } else {
            cellClasses += ' missing-value';
            return '<span title="' + valueToDisplay + '" class="' + cellClasses + '">' + valueToDisplay + '</span>';
        }
    }

    /**
     * Format all text to replace /n with spaces
     */
    textFormatter(row: number, cell: any, value: string, columnDef: any, dataContext: any): string {
        let valueToDisplay = value;
        let cellClasses = 'grid-cell-value-container';
        if (value) {
            valueToDisplay = value.replace(/\n/g, ' ');
        } else {
            cellClasses += ' missing-value';
        }

        return '<span title="' + valueToDisplay + '" class="' + cellClasses + '">' + valueToDisplay + '</span>';
    }

    /**
     * Handles rendering the results to the DOM that are currently being shown
     * and destroying any results that have moved out of view
     * @param scrollTop The scrolltop value, if not called by the scroll event should be 0
     */
    onScroll(scrollTop): void {
        const self = this;
        clearTimeout(self.scrollTimeOut);
        this.scrollTimeOut = setTimeout(() => {
            if (self.dataSets.length < self.maxScrollGrids) {
                self.scrollEnabled = false;
                for (let i = 0; i < self.placeHolderDataSets.length; i++) {
                    self.placeHolderDataSets[i].dataRows = self.dataSets[i].dataRows;
                    self.placeHolderDataSets[i].resized.emit();
                }
            } else {
                let gridHeight = self._el.nativeElement.getElementsByTagName('slick-grid')[0].offsetHeight;
                let tabHeight = self._el.nativeElement.querySelector('#results').offsetHeight;
                let numOfVisibleGrids = Math.ceil((tabHeight / gridHeight)
                    + ((scrollTop % gridHeight) / gridHeight));
                let min = Math.floor(scrollTop / gridHeight);
                let max = min + numOfVisibleGrids;
                for (let i = 0; i < self.placeHolderDataSets.length; i++) {
                    if (i >= min && i < max) {
                        if (self.placeHolderDataSets[i].dataRows === undefined) {
                            self.placeHolderDataSets[i].dataRows = self.dataSets[i].dataRows;
                            self.placeHolderDataSets[i].resized.emit();
                        }
                    } else if (self.placeHolderDataSets[i].dataRows !== undefined) {
                        self.placeHolderDataSets[i].dataRows = undefined;
                    }
                }
            }

            if (this.firstRender) {
                this.firstRender = false;
                setTimeout(() => {
                    this.slickgrids.toArray()[0].setActive();
                });
            }
        }, self.scrollTimeOutTime);
    }

    /**
     * Binded to mouse click on messages
     */
    editorSelection(selection: ISelectionData): void {
        this.dataService.editorSelection = selection;
    }

    /**
     * Sets up the resize for the messages/results panes bar
     */
    setupResizeBind(): void {
        const self = this;
        let $resizeHandle = $(self._el.nativeElement.querySelector('#messageResizeHandle'));
        let $messagePane = $(self._el.nativeElement.querySelector('#messages'));
        $resizeHandle.bind('dragstart', (e) => {
            self.resizing = true;
            self.resizeHandleTop = e.pageY;
            return true;
        });

        $resizeHandle.bind('drag', (e) => {
            self.resizeHandleTop = e.pageY;
        });

        $resizeHandle.bind('dragend', (e) => {
            self.resizing = false;
            // redefine the min size for the messages based on the final position
            $messagePane.css('min-height', $(window).height() - (e.pageY + 22));
            self.cd.detectChanges();
            self.resizeGrids();
        });
    }

    /**
     * Ensures the messages tab is scrolled to the bottom
     */
    scrollMessages(): void {
        let messagesDiv = this._el.nativeElement.querySelector('#messages');
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    /**
     * Makes a resultset take up the full result height if this is not already true
     * Otherwise rerenders the result sets from default
     */
    magnify(index: number): void {
        const self = this;
        if (this.renderedDataSets.length > 1) {
            this.renderedDataSets = [this.placeHolderDataSets[index]];
        } else {
            this.renderedDataSets = this.placeHolderDataSets;
            this.onScroll(0);
        }
        setTimeout(() => {
            for (let grid of self.renderedDataSets) {
                grid.resized.emit();
            }
            self.slickgrids.toArray()[0].setActive();
        });
}

    /**
     *
     */
    keyEvent(e): void {
        const self = this;
        if (e.detail) {
            e.which = e.detail.which;
            e.ctrlKey = e.detail.ctrlKey;
            e.metaKey = e.detail.metaKey;
            e.altKey = e.detail.altKey;
            e.shiftKey = e.detail.shiftKey;
        }
        let eString = this.shortcuts.buildEventString(e);
        this.shortcuts.getEvent(eString).then((result) => {
            if (result) {
                self.shortcutfunc[<string> result]();
                e.stopImmediatePropagation();
            }
        });
    }

    /**
     * Handles rendering and unrendering necessary resources in order to properly
     * navigate from one grid another. Should be called any time grid navigation is performed
     * @param targetIndex The index in the renderedDataSets to navigate to
     * @returns A boolean representing if the navigation was successful
     */
    navigateToGrid(targetIndex: number): boolean {
        // check if the target index is valid
        if (targetIndex >= this.renderedDataSets.length || targetIndex < 0) {
            return false;
        }

        // check if you are actually trying to change navigation
        if (this.activeGrid === targetIndex) {
            return false;
        }

        this.slickgrids.toArray()[this.activeGrid].selection = false;
        this.slickgrids.toArray()[targetIndex].setActive();
        this.activeGrid = targetIndex;

        // scrolling logic
        let resultsWindow = $('#results');
        let scrollTop = resultsWindow.scrollTop();
        let scrollBottom = scrollTop + resultsWindow.height();
        let gridHeight = $(this._el.nativeElement).find('slick-grid').height();
        if (scrollBottom < gridHeight * (targetIndex + 1)) {
            scrollTop += (gridHeight * (targetIndex + 1)) - scrollBottom;
            resultsWindow.scrollTop(scrollTop);
        }
        if (scrollTop > gridHeight * targetIndex) {
            scrollTop = (gridHeight * targetIndex);
            resultsWindow.scrollTop(scrollTop);
        }
        return true;
    }

    resizeGrids(): void {
        const self = this;
        setTimeout(() => {
            for (let grid of self.renderedDataSets) {
                    grid.resized.emit();
                }
        });
    }
}
