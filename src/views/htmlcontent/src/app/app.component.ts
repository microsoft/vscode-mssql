import {Component, OnInit, Inject, forwardRef} from '@angular/core';
import {IColumnDefinition} from './slickgrid/ModelInterfaces';
import {IObservableCollection} from './slickgrid/BaseLibrary';
import {IGridDataRow} from './slickgrid/SharedControlInterfaces';
import {SlickGrid} from './slickgrid/SlickGrid';
import {DataService} from './data.service';
import {Observable} from 'rxjs/Rx';
import {VirtualizedCollection} from './slickgrid/VirtualizedCollection';
import { IDbColumn } from './../interfaces';
import { NavigatorComponent } from './navigation.component';
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
    directives: [SlickGrid, NavigatorComponent, Tabs, Tab],
    templateUrl: 'app/app.html',
    providers: [DataService]
})

export class AppComponent implements OnInit {
    private columnDefinitions: IColumnDefinition[] = [];
    private dataRows: IObservableCollection<IGridDataRow>;
    private totalRows: number;
    private resultOptions: number[][];
    private messages: string[] = [];
    private selected: SelectedTab;
    public SelectedTab = SelectedTab;

    constructor(@Inject(forwardRef(() => DataService)) private dataService: DataService) {}

    ngOnInit(): void {
        const self = this;
        self.resultOptions = [];
        this.dataService.numberOfBatchSets().then((numberOfBatches: number) => {
            let promises: Promise<void>[] = [];
            for (let i = 0; i < numberOfBatches; i++) {
                let batch: number[] = [];
                let resultPromise = new Promise<void>((resolve, reject) => {
                    self.dataService.numberOfResultSets(i).then((numberOfResults: number) => {
                        for (let j = 0; j < numberOfResults; j++) {
                            batch.push(j);
                        }
                        resolve();
                    });
                });
                self.resultOptions.push(batch);
                promises.push(resultPromise);
            }
            Promise.all(promises).then(() => {
                if (self.resultOptions) {
                    self.renderResults(/*batch Id*/0, /*result Id*/0);
                }
            });
        });
    }

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

    selectionChange(selection: {batch: number; result: number; }): void {
        this.renderResults(selection.batch, selection.result);
    }

    tabChange(to: SelectedTab): void {
        this.selected = to;
    }

    renderResults(batchId: number, resultId: number): void {
        const self = this;
        this.dataService.getMessages(batchId).then((result: string[]) => {
            self.messages = result;
        });
        let columns = this.dataService.getColumns(batchId, resultId);
        let numberOfRows = this.dataService.getNumberOfRows(batchId, resultId);
        Observable.forkJoin([columns, numberOfRows]).subscribe( data => {
            let columnData: IDbColumn[] = data[0];
            self.totalRows = data[1];
            if (!columnData) {
                self.selected = SelectedTab.Messages;
                return;
            }
            let columnDefinitions = [];
            for (let i = 0; i < columnData.length; i++) {
                columnDefinitions.push({
                    id: columnData[i].columnName,
                    type: self.stringToFieldType('string')
                });
            }
            self.columnDefinitions = columnDefinitions;

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
                                                                                self.totalRows,
                                                                                loadDataFunction,
                                                                                (index) => {
                                                                                    return { values: [] };
                                                                                });
            self.dataRows = virtualizedCollection;
            self.selected = SelectedTab.Results;
        });
    }
}
