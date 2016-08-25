import {Component, OnInit, Inject, forwardRef} from '@angular/core';
import {IColumnDefinition} from './slickgrid/ModelInterfaces';
import {IObservableCollection} from './slickgrid/BaseLibrary';
import {IGridDataRow} from './slickgrid/SharedControlInterfaces';
import {SlickGrid} from './slickgrid/SlickGrid';
import {DataService} from './data.service';
import {Observable} from 'rxjs/Rx';
import {VirtualizedCollection} from './slickgrid/VirtualizedCollection';
import {IDbColumn} from './../interfaces';
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

/**
 * Top level app component which runs and controls the SlickGrid implementation
 */
@Component({
    selector: 'my-app',
    directives: [SlickGrid, NavigatorComponent, Tabs, Tab ],
    templateUrl: 'app/app.html',
    providers: [DataService]
})

export class AppComponent implements OnInit {
    private columnDefinitions: IColumnDefinition[] = [];
    private dataRows: IObservableCollection<IGridDataRow>;
    private totalRows: number;
    private resultOptions: number[];
    private messages: string[];
    private resultToBatch: number[];
    private resultToResult: number[];

    constructor(@Inject(forwardRef(() => DataService)) private dataService: DataService) {}

    ngOnInit(): void {
        const self = this;
        self.resultOptions = [];
        self.resultToBatch = [];
        self.resultToResult = [];
        self.messages = [];
        this.dataService.numberOfBatchSets().then((numberOfBatches: number) => {
            let promises: Promise<void>[] = [];
            let resultIndex: number = 0;
            for (let i = 0; i < numberOfBatches; i++) {
                let messagePromise = new Promise<void>((resolve, reject) => {
                    self.dataService.getMessages(i).then((messages: string[]) => {
                        self.messages = self.messages.concat(messages);
                        resolve();
                    });
                });
                let resultPromise = new Promise<void>((resolve, reject) => {
                    self.dataService.numberOfResultSets(i).then((numberOfResults: number) => {
                        for (let j = 0; j < numberOfResults; j++) {
                            self.resultToBatch.push(i);
                            self.resultToResult.push(j);
                            self.resultOptions.push(resultIndex);
                            resultIndex++;
                        }
                        resolve();
                    });
                });
                promises.push(messagePromise, resultPromise);
            }
            Promise.all(promises).then(() => {
                if (self.resultOptions) {
                    self.renderResults(0);
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

    selectionChange(value: number): void {
        this.renderResults(value);
    }

    renderResults(resultId: number): void {
        const self = this;
        let columns = this.dataService.getColumns(self.resultToBatch[resultId], self.resultToResult[resultId]);
        let numberOfRows = this.dataService.getNumberOfRows(self.resultToBatch[resultId], self.resultToResult[resultId]);
        Observable.forkJoin([columns, numberOfRows]).subscribe( data => {
            let columnData: IDbColumn[] = data[0];
            self.totalRows = data[1];
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
                    self.dataService.getRows(offset, count, self.resultToBatch[resultId], self.resultToResult[resultId]).subscribe(rows => {
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
        });
    }
}
