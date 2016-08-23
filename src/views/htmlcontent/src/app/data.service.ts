import {Injectable, Inject, forwardRef} from '@angular/core';
import {Http} from '@angular/http';
import {Observable} from 'rxjs/Rx';
import { IDbColumn, ResultSetSubset, ISlickGridBatchMetaData } from './../interfaces';

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class DataService {
    uri: string;
    private batchSets: ISlickGridBatchMetaData[];

    constructor(@Inject(forwardRef(() => Http)) private http) {
        // grab the uri from the document for requests
        this.uri = encodeURI(document.getElementById('uri').innerText.trim());
    }

    /**
     * Gets the meta data for the current results set view
     */
    private getMetaData(): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self.http.get('/resultsetsMeta?uri=' + self.uri)
                            .map(res => res.json())
                            .subscribe((data: ISlickGridBatchMetaData[]) => {
                                self.batchSets = data;
                                resolve();
                            });
        });
    }

    /**
     * Get the number of batches in the query
     */
    numberOfBatchSets(): Promise<number> {
        const self = this;
        return new Promise<number>((resolve, rejct) => {
            if(!self.batchSets){
                self.getMetaData().then(() => {
                    resolve(self.batchSets.length);
                })
            } else {
                resolve(self.batchSets.length);
            }
        })
    }

    /**
     * Get the number of results in the query
     * @param batchId The batchid of which batch you want to return the numberOfResults Sets
     * for
     */
    numberOfResultSets(batchId: number): Promise<number> {
        const self = this;
        if (!this.batchSets) {
            return new Promise<number>((resolve, reject) => {
                self.getMetaData().then(() => {
                    resolve(this.batchSets[batchId].resultSets.length);
                });
            });
        } else {
            return new Promise<number>((resolve, reject) => {
                resolve(this.batchSets[batchId].resultSets.length);
            });
        }
    }

    /**
     * Get the messages for a batch
     * @param batchId The batchId for which batch to return messages for
     */
    getMessages(batchId: number): Observable<string[]> {
        const self = this;
        return this.http.get('/messages?'
                             + '&uri=' + self.uri
                             + '&batchId=' + batchId)
                        .map(res => {
                            return res.json();
                        });
    }

    /**
     * Gets the total number of rows in the results set
     * @param batchId The id of the batch you want to access result for
     * @param resultId The id of the result you want to get the number of rows
     * for
     */
    getNumberOfRows(batchId: number, resultId: number): Observable<number> {
        const self = this;
        if (!this.batchSets) {
            return Observable.create(observer => {
                self.getMetaData().then(() => {
                    observer.next(self.batchSets[batchId].resultSets[resultId].numberOfRows);
                    observer.complete();
                });
            });
        } else {
            return Observable.create(observer => {
                observer.next(self.batchSets[batchId].resultSets[resultId].numberOfRows);
                observer.complete();
            });
        }
    }

    /**
     * Gets the column data for the current results set
     * @param batchId The id of the batch for which you are querying
     * @param resultId The id of the result you want to get the columns for
     */
    getColumns(batchId: number, resultId: number): Observable<IDbColumn[]> {
        const self = this;
        if (!this.batchSets) {
            return Observable.create(observer => {
                self.getMetaData().then(() => {
                    self.http.get(self.batchSets[batchId].resultSets[resultId].columnsUri + '&uri=' + self.uri
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
            return this.http.get(this.batchSets[batchId].resultSets[resultId].columnsUri + '&uri=' + this.uri
                                 + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            });
        }
    }

    /**
     * Get a specified number of rows starting at a specified row for
     * the current results set
     * @param start The starting row or the requested rows
     * @param numberOfRows The amount of rows to return
     * @param batchId The batch id of the batch you are querying
     * @param resultId The id of the result you want to get the rows for
     */
    getRows(start: number, numberOfRows: number, batchId: number, resultId: number): Observable<ResultSetSubset> {
        const self = this;
        if (!this.batchSets) {
            return Observable.create(observer => {
                self.getMetaData().then(success => {
                    self.http.get(self.batchSets[batchId].resultSets[resultId].rowsUri + '&uri=' + self.uri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows
                                  + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            })
                            .subscribe((data: ResultSetSubset) => {
                                observer.next(data);
                                observer.complete();
                            });
                });
            });
        } else {
            return this.http.get(this.batchSets[batchId].resultSets[resultId].rowsUri + '&uri=' + this.uri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows
                                  + '&resultId=' + resultId)
                            .map(res => {
                                return res.json();
                            });
        }
    }
}
