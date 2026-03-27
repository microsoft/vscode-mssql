/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Interface for table data providers
 */
export interface IDisposableDataProvider<T extends Slick.SlickData> extends Slick.DataProvider<T> {
    /**
     * Gets the rows of the giving range
     * @param startIndex Start index of the range
     * @param length Length of the rows to retrieve
     */
    getRangeAsync(startIndex: number, length: number): Promise<T[]>;

    /**
     * Gets unique values of all the cells in the given column
     * @param column the column information
     */
    getColumnValues(column: Slick.Column<T>): Promise<string[]>;

    /**
     * Filters the data
     * @param columns columns to be filtered, the
     * @returns true if the filter was applied, false if the operation was rejected (e.g., threshold exceeded)
     */
    filter(columns?: Slick.Column<T>[]): Promise<boolean>;

    /**
     * Sorts the data
     * @param args sort arguments
     * @returns true if the sort was applied, false if the sort was rejected (e.g., threshold exceeded)
     */
    sort(args: Slick.OnSortEventArgs<T>): Promise<boolean>;

    /**
     * Resets the sort
     * @returns true if the sort was reset, false if the operation was rejected (e.g., threshold exceeded)
     */
    resetSort(): Promise<boolean>;

    /**
     * Event fired when the filters changed
     */
    // readonly onFilterStateChange: vscode.Event<void>;

    /**
     * Event fired when the sorting is completed
     */
    // readonly onSortComplete: vscode.Event<Slick.OnSortEventArgs<T>>;

    /**
     * Gets a boolean value indicating whether the data is current in memory
     */
    readonly isDataInMemory: boolean;
}

/**
 * Check whether the object is an instance of IDisposableDataProvider
 */
export function instanceOfIDisposableDataProvider<T extends Slick.SlickData>(
    obj: any,
): obj is IDisposableDataProvider<T> {
    const provider = obj as IDisposableDataProvider<T>;
    return obj && provider.isDataInMemory !== undefined;
}
