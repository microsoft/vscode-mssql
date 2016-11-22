import { TestBed, async } from '@angular/core/testing';
import { Http, BaseRequestOptions, RequestMethod, ResponseOptions, Response, Request } from '@angular/http';
import { MockBackend, MockConnection } from '@angular/http/testing';

import { DataService } from './../src/js/services/data.service';
import { IResultsConfig } from './../src/js/interfaces';

import mockGetRows1 from './testResources/mockGetRows1.spec';
import mockConfig1 from './testResources/mockConfig1.spec';
import mockBatch1 from './testResources/mockBatch2.spec';

function getParamsFromUrl(url: string): any {
    let paramString = url.split('?')[1];
    let params = paramString.split('&');
    let paramSplits = params.map<string[]>((param: string): string[] => {
        return param.split('=');
    });
    let paramsJson = {};
    paramSplits.forEach((paramSplit: string[]) => {
        paramsJson[paramSplit[0]] = paramSplit[1];
    });
    return paramsJson;
}

function urlMatch(request: Request, expectedUrl: RegExp, expectedMethod: RequestMethod): boolean {
    return request.url &&
            request.method === expectedMethod &&
            request.url.match(expectedUrl) &&
            request.url.match(expectedUrl).length === 1 ? true : false;
}

describe('data service', () => {
    let dataservice: DataService;
    let mockbackend: MockBackend;
    beforeEach(async(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
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
        dataservice = TestBed.get(DataService);
        mockbackend = TestBed.get(MockBackend);
    }));

    describe('get rows', () => {

        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isGetRows = urlMatch(conn.request, /\/rows/, RequestMethod.Get);
                expect(isGetRows).toBe(true);
                let param = getParamsFromUrl(conn.request.url);
                expect(param['batchId']).toEqual('0');
                expect(param['resultId']).toEqual('0');
                expect(param['rowStart']).toEqual('0');
                expect(param['numberOfRows']).toEqual('50');
                conn.mockRespond(new Response(new ResponseOptions({body: JSON.stringify(mockGetRows1)})));
            });
            dataservice.getRows(0, 50, 0, 0).subscribe((result) => {
                expect(result).toEqual(mockGetRows1);
                done();
            });
        });
    });

    describe('send save request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isSaveRequest = urlMatch(conn.request, /\/saveResults/, RequestMethod.Post);
                expect(isSaveRequest).toBe(true);
                let param = getParamsFromUrl(conn.request.url);
                expect(param['format']).toEqual('csv');
                expect(param['batchIndex']).toEqual('0');
                expect(param['resultSetNo']).toEqual('0');
                expect(JSON.parse(conn.request.getBody())).toEqual([]);
                done();
            });
            dataservice.sendSaveRequest(0, 0, 'csv', []);
        });
    });

    describe('open link request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isOpenRequest = urlMatch(conn.request, /\/openLink/, RequestMethod.Post);
                expect(isOpenRequest).toBe(true);
                let body = JSON.parse(conn.request.getBody());
                expect(body).toBeDefined();
                expect(body['content']).toEqual('this is a xml');
                expect(body['columnName']).toEqual('columnname');
                expect(body['type']).toEqual('xml');
                done();
            });
            dataservice.openLink('this is a xml', 'columnname', 'xml');
        });
    });

    describe('copy results request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isCopyRequest = urlMatch(conn.request, /\/copyResults/, RequestMethod.Post);
                expect(isCopyRequest).toBe(true);
                let param = getParamsFromUrl(conn.request.url);
                expect(param['batchId']).toEqual('0');
                expect(param['resultId']).toEqual('0');
                expect(param['includeHeaders']).toEqual(undefined);
                let body = JSON.parse(conn.request.getBody());
                expect(body).toBeDefined();
                expect(body).toEqual([]);
                done();
            });

            dataservice.copyResults([], 0, 0);
        });
    });

    describe('copy with headers request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isCopyRequest = urlMatch(conn.request, /\/copyResults/, RequestMethod.Post);
                expect(isCopyRequest).toBe(true);
                let param = getParamsFromUrl(conn.request.url);
                expect(param['batchId']).toEqual('0');
                expect(param['resultId']).toEqual('0');
                expect(param['includeHeaders']).toEqual('true');
                let body = JSON.parse(conn.request.getBody());
                expect(body).toBeDefined();
                expect(body).toEqual([]);
                done();
            });

            dataservice.copyResults([], 0, 0, true);
        });
    });

    describe('set selection request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isSelectionRequest = urlMatch(conn.request, /\/setEditorSelection/, RequestMethod.Post);
                expect(isSelectionRequest).toBe(true);
                let body = JSON.parse(conn.request.getBody());
                expect(body).toBeDefined();
                expect(body).toEqual({
                    startLine: 0,
                    startColumn: 0,
                    endLine: 6,
                    endColumn: 6
                });
                done();
            });

            dataservice.editorSelection = {
                startLine: 0,
                startColumn: 0,
                endLine: 6,
                endColumn: 6
            };
        });
    });

    describe('show warning request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isWarningRequest = urlMatch(conn.request, /\/showWarning/, RequestMethod.Post);
                expect(isWarningRequest).toBe(true);
                let body = JSON.parse(conn.request.getBody());
                expect(body).toBeDefined();
                expect(body['message']).toEqual('this is a warning message');
                done();
            });

            dataservice.showWarning('this is a warning message');
        });
    });

    describe('show error request', () => {
        it('correctly threads through the data', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isErrorRequest = urlMatch(conn.request, /\/showError/, RequestMethod.Post);
                expect(isErrorRequest).toBe(true);
                let body = JSON.parse(conn.request.getBody());
                expect(body).toBeDefined();
                expect(body['message']).toEqual('this is a error message');
                done();
            });

            dataservice.showError('this is a error message');
        });
    });

    describe('get config', () => {
        it('returns correct data on first request', (done) => {
            let config = <IResultsConfig> JSON.parse(JSON.stringify(mockConfig1));
            delete config.shortcuts;
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isConfigRequest = urlMatch(conn.request, /\/config/, RequestMethod.Get);
                expect(isConfigRequest).toBe(true);
                conn.mockRespond(new Response(new ResponseOptions({body: JSON.stringify(mockConfig1)})));
            });

            dataservice.config.then((result) => {
                expect(result).toEqual(config);
                done();
            });
        });
    });

    describe('get shortcuts', () => {
        it('returns correct data on first request', (done) => {
            mockbackend.connections.subscribe((conn: MockConnection) => {
                let isConfigRequest = urlMatch(conn.request, /\/config/, RequestMethod.Get);
                expect(isConfigRequest).toBe(true);
                conn.mockRespond(new Response(new ResponseOptions({body: JSON.stringify(mockConfig1)})));
            });

            dataservice.shortcuts.then((result) => {
                expect(result).toEqual(mockConfig1.shortcuts);
                done();
            });
        });
    });

    describe('websocket', () => {
        it('correctly sends event on websocket event', (done) => {
            dataservice.dataEventObs.subscribe((result) => {
                expect(result).toEqual(mockBatch1);
                done();
            });

            dataservice.ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify(mockBatch1)
            }));
        });
    });
});
