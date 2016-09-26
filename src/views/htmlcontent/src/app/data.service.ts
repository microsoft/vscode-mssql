/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {Injectable, Inject, forwardRef} from '@angular/core';
import {Http, Headers} from '@angular/http';
import {Observable} from 'rxjs/Rx';
import { IDbColumn, ResultSetSubset, IGridBatchMetaData, ISelectionData } from './../interfaces';
import { ISlickRange } from './SlickGrid/SelectionModel';

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class DataService {
    uri: string;
    private batchSets: IGridBatchMetaData[];

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
                            .subscribe((data: IGridBatchMetaData[]) => {
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
        return new Promise<number>((resolve, reject) => {
            if (!self.batchSets) {
                self.getMetaData().then(() => {
                    resolve(self.batchSets.length);
                });
            } else {
                resolve(self.batchSets.length);
            }
        });
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
                    if (self.batchSets[batchId].resultSets.length > 0) {
                        resolve(self.batchSets[batchId].resultSets.length);
                    }
                });
            });
        } else {
            return new Promise<number>((resolve, reject) => {
                if (self.batchSets[batchId].resultSets.length > 0) {
                    resolve(self.batchSets[batchId].resultSets.length);
                }
            });
        }
    }

    /**
     * Get the messages for a batch
     * @param batchId The batchId for which batch to return messages for
     */
    getMessages(batchId: number): Promise<string[]> {
        const self = this;
        return new Promise<string[]>((resolve, reject) => {
            if (!self.batchSets) {
                self.getMetaData().then(() => {
                    resolve(self.batchSets[batchId].messages);
                });
            } else {
                resolve(self.batchSets[batchId].messages);
            }
        });
    }

    /**
     * Get a batch
     * @param batchId The batchId of the batch to return
     * @return The batch
     */
    getBatch(batchId: number): Promise<IGridBatchMetaData> {
        const self = this;
        return new Promise<IGridBatchMetaData>((resolve, reject) => {
            if (!self.batchSets) {
                self.getMetaData().then(() => {
                    resolve(self.batchSets[batchId]);
                });
            } else {
                resolve(self.batchSets[batchId]);
            }
        });
    }

    /**
     * Get all the batches
     * @return The batches
     */
    getBatches(): Promise<IGridBatchMetaData[]> {
        const self = this;
        return new Promise<IGridBatchMetaData[]>((resolve, reject) => {
            if (!self.batchSets) {
                self.getMetaData().then(() => {
                    resolve(self.batchSets);
                });
            } else {
                resolve(self.batchSets);
            }
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
                    if (self.batchSets[batchId].resultSets.length > 0) {
                        observer.next(self.batchSets[batchId].resultSets[resultId].numberOfRows);
                        observer.complete();
                    } else {
                        observer.next(undefined);
                        observer.complete();
                    }
                });
            });
        } else {
            return Observable.create(observer => {
                if (self.batchSets[batchId].resultSets.length > 0) {
                    observer.next(self.batchSets[batchId].resultSets[resultId].numberOfRows);
                    observer.complete();
                } else {
                    observer.next(undefined);
                    observer.complete();
                }
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
                    if (self.batchSets[resultId].resultSets.length > 0) {
                        self.http.get(self.batchSets[batchId].resultSets[resultId].columnsUri)
                            .map(res => {
                                return res.json();
                            })
                            .subscribe(data => {
                                observer.next(data);
                                observer.complete();
                            });
                    } else {
                        observer.next(undefined);
                        observer.complete();
                    }

                });
            });
        } else {
            if (this.batchSets[batchId].resultSets.length > 0) {
                return this.http.get(this.batchSets[batchId].resultSets[resultId].columnsUri)
                            .map(res => {
                                return res.json();
                            });
            } else {
                return Observable.create(observer => {
                    observer.next(undefined);
                    observer.complete();
                });
            }
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
                    self.http.get(self.batchSets[batchId].resultSets[resultId].rowsUri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows)
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
            return this.http.get(this.batchSets[batchId].resultSets[resultId].rowsUri
                                  + '&rowStart=' + start
                                  + '&numberOfRows=' + numberOfRows)
                            .map(res => {
                                return res.json();
                            });
        }
    }

    /**
     * send request to save the selected result set as csv
     * @param uri of the calling document
     * @param batchId The batch id of the batch with the result to save
     * @param resultId The id of the result to save as csv
     */
    sendSaveRequest(batchIndex: number, resultSetNumber: number, format: string, selection: ISlickRange[]): void {
        const self = this;
        let headers = new Headers();
        let url = '/saveResults?'
                        + '&uri=' + self.uri
                        + '&format=' + format
                        + '&batchIndex=' + batchIndex
                        + '&resultSetNo=' + resultSetNumber ;
        self.http.post(url, selection, { headers: headers }).subscribe();
    }

    /**
     * send request to open content in new editor
     */
    openLink(content: string, columnName: string): void {
        const self = this;
        let headers = new Headers();
        headers.append('Content-Type', 'application/json');
        self.http.post('/openLink', JSON.stringify({ 'content': content , 'columnName': columnName}), { headers : headers }).subscribe();
    }

    /**
     * Sends a copy request
     * @param selection The selection range to copy
     * @param batchId The batch id of the result to copy from
     * @param resultId The result id of the result to copy from
     */
    copyResults(selection: ISlickRange[], batchId: number, resultId: number): void {
        const self = this;
        let headers = new Headers();
        let url = '/copyResults?' + '&uri=' + self.uri + '&batchId=' + batchId + '&resultId=' + resultId;
        self.http.post(url, selection, { headers: headers }).subscribe();
    }

    /**
     * Sends a request to set the selection in the VScode window
     * @param selection The selection range in the VSCode window
     */
    setEditorSelection(selection: ISelectionData): void {
        const self = this;
        let headers = new Headers();
        let url = '/setEditorSelection?' + '&uri=' + self.uri;
        self.http.post(url, selection, { headers: headers }).subscribe();
    }
}
