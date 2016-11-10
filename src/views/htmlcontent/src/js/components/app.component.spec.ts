import { AppComponent } from './app.component';
import { SlickGrid } from 'angular2-slickgrid';
import { ScrollDirective } from './../directives/scroll.directive';
import { MouseDownDirective } from './../directives/mousedown.directive';
import { ContextMenu } from './contextmenu.component';
import { HttpModule, JsonpModule } from '@angular/http';
import { DataService } from './../services/data.service';
import { ShortcutService } from './../services/shortcuts.service';

import { DebugElement } from '@angular/core';
import { async, inject, ComponentFixture, TestBed } from '@angular/core/testing';
import { Http, BaseRequestOptions, Response, ResponseOptions, RequestMethod } from '@angular/http';
import { MockBackend, MockConnection } from '@angular/http/testing';
import { IResultsConfig } from './../interfaces';
import { By } from '@angular/platform-browser';

class MockDataService {

}

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
        TestBed.compileComponents();
    }));

    describe('basic behaviors', () => {
        const mockConfig: IResultsConfig = {
            shortcuts: {
                "event.nextGrid": "ctrl+down"
            },
            messagesDefaultOpen: true
        }

        beforeEach(async(inject([MockBackend], (mockBackend: MockBackend) => {
            mockBackend.connections.subscribe((conn: MockConnection) => {
                let isGetConfig = conn.request.url &&
                    conn.request.method === RequestMethod.Get &&
                    conn.request.url.match(/\/config/) &&
                    conn.request.url.match(/\/config/).length === 1 ? true : false;
                if (isGetConfig) {
                    conn.mockRespond(new Response(new ResponseOptions({body: JSON.stringify(mockConfig)})))
                }
            })
        })));

        beforeEach(() => {
            fixture = TestBed.createComponent<AppComponent>(AppComponent);
            fixture.detectChanges();
            comp = fixture.componentInstance;
            ele = fixture.nativeElement;
        })

        it('should create component', () => {
            expect(comp).toBeDefined();
            expect(ele).toBeDefined();
        });

        it('initialized properly', () => {
            expect(comp.messageActive).toBe(true);
        });

        it('should have correct config', async(inject([ShortcutService, DataService], (shortcutService: ShortcutService, dataService: DataService) => {
            dataService.config.then((result) => {
                expect(result).toEqual(mockConfig);
            })
            let messages = ele.querySelector('#messages');
            expect(messages).toBeDefined();
            expect(messages.className.indexOf('hidden')).toEqual(-1, 'messages should be visible');
            expect(shortcutService.shortcuts).toEqual(mockConfig.shortcuts);
        })));

    })
});
