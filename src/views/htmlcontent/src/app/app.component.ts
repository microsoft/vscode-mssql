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

    constructor(@Inject(forwardRef(() => DataService)) private dataService: DataService) {}

    ngOnInit(): void {
        const self = this;
        this.dataService.getMessages().subscribe(data => {
            self.messages = data;
        });
        this.dataService.numberOfResultSets().then((result: number) => {
            self.resultOptions = [];
            for (let i = 0; i < result; i++) {
                self.resultOptions.push(i);
            }
            this.renderResults(0);
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

    renderResults(id: number): void {
        const self = this;
        let columns = this.dataService.getColumns(id);
        let numberOfRows = this.dataService.getNumberOfRows(id);
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
                    self.dataService.getRows(offset, count, id).subscribe(rows => {
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
