import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Directive, Input, Output, EventEmitter } from '@angular/core';
import { ISlickRange, IColumnDefinition, IObservableCollection, IGridDataRow } from 'angular2-slickgrid';
import { Observable, Subject, Observer } from 'rxjs/Rx';

import { WebSocketEvent } from './../interfaces';
import { DataService } from './../services/data.service';
import { ShortcutService } from './../services/shortcuts.service';
import { AppComponent } from './app.component';
import * as Constants from './../constants';

import batch from './../testResources/mockBatch1.spec';

// Mock Setup
class MockDataService {
    private _config = {
        'mssql.messagesDefaultOpen': true
    };
    private ws: WebSocket;
    public dataEventObs: Subject<WebSocketEvent>;

    constructor() {
        const self = this;
        this.ws = new WebSocket('ws://mock');
        let observable = Observable.create(
            (obs: Observer<MessageEvent>) => {
                self.ws.onmessage = obs.next.bind(obs);
                self.ws.onerror = obs.error.bind(obs);
                self.ws.onclose = obs.complete.bind(obs);

                return self.ws.close.bind(self.ws);
            }
        );

        let observer = {
            next: (data: Object) => {
                if (self.ws.readyState === WebSocket.OPEN) {
                    self.ws.send(JSON.stringify(data));
                }
            }
        };

        this.dataEventObs = Subject.create(observer, observable).map((response: MessageEvent): WebSocketEvent => {
            let data = JSON.parse(response.data);
            return data;
        });
    }

    get config(): Promise<{[key: string]: any}> {
        return Promise.resolve(this._config);
    }

    public sendWSEvent(data: any): void {
        this.ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify(data)
        }));
    }
}

class MockShortcutService {
    private _shortcuts = {
        'event.toggleMessagePane': 'ctrl+alt+r',
        'event.toggleResultPane': 'ctrl+alt+y'
    };

    stringCodeFor(event: string): Promise<string> {
        return Promise.resolve(this._shortcuts[event]);
    }
}

@Component({
    selector: 'slick-grid',
    template: ''
})
class MockSlickGrid {
    @Input() columnDefinitions: IColumnDefinition[];
    @Input() dataRows: IObservableCollection<IGridDataRow>;
    @Input() resized: Observable<any>;
    @Input() editableColumnIds: string[] = [];
    @Input() highlightedCells: {row: number, column: number}[] = [];
    @Input() blurredColumns: string[] = [];
    @Input() contextColumns: string[] = [];
    @Input() columnsLoading: string[] = [];
    @Input() overrideCellFn: (rowNumber, columnId, value?, data?) => string;
    @Input() showHeader: boolean = false;
    @Input() showDataTypeIcon: boolean = true;
    @Input() enableColumnReorder: boolean = false;
    @Input() enableAsyncPostRender: boolean = true;

    @Output() loadFinished: EventEmitter<void> = new EventEmitter<void>();
    @Output() cellChanged: EventEmitter<{column: string, row: number, newValue: any}> = new EventEmitter<{column: string, row: number, newValue: any}>();
    @Output() editingFinished: EventEmitter<any> = new EventEmitter();
    @Output() contextMenu: EventEmitter<{x: number, y: number}> = new EventEmitter<{x: number, y: number}>();

    @Input() topRowNumber: number;
    @Output() topRowNumberChange: EventEmitter<number> = new EventEmitter<number>();

}

@Component({
    selector: 'context-menu',
    template: ''
})
class MockContextMenu {
    @Output() clickEvent: EventEmitter<{type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}>
        = new EventEmitter<{type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}>();
}

@Directive({
  selector: '[onScroll]'
})
class MockScrollDirective {
    @Input() scrollEnabled: boolean = true;
    @Output('onScroll') onScroll: EventEmitter<number> = new EventEmitter<number>();
}

@Directive({
  selector: '[mousedown]'
})
class MockMouseDownDirective {
    @Output('mousedown') onMouseDown: EventEmitter<void> = new EventEmitter<void>();
}
// End Mock Setup

////////  SPECS  /////////////
describe('AppComponent', function (): void {
    let fixture: ComponentFixture<AppComponent>;
    let comp: AppComponent;
    let ele: Element;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [ AppComponent, MockSlickGrid, MockContextMenu, MockScrollDirective, MockMouseDownDirective ]
        }).overrideComponent(AppComponent, {
            set: {
                providers: [
                    {
                        provide: DataService,
                        useClass: MockDataService
                    },
                    {
                        provide: ShortcutService,
                        useClass: MockShortcutService
                    }
                ]
            }
        });
    }));

    describe('basic behaviors', () => {

        beforeEach(async(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        }));

        it('should create component', () => {
            expect(comp).toBeDefined();
            expect(ele).toBeDefined();
        });

        it('initialized properly', () => {
            let messages = ele.querySelector('#messages');
            let results = ele.querySelector('#results');
            expect(messages).toBeDefined();
            expect(messages.className.indexOf('hidden')).toEqual(-1, 'messages not visible');
            expect(messages.getElementsByTagName('tbody').length).toBeGreaterThan(0, 'no table body in messages');
            expect(messages.getElementsByTagName('tbody')[0]
                           .getElementsByTagName('td')[1]
                           .innerText.indexOf(Constants.executeQueryLabel))
                           .not.toEqual(-1, 'Wrong executing label');
            expect(results).toBeNull('results pane is showing');
        });
    });

    describe('full initialization', () => {

        beforeEach(async(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        }));

        it('should have initilized the grids correctly', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch);
            fixture.detectChanges();
            let results = ele.querySelector('#results');
            expect(results).not.toBeNull('results pane is not visible');
            expect(results.getElementsByTagName('slick-grid').length).toEqual(1);
        });
    });
});
