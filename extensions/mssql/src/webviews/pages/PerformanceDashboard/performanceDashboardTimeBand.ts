/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A row of colored segments below a time chart, on the chart's time axis, with a legend. */
export interface TimeBand {
    /** The name of the band, before it, for example "Plan". */
    readonly label: string;
    /** What the band shows, for screen readers. */
    readonly description: string;
    readonly segments: readonly TimeBandSegment[];
    /** The colors of the segments, in a legend below the band. */
    readonly legend: readonly { readonly label: string; readonly color: string }[];
}

export interface TimeBandSegment {
    readonly start: Date;
    readonly end: Date;
    readonly color: string;
    /** The tooltip, for example "Plan 12 ran most from 9:00 to 12:00". */
    readonly title: string;
}
