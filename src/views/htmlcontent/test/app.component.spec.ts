import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Directive, Input, Output, EventEmitter } from '@angular/core';
import { ISlickRange, IColumnDefinition, IObservableCollection, IGridDataRow } from 'angular2-slickgrid';
import { Observable, Subject, Observer } from 'rxjs/Rx';

import { WebSocketEvent, ResultSetSubset } from './../src/js/interfaces';
import { DataService } from './../src/js/services/data.service';
import { ShortcutService } from './../src/js/services/shortcuts.service';
import { AppComponent } from './../src/js/components/app.component';
import * as Constants from './../src/js/constants';
import batch1 from './testResources/mockBatch1.spec';
import batch2 from './testResources/mockBatch2.spec';

const completeEvent = {
    type: 'complete'
};

function sendDataSets(ds: MockDataService, set: WebSocketEvent, count: number): void {
    for (let i = 0; i < count; i++) {
        let tempset = <WebSocketEvent> JSON.parse(JSON.stringify(set));
        tempset.data.id = i;
        ds.sendWSEvent(tempset);
    }
}


function triggerKeyEvent(key: number, ele: HTMLElement): void {
    let keyboardEvent = document.createEvent('KeyboardEvent');
    let initMethod = typeof keyboardEvent.initKeyboardEvent !== 'undefined' ? 'initKeyboardEvent' : 'initKeyEvent';

    keyboardEvent[initMethod](
                    'keydown', // event type : keydown, keyup, keypress
                        true, // bubbles
                        true, // cancelable
                        window, // viewArg: should be window
                        false, // ctrlKeyArg
                        false, // altKeyArg
                        false, // shiftKeyArg
                        false, // metaKeyArg
                        key, // keyCodeArg : unsigned long the virtual key code, else 0
                        0 // charCodeArgs : unsigned long the Unicode character associated with the depressed key, else 0
    );
    ele.dispatchEvent(keyboardEvent);
}

// Mock Setup
class MockDataService {
    private _config = {
        'messagesDefaultOpen': true
    };
    private ws: WebSocket;
    public dataEventObs: Subject<WebSocketEvent>;

    constructor() {
        const self = this;
        this.ws = new WebSocket('ws://localhost:' + window.location.port + '/');
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

    public openLink(content: string, columnName: string, linkType: string): void {
        // No op
    }

    public getRows(start: number, numberOfRows: number, batchId: number, resultId: number): Observable<ResultSetSubset> {
        // no op
        return undefined;
    }

    public sendSaveRequest(batchIndex: number, resultSetNumber: number, format: string, selection: ISlickRange[]): void {
        // no op
    }

    public copyResults(selection: ISlickRange[], batchId: number, resultId: number): void {
        // no op
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

    getEvent(event: string): Promise<string> {
        return;
    }

    buildEventString(event: string): string {
        return;
    }
}

// MockSlickgrid
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

    public _selection: ISlickRange[] | boolean;

    public getSelectedRanges(): ISlickRange[] {
        return [];
    }

    public setActive(): void {
        return;
    }

    public set selection(input: ISlickRange[] | boolean) {
        this._selection = input;
    }

}

@Component({
    selector: 'context-menu',
    template: ''
})
class MockContextMenu {
    @Output() clickEvent: EventEmitter<{type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}>
        = new EventEmitter<{type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}>();

    public emitEvent(event: {type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}): void {
        this.clickEvent.emit(event);
    }

    public show(x: number, y: number, batchId: number, resultId: number, index: number, selection: ISlickRange[]): void {
        // No op
    }
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
    let ele: HTMLElement;

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

    describe('basic startup', () => {

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
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

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('should have initilized the grids correctly', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch2);
            fixture.detectChanges();
            let results = ele.querySelector('#results');
            expect(results).not.toBeNull('results pane is not visible');
            expect(results.getElementsByTagName('slick-grid').length).toEqual(1);
        });
    });

    describe('basic behavior', () => {

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('should not hide message pane on click when there is no data', () => {
            let messages = <HTMLElement> ele.querySelector('#messages');
            expect(messages).not.toBeNull();
            expect(messages.className.indexOf('hidden')).toEqual(-1, 'messages not visible');
            messages.click();
            fixture.detectChanges();
            expect(messages.className.indexOf('hidden')).toEqual(-1, 'messages not visible');
        });

        it('should hide message pane on click when there is data', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let messages = <HTMLElement> ele.querySelector('#messages');
            expect(messages).not.toBeNull();
            expect(messages.className.indexOf('hidden')).toEqual(-1, 'messages not visible');
            let messagePane = <HTMLElement> ele.querySelector('#messagepane');
            messagePane.click();
            fixture.detectChanges();
            expect(messages.className.indexOf('hidden')).not.toEqual(-1);
        });

        it('should hide the results pane on click when there is data', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let results = <HTMLElement> ele.querySelector('#results');
            expect(results).not.toBeNull('results pane is not visible');
            expect(results.className.indexOf('hidden')).toEqual(-1);
            let resultspane = <HTMLElement> ele.querySelector('#resultspane');
            resultspane.click();
            fixture.detectChanges();
            expect(results.className.indexOf('hidden')).not.toEqual(-1);
        });

        it('should render all grids when there are alot but only subset of data', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            sendDataSets(dataService, batch1, 20);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let slickgrids = ele.querySelectorAll('slick-grid');
            expect(slickgrids.length).toEqual(20);
        });

        it('should render all grids when there are alot but only subset of data', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            sendDataSets(dataService, batch1, 20);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let slickgrids = ele.querySelectorAll('slick-grid');
            expect(slickgrids.length).toEqual(20);
        });

        it('should open context menu when event is fired', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let contextmenu = comp.contextMenu;
            let slickgrid = comp.slickgrids.toArray()[0];
            spyOn(contextmenu, 'show');
            spyOn(slickgrid, 'getSelectedRanges').and.returnValue([]);
            slickgrid.contextMenu.emit({x: 20, y: 20});
            expect(slickgrid.getSelectedRanges).toHaveBeenCalled();
            expect(contextmenu.show).toHaveBeenCalledWith(20, 20, 0, 0, 0, []);
        });
    });

    describe('test icons', () => {
        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('should send save requests when the icons are clicked', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            spyOn(dataService, 'sendSaveRequest');
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let icons = ele.querySelectorAll('.gridIcon');
            expect(icons.length).toEqual(2);
            let csvIcon = <HTMLElement> icons[0].firstElementChild;
            csvIcon.click();
            expect(dataService.sendSaveRequest).toHaveBeenCalledWith(0, 0, 'csv', []);
            let jsonIcon = <HTMLElement> icons[1].firstElementChild;
            jsonIcon.click();
            expect(dataService.sendSaveRequest).toHaveBeenCalledWith(0, 0, 'json', []);
        });

        it('should have maximized the grid when the icon is clicked', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let slickgrids = ele.querySelectorAll('slick-grid');
            expect(slickgrids.length).toEqual(2);
            let icons = ele.querySelectorAll('.gridIcon');
            let maximizeicon = <HTMLElement> icons[0].firstElementChild;
            maximizeicon.click();
            setTimeout(() => {
                fixture.detectChanges();
                slickgrids = ele.querySelectorAll('slick-grid');
                expect(slickgrids.length).toEqual(1);
                done();
            }, 100);
        });
    });

    describe('test events', () => {

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        it('correctly handles custom events', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.toggleResultPane'));
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let results = <HTMLElement> ele.querySelector('#results');
            let event = new CustomEvent('gridnav', {
                            detail: {
                                which: 70,
                                ctrlKey: true,
                                metaKey: true,
                                shiftKey: true,
                                altKey: true
                            }
                        });
            window.dispatchEvent(event);
            setTimeout(() => {
                fixture.detectChanges();
                expect(results).not.toBeNull('message pane is not visible');
                expect(results.className.indexOf('hidden')).not.toEqual(-1);
                done();
            }, 100);
        });

        it('event toggle result pane', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.toggleResultPane'));
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let results = <HTMLElement> ele.querySelector('#results');
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(results).not.toBeNull('message pane is not visible');
                expect(results.className.indexOf('hidden')).not.toEqual(-1);
                done();
            }, 100);
        });

        it('event toggle message pane', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.toggleMessagePane'));
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let messages = <HTMLElement> ele.querySelector('#messages');
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(messages).not.toBeNull('message pane is not visible');
                expect(messages.className.indexOf('hidden')).not.toEqual(-1);
                done();
            }, 100);
        });

        it('event copy selection', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.copySelection'));
            spyOn(dataService, 'copyResults');
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(dataService.copyResults).toHaveBeenCalledWith([], 0, 0);
                done();
            }, 100);
        });

        it('event copy with headers', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.copyWithHeaders'));
            spyOn(dataService, 'copyResults');
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(dataService.copyResults).toHaveBeenCalledWith([], 0, 0, true);
                done();
            }, 100);
        });

        it('event maximize grid', (done) => {

            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.maximizeGrid'));
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let slickgrids = ele.querySelectorAll('slick-grid');
            expect(slickgrids.length).toEqual(2);
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                slickgrids = ele.querySelectorAll('slick-grid');
                expect(slickgrids.length).toEqual(1);
                done();
            }, 100);
        });

        it('event save as json', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.saveAsJSON'));
            spyOn(dataService, 'sendSaveRequest');
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(dataService.sendSaveRequest).toHaveBeenCalledWith(0, 0, 'json', []);
                done();
            }, 100);
        });

        it('event save as csv', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <MockShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.saveAsCSV'));
            spyOn(dataService, 'sendSaveRequest');
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(dataService.sendSaveRequest).toHaveBeenCalledWith(0, 0, 'csv', []);
                done();
            }, 100);
        });

        it('event next grid', (done) => {

            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <ShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.nextGrid'));
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let currentSlickGrid;
            let targetSlickGrid;
            targetSlickGrid = comp.slickgrids.toArray()[1];
            currentSlickGrid = comp.slickgrids.toArray()[0];
            spyOn(targetSlickGrid, 'setActive');
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(targetSlickGrid.setActive).toHaveBeenCalled();
                expect(currentSlickGrid._selection).toBe(false);
                done();
            });
        });

        it('event prev grid', (done) => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            let shortcutService = <ShortcutService> fixture.componentRef.injector.get(ShortcutService);
            spyOn(shortcutService, 'buildEventString').and.returnValue('');
            spyOn(shortcutService, 'getEvent').and.returnValue(Promise.resolve('event.prevGrid'));
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(batch2);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            comp.navigateToGrid(1);
            let currentSlickGrid;
            let targetSlickGrid;
            targetSlickGrid = comp.slickgrids.toArray()[0];
            currentSlickGrid = comp.slickgrids.toArray()[1];
            spyOn(targetSlickGrid, 'setActive');
            triggerKeyEvent(40, ele);
            setTimeout(() => {
                fixture.detectChanges();
                expect(targetSlickGrid.setActive).toHaveBeenCalled();
                expect(currentSlickGrid._selection).toBe(false);
                done();
            });
        });

        it('event select all', () => {
            let dataService = <MockDataService> fixture.componentRef.injector.get(DataService);
            dataService.sendWSEvent(batch1);
            dataService.sendWSEvent(completeEvent);
            fixture.detectChanges();
            let slickgrid;
            slickgrid = comp.slickgrids.toArray()[0];
            comp.handleContextClick({type: 'selectall', batchId: 0, resultId: 0, index: 0, selection: []});
            fixture.detectChanges();
            expect(slickgrid._selection).toBe(true);
        });
    });
});