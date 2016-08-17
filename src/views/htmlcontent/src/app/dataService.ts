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
    columnsuri: string;
    rowsuri: string;
    numberOfRows: number;
    constructor(@Inject(forwardRef(() => Http)) private http) {
        this.uri = encodeURI(document.getElementById('uri').innerText.trim());
        console.log(this.uri);
    }

    /**
     * Gets the meta data for the current results set view
     */

    private getMetaData(): Promise<boolean> {
        const self = this;
        return new Promise((resolve, reject) => {
            self.http.get('/resultsetsMeta?uri=' + self.uri)
                            .map(res => res.json())
                            .subscribe(data => {
                                self.columnsuri = data[0]['columnsUri'];
                                self.rowsuri = data[0]['rowsUri'];
                                self.numberOfRows = data[0]['totalRows'];
                                resolve(true);
                            });
        });
    }

    /**
     * Gets the total number of rows in the results set
     */
    getNumberOfRows(): Observable<number> {
        const self = this;
        if (!this.numberOfRows) {
            return Observable.create(observer => {
                self.getMetaData().then(success => {
                    observer.next(self.numberOfRows);
                    observer.complete();
                });
            });
        }
    }

    /**
     * Gets the column data for the current results set
     */

    getColumns(): Observable<IDbColumn[]> {
        const self = this;
        if (!this.columnsuri) {
            return Observable.create(observer => {
                self.getMetaData().then(success => {
                    self.http.get(self.columnsuri + '&uri=' + self.uri)
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
            return this.http.get(this.columnsuri + '&uri=' + this.uri)
                            .map(res => {
                                return res.json();
                            });
        }
    }

    /**
     * Get a specified number of rows starting at a specified row for
     * the current results set
     */

    getRows(start: number, numberOfRows: number ): Observable<ResultSetSubset> {
        if (!this.rowsuri) {
            return Observable.create(observer => {
                this.getMetaData().then(success => {
                    this.http.get(this.rowsuri + '&uri=' + this.uri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows)
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
            return this.http.get(this.rowsuri + '&uri=' + this.uri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows)
                            .map(res => {
                                return res.json();
                            });
        }
    }
}
