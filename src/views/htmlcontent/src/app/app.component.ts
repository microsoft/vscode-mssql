/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {Component, OnInit, Inject, forwardRef} from '@angular/core';
import {IColumnDefinition} from './slickgrid/ModelInterfaces';
import {IObservableCollection} from './slickgrid/BaseLibrary';
import {IGridDataRow} from './slickgrid/SharedControlInterfaces';
import {SlickGrid} from './slickgrid/SlickGrid';
import {DataService} from './data.service';
import {Observable} from 'rxjs/Rx';
import {VirtualizedCollection} from './slickgrid/VirtualizedCollection';
import { Tabs } from './tabs';
import { Tab } from './tab';

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

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    directives: [SlickGrid, Tabs, Tab],
    templateUrl: 'app/app.html',
    providers: [DataService]
})

export class AppComponent implements OnInit {
    private dataSets: {dataRows: IObservableCollection<IGridDataRow>, columnDefinitions: IColumnDefinition[], totalRows: number}[] = [];
    private messages: string[] = [];
    private selected: SelectedTab;
    public SelectedTab = SelectedTab;

    constructor(@Inject(forwardRef(() => DataService)) private dataService: DataService) {}

    /**
     * Called by Angular when the object is initialized
     */
    ngOnInit(): void {
        const self = this;
        this.dataService.numberOfBatchSets().then((numberOfBatches: number) => {
            for (let batchId = 0; batchId < numberOfBatches; batchId++) {
                self.dataService.getMessages(batchId).then(data => {
                    self.messages = self.messages.concat(data);
                });
                self.dataService.numberOfResultSets(batchId).then((numberOfResults: number) => {
                    for (let resultId = 0; resultId < numberOfResults; resultId++) {
                        let totalRowsObs = self.dataService.getNumberOfRows(batchId, resultId);
                        let columnDefinitionsObs = self.dataService.getColumns(batchId, resultId);
                        Observable.forkJoin([totalRowsObs, columnDefinitionsObs]).subscribe((data: any[]) => {
                            let dataSet: {dataRows: IObservableCollection<IGridDataRow>, columnDefinitions: IColumnDefinition[], totalRows: number} = {
                                dataRows: undefined,
                                columnDefinitions: undefined,
                                totalRows: undefined
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

                            let virtualizedCollection = new VirtualizedCollection<IGridDataRow>(200,
                                                                                                totalRows,
                                                                                                loadDataFunction,
                                                                                                (index) => {
                                                                                                    return { values: [] };
                                                                                                });
                            dataSet.columnDefinitions = columnDefinitions;
                            dataSet.totalRows = totalRows;
                            dataSet.dataRows = virtualizedCollection;
                            self.dataSets.push(dataSet);
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
     * Updates the internal state for what tab is selected; propogates down to the tab classes
     * @param to The tab was the selected
     */
    tabChange(to: SelectedTab): void {
        this.selected = to;
    }
}
