import {Injectable, Inject, forwardRef} from '@angular/core';
import {Http} from '@angular/http';
import {Observable} from 'rxjs/Rx';
import {IDbColumn, ResultSetSubset} from './../interfaces';

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class DataService {
    uri: string;
    columnsuri: string[];
    rowsuri: string[];
    numberOfRows: number[];
    constructor(@Inject(forwardRef(() => Http)) private http) {
        this.uri = encodeURI(document.getElementById('uri').innerText.trim());
        console.log(this.uri);
    }

    /**
     * Gets the meta data for the current results set view
     */

    private getMetaData(): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self.http.get('/resultsetsMeta?uri=' + self.uri)
                            .map(res => res.json())
                            .subscribe(data => {
                                let columnsuri = [];
                                let rowsuri = [];
                                let numberOfRows = [];
                                for (let i = 0; i < data.length; i++) {
                                    columnsuri[i] = data[i]['columnsUri'];
                                    rowsuri[i] = data[i]['rowsUri'];
                                    numberOfRows[i] = data[i]['totalRows'];
                                }
                                self.columnsuri = columnsuri;
                                self.rowsuri = rowsuri;
                                self.numberOfRows = numberOfRows;
                                resolve();
                            });
        });
    }

    /**
     * Get the number of results in the query
     */

    numberOfResultSets(): Promise<number> {
        const self = this;
        if (!this.columnsuri) {
            return new Promise<number>((resolve, reject) => {
                self.getMetaData().then(() => {
                    resolve(this.columnsuri.length);
                });
            });
        } else {
            return new Promise<number>((resolve, reject) => {
                resolve(this.columnsuri.length);
            });
        }
    }

    /**
     * Get the messages for the query
     */

    getMessages(): Observable<string[]> {
        const self = this;
        return this.http.get('/messages?'
                             + '&uri=' + self.uri)
                        .map(res => {
                            return res.json();
                        });
    }

    /**
     * Gets the total number of rows in the results set
     */
    getNumberOfRows(resultId: number): Observable<number> {
        const self = this;
        if (!this.numberOfRows) {
            return Observable.create(observer => {
                self.getMetaData().then(() => {
                    observer.next(self.numberOfRows[resultId]);
                    observer.complete();
                });
            });
        } else {
            return Observable.create(observer => {
                observer.next(self.numberOfRows[resultId]);
                observer.complete();
            });
        }
    }

    /**
     * Gets the column data for the current results set
     */

    getColumns(resultId: number): Observable<IDbColumn[]> {
        const self = this;
        if (!this.columnsuri) {
            return Observable.create(observer => {
                self.getMetaData().then(() => {
                    self.http.get(self.columnsuri[resultId] + '&uri=' + self.uri
                                  + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            })
                            .subscribe(data => {
                                observer.next(data);
                                observer.complete();
                            });
                });
            });
        } else {
            return this.http.get(this.columnsuri[resultId] + '&uri=' + this.uri
                                 + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            });
        }
    }

    /**
     * Get a specified number of rows starting at a specified row for
     * the current results set
     */

    getRows(start: number, numberOfRows: number, resultId: number): Observable<ResultSetSubset> {
        const self = this;
        if (!this.rowsuri) {
            return Observable.create(observer => {
                self.getMetaData().then(success => {
                    self.http.get(self.rowsuri[resultId] + '&uri=' + self.uri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows
                                  + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            })
                            .subscribe(data => {
                                observer.next(data);
                                observer.complete();
                            });
                });
            });
        } else {
            return this.http.get(this.rowsuri[resultId] + '&uri=' + this.uri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows
                                  + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            });
        }
    }
}
