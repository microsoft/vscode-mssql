import { TestBed, ComponentFixture, async } from '@angular/core/testing';
import { Component, OnInit, ViewChild } from '@angular/core';
import { SlickGrid, VirtualizedCollection, IGridDataRow, IColumnDefinition, FieldType } from 'angular2-slickgrid';

@Component({
    template: `
    <slick-grid [dataRows]="dataRows"
                [columnDefinitions]="columnDefinitions"
                [selectionModel]="selectionModel"
                showDataTypeIcon="false"></slick-grid>`
})
class SlickGridHost implements OnInit {
    dataRows;
    columnDefinitions;
    selectionModel = 'DragRowSelectionModel';
    @ViewChild(SlickGrid) slickgrid;

    ngOnInit(): void {
        let numberOfColumns = 10;
        let numberOfRows = 100;
        let columns: IColumnDefinition[] = [];
        for (let i = 0; i < numberOfColumns; i++) {
            columns.push({
                id: i.toString(),
                name: i.toString(),
                type: this.randomType()
            });
        }
        let loadDataFunction = (offset: number, count: number): Promise<IGridDataRow[]> => {
            return new Promise<IGridDataRow[]>((resolve) => {
                let data: IGridDataRow[] = [];
                for (let i = offset; i < offset + count; i++) {
                    let row: IGridDataRow = {
                        values: []
                    };
                    for (let j = 0; j < numberOfColumns; j++) {
                        row.values.push(`column ${j}; row ${i}`);
                    }
                    data.push(row);
                }
                resolve(data);
            });
        };
        this.columnDefinitions = columns;
        this.dataRows = new VirtualizedCollection<IGridDataRow>(50,
                                                                numberOfRows,
                                                                loadDataFunction,
                                                                (index) => {
                                                                    return { values: []};
                                                                });
    }

    randomType(): FieldType {
        let types = [FieldType.Boolean, FieldType.Date, FieldType.Decimal, FieldType.Integer,
                    FieldType.String];
        let rand = Math.floor(Math.random() * (types.length - 0 + 1));
        return types[rand];
    }
}

describe('drag row selection', () => {
    let fixture: ComponentFixture<SlickGridHost>;
    let comp: SlickGrid;
    let ele: HTMLElement;
    beforeEach(async(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            declarations: [SlickGrid, SlickGridHost]
        });
    }));

    describe('basic selection', () => {
        beforeEach(() => {
            fixture = TestBed.createComponent<SlickGridHost>(SlickGridHost);
            comp = fixture.componentInstance.slickgrid;
            ele = fixture.nativeElement;
            fixture.detectChanges();
        });

        it('initilized properly', () => {
            expect(ele.querySelector('slick-grid')).not.toBeNull('slickgrid was not created');
        });

        it('clicking a cell selects it', () => {
            let slickgrid = ele.querySelector('slick-grid');
            let canvas = slickgrid.querySelector('.grid-canvas');
            let nodeone = <HTMLElement> canvas.firstElementChild.childNodes[1];
            let cellone = <HTMLElement> nodeone.firstElementChild;
            cellone.click();
            fixture.detectChanges();
            let selection = comp.getSelectedRanges();
            expect(selection.length).toEqual(1);
            expect(selection[0].fromCell).toEqual(0);
            expect(selection[0].toCell).toEqual(0);
            expect(selection[0].fromRow).toEqual(0);
            expect(selection[0].toRow).toEqual(0);
        });
    });
});
