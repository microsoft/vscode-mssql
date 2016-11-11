import { async, inject, ComponentFixture, TestBed } from '@angular/core/testing';
import { Http, BaseRequestOptions, Response, ResponseOptions, RequestMethod } from '@angular/http';
import { MockBackend, MockConnection } from '@angular/http/testing';
import { SlickGrid } from 'angular2-slickgrid';

import { IResultsConfig } from './../interfaces';
import { ScrollDirective } from './../directives/scroll.directive';
import { MouseDownDirective } from './../directives/mousedown.directive';
import { ContextMenu } from './contextmenu.component';
import { DataService } from './../services/data.service';
import { ShortcutService } from './../services/shortcuts.service';
import { AppComponent } from './app.component';
import * as Constants from './../constants';

import MockBatch1 from './../testResources/mockBatch1.spec';

////////  SPECS  /////////////
describe('AppComponent', function (): void {
    let fixture: ComponentFixture<AppComponent>;
    let comp: AppComponent;
    let ele: Element;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [ AppComponent, SlickGrid, ScrollDirective, MouseDownDirective, ContextMenu],
            providers: [
                ShortcutService,
                DataService,
                MockBackend,
                BaseRequestOptions,
                {
                    provide: Http,
                    useFactory: (backend, options) => { return new Http(backend, options); },
                    deps: [MockBackend, BaseRequestOptions]
                }
            ]
        });
    }));

    describe('basic behaviors', () => {

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

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
        const mockConfig: IResultsConfig = {
            shortcuts: {

            },
            messagesDefaultOpen: true
        };

        beforeEach(async(inject([MockBackend], (mockBackend: MockBackend) => {
            mockBackend.connections.subscribe((conn: MockConnection) => {
                let isGetConfig = conn.request.url &&
                    conn.request.method === RequestMethod.Get &&
                    conn.request.url.match(/\/config/) &&
                    conn.request.url.match(/\/config/).length === 1 ? true : false;
                let isGetRows = conn.request.url &&
                    conn.request.method === RequestMethod.Get &&
                    conn.request.url.match(/\/rows/) &&
                    conn.request.url.match(/\/rows/).length === 1 ? true : false;
                if (isGetConfig) {
                    conn.mockRespond(new Response(new ResponseOptions({body: JSON.stringify(mockConfig)})));
                } else if (isGetRows) {
                    let parser = document.createElement('a');
                    parser.href = conn.request.url;
                    console.log(parser['rowStart']);
                    console.log(parser['numberOfRows']);
                }
            });
        })));

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        });

        beforeEach(() => {
            comp.dataService.webSocket.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify(MockBatch1)
            }));
        });

        it('should have initilized the grids correctly', () => {
            fixture.detectChanges();
            let results = ele.querySelector('#results');
            expect(results).not.toBeNull('results pane is not visible');
            expect(results.getElementsByTagName('slick-grid').length).toEqual(1);
            // let slickgrid = results.getElementsByTagName('slick-grid')[0];
            // let viewport = slickgrid.firstElementChild.getElementsByClassName('slick-viewport')[0]
        });
    });
});
