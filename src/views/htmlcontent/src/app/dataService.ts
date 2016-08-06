import {Injectable} from 'angular2/core';
import {Http} from 'angular2/http';
import {Observable} from 'rxjs/Rx';
import {IDbColumn} from './../../../../models/contracts';
import {ResultSetSubset} from './../../../../models/contracts';

/*
*   Service which performs the http requests to get the data resultsets
*   from the server.
*/

@Injectable()
export class DataService {
    uri: string;
    columnsuri: string;
    rowsuri: string;
    numberOfRows: number;
    constructor(private http: Http) {
        this.uri = encodeURI(document.getElementById('uri').innerText.trim());
        console.log(this.uri);
    }

    getMetaData(): Promise<boolean> {
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
