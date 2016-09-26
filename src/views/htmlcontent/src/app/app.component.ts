/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {Component, OnInit, Inject, forwardRef, ViewChild, ViewChildren, QueryList, EventEmitter,
    ElementRef} from '@angular/core';
import {IColumnDefinition} from './slickgrid/ModelInterfaces';
import {IObservableCollection} from './slickgrid/BaseLibrary';
import {IGridDataRow} from './slickgrid/SharedControlInterfaces';
import {SlickGrid} from './slickgrid/SlickGrid';
import {DataService} from './data.service';
import {Observable} from 'rxjs/Rx';
import {VirtualizedCollection} from './slickgrid/VirtualizedCollection';
import { Tab } from './tab';
import { ContextMenu } from './contextmenu.component';
import { ScrollEvent } from './tab';

enum FieldType {
    String = 0,
    Boolean = 1,
    Integer = 2,
    Decimal = 3,
    Date = 4,
    Unknown = 5,
}

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
}

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    directives: [SlickGrid, Tab, ContextMenu],
    templateUrl: 'app/app.html',
    providers: [DataService]
})

export class AppComponent implements OnInit {
    // Constants
    private scrollTimeOutTime = 200;
    private windowSize = 50;
    private c_key = 67;

    // fields
    private dataSets: IGridDataSet[] = [];
    private renderedDataSets: IGridDataSet[] = [];
    private messages: string[] = [];
    private selected: SelectedTab;
    private scrollTimeOut;
    public SelectedTab = SelectedTab;
    @ViewChild(ContextMenu) contextMenu: ContextMenu;
    @ViewChildren(SlickGrid) slickgrids: QueryList<SlickGrid>;

    constructor(@Inject(forwardRef(() => DataService)) private dataService: DataService,
                @Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {}


    /**
     * Called by Angular when the object is initialized
     */
    ngOnInit(): void {
        const self = this;
        this.dataService.numberOfBatchSets().then((numberOfBatches: number) => {
            for (let batchId = 0; batchId < numberOfBatches; batchId++) {
                self.dataService.getMessages(batchId).then(data => {
                    self.messages = self.messages.concat(data);
                    self.selected = SelectedTab.Messages;
                });
                self.dataService.numberOfResultSets(batchId).then((numberOfResults: number) => {
                    for (let resultId = 0; resultId < numberOfResults; resultId++) {
                        let totalRowsObs = self.dataService.getNumberOfRows(batchId, resultId);
                        let columnDefinitionsObs = self.dataService.getColumns(batchId, resultId);
                        Observable.forkJoin([totalRowsObs, columnDefinitionsObs]).subscribe((data: any[]) => {
                            let dataSet: IGridDataSet = {
                                    dataRows: undefined,
                                    columnDefinitions: undefined,
                                    totalRows: undefined,
                                    resized: undefined,
                                    batchId: batchId,
                                    resultId: resultId
                                };
                            let totalRows = data[0];
                            let columnData = data[1];
                            let columnDefinitions = [];
                            for (let i = 0; i < columnData.length; i++) {
                                columnDefinitions.push({
                                    id: columnData[i].columnName,
                                    type: self.stringToFieldType('string')
                                });
                            }
                            let loadDataFunction = (offset: number, count: number): Promise<IGridDataRow[]> => {
                                return new Promise<IGridDataRow[]>((resolve, reject) => {
                                    self.dataService.getRows(offset, count, batchId, resultId).subscribe(rows => {
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
                            self.dataSets.push(dataSet);
                            let undefinedDataSet: IGridDataSet = JSON.parse(JSON.stringify(dataSet));
                            undefinedDataSet.dataRows = undefined;
                            self.renderedDataSets.push(undefinedDataSet);
                            self.selected = SelectedTab.Results;
                            setTimeout(() => {
                                self.onGridScroll({scrollTop: 0});
                            });
                        });
                    }
                });
            }
        });
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
            case 'boolean':
                fieldtype = FieldType.Boolean;
                break;
            case 'decimal':
                fieldtype = FieldType.Decimal;
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
    handleContextClick(event: {type: string, batchId: number, resultId: number}): void {
        switch (event.type) {
            case 'csv':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'csv');
                break;
            case 'json':
                this.dataService.sendSaveRequest(event.batchId, event.resultId, 'json');
                break;
            default:
                break;
        }
    }

    openContextMenu(event: {x: number, y: number}, batchId, resultId): void {
        this.contextMenu.show(event.x, event.y, batchId, resultId);
    }

    /**
     * Updates the internal state for what tab is selected; propogates down to the tab classes
     * @param to The tab was the selected
     */
    tabChange(to: SelectedTab): void {
        this.selected = to;
    }

    /**
     * Handles keyboard events on angular, currently only needed for copy-paste
     */
    onKey(e: any, batchId: number, resultId: number, index: number): void {
        if ((e.ctrlKey || e.metaKey) && e.which === this.c_key) {
            let selection = this.slickgrids.toArray()[index].getSelectedRanges();
            this.dataService.copyResults(selection, batchId, resultId);
        }
    }

    onGridScroll(event: ScrollEvent): void {
        const self = this;
        clearTimeout(self.scrollTimeOut);
        this.scrollTimeOut = setTimeout(() => {
            let gridHeight = self._el.nativeElement.getElementsByTagName('slick-grid')[0].offsetHeight;
            let tabHeight = self._el.nativeElement.getElementsByTagName('tab')[0].offsetHeight;
            let numOfVisibleGrids = Math.ceil((tabHeight / gridHeight)
                + ((event.scrollTop % gridHeight) / gridHeight));
            let min = Math.floor(event.scrollTop / gridHeight);
            let max = min + numOfVisibleGrids;
            for (let i = 0; i < self.renderedDataSets.length; i++) {
                if ( i >= min && i < max) {
                    if (self.renderedDataSets[i].dataRows === undefined) {
                        self.renderedDataSets[i].dataRows = self.dataSets[i].dataRows;
                    }
                } else if (self.renderedDataSets[i].dataRows !== undefined) {
                    self.renderedDataSets[i].dataRows = undefined;
                }
            }
        }, self.scrollTimeOutTime);
    }
}
