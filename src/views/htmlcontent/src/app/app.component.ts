import {Component, OnInit} from 'angular2/core';
import {IColumnDefinition} from './slickgrid/ModelInterfaces';
import {IObservableCollection, CollectionChange} from './slickgrid/BaseLibrary';
import {IGridDataRow} from './slickgrid/SharedControlInterfaces';
import {SlickGrid} from './slickgrid/SlickGrid';
import {DataService} from './dataService';
import {Observable} from 'rxjs/Rx';

enum FieldType {
    String = 0,
    Boolean = 1,
    Integer = 2,
    Decimal = 3,
    Date = 4,
    Unknown = 5,
}

/*
*   Top level app component which runs and controls the SlickGrid implementation
*/
@Component({
    selector: 'my-app',
    directives: [SlickGrid],
    templateUrl: 'app/app.html',
    providers: [DataService]
})

export class AppComponent implements OnInit {
    private columnDefinitions: IColumnDefinition[] = [];
    private dataRows: IObservableCollection<IGridDataRow>;
    private data: IGridDataRow[] = [];

    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        const self = this;
        let columns = this.dataService.getColumns();
        let rows = this.dataService.getRows();
        Observable.forkJoin([columns, rows]).subscribe( data => {
            let columnData = data[0];
            let rowData = data[1];
            let columnDefinitions = [];
            for (let i = 0; i < columnData.length; i++) {
                columnDefinitions.push({
                    id: columnData[i].label,
                    type: self.stringToFieldType(columnData[i].cell)
                });
            }

            for (let i = 0; i < rowData.length; i++) {
                let localdata = self.assignValues(rowData[i], self, columnDefinitions);
                self.data.push({
                    values: localdata
                });
            }
            self.columnDefinitions = columnDefinitions;
            self.dataRows = {
                getLength: (): number => {
                    return self.data.length;
                },
                at: (index: number): IGridDataRow => {
                    return self.data[index];
                },
                getRange: (start: number, end: number): IGridDataRow[] => {
                    return self.data.slice(start, end);
                },
                setCollectionChangedCallback: (callback: (change: CollectionChange, startIndex: number, count: number) => void): void => {
                    return;
                }
            };
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

    private assignValues(json, self, columnDefinitions): any[] {
        let values: any[] = [];
        for (let i = 0; i < columnDefinitions.length; i++) {
            values.push(json[columnDefinitions[i].id]);
        }
        return values;
    }
}
