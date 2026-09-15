/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fixture queries for the grid e2e suite.
 *
 * Every fixture is an inline row constructor or a catalog-view cross join. Nothing creates a
 * database object, so a crashed run leaves no residue, parallel workers cannot collide, and
 * results are byte-identical on every server.
 */

/**
 * Mixed types in one result set: NULL, leading spaces, an embedded newline, an over-long value,
 * and a numeric column for the footer's selection aggregates.
 */
export const MIXED_TYPES_QUERY = `SELECT * FROM (VALUES
    (1, N'Ada',  N'plain',                                  CAST(12.50 AS decimal(10,2))),
    (2, N'  Bo', N'leading spaces in the name column',      CAST(7.25  AS decimal(10,2))),
    (3, N'Cy',   N'line1' + CHAR(13) + CHAR(10) + N'line2', CAST(0.00  AS decimal(10,2))),
    (4, N'Dee',  NULL,                                      NULL),
    (5, N'Eli',  REPLICATE(N'x', 400),                      CAST(99.99 AS decimal(10,2)))
) AS t(id, name, notes, amount);`;

export const MIXED_TYPES_ROW_COUNT = 5;
export const MIXED_TYPES_COLUMNS = ["id", "name", "notes", "amount"];

/** Columns the cell formatter turns into hyperlinks. Supported on every serviced version. */
export const TYPED_COLUMNS_QUERY = `SELECT
    CAST('<plan><node /></plan>' AS xml)       AS plan_xml,
    N'{"k":1,"nested":{"a":[1,2]}}'            AS payload_json;`;

/**
 * A vector column, which must render as plain text rather than a JSON hyperlink.
 *
 * `vector` arrived in SQL Server 2025 (major version 17); on anything older this query fails
 * with "Type vector is not a defined system type", so gate it on {@link SERVER_MAJOR_VERSION_QUERY}.
 */
export const VECTOR_COLUMN_QUERY = `SELECT CAST('[0.1,0.2,0.3]' AS vector(3)) AS embedding;`;

/** Major version of the server under test: 16 is SQL Server 2022, 17 is SQL Server 2025. */
export const SERVER_MAJOR_VERSION_QUERY = `SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int) AS major_version;`;

/** Lowest server major version that understands the `vector` type. */
export const MIN_VECTOR_MAJOR_VERSION = 17;

/** Repeated values and a NULL, so the filter overlay's value list has something real to show. */
export const FILTERABLE_QUERY = `SELECT * FROM (VALUES
    (1, N'alpha', N'red'),
    (2, N'alpha', N'blue'),
    (3, N'beta',  N'red'),
    (4, N'beta',  NULL),
    (5, N'gamma', N'blue'),
    (6, N'gamma', N'red')
) AS t(id, category, color);`;

export const FILTERABLE_ROW_COUNT = 6;

/** Empty and whitespace-only strings share the filter's Blanks pseudo-entry. */
export const BLANK_FILTER_QUERY = `SELECT * FROM (VALUES
    (1, N''),
    (2, N' '),
    (3, N'blue')
) AS t(id, color);`;

/** Wide result set for horizontal scrolling, freezing, and toolbar overflow. */
export function getWideQuery(columnCount = 60): string {
    const columns = Array.from(
        { length: columnCount },
        (_, index) => `CAST(${index} AS int) AS c${index}`,
    ).join(",\n    ");
    return `SELECT TOP (200)\n    ${columns}\nFROM sys.all_objects;`;
}

/** Large result set for virtualization and windowed paging. No tables involved. */
export const LARGE_QUERY = `SELECT TOP (100000)
    ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS id,
    CONCAT(N'row-', ROW_NUMBER() OVER (ORDER BY (SELECT NULL))) AS label
FROM sys.all_objects a CROSS JOIN sys.all_objects b;`;

/** One row past mssql.resultsGrid.inMemoryDataProcessingThreshold, which defaults to 5000. */
export const ABOVE_THRESHOLD_QUERY = `SELECT TOP (5001)
    ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS id
FROM sys.all_objects a CROSS JOIN sys.all_objects b;`;

/** Three result sets from one execution, for multi-grid layout and maximize. */
export const MULTI_RESULT_QUERY = `SELECT 1 AS a; SELECT 2 AS b, 3 AS c; SELECT 4 AS d;`;

/** Enough result sets to put the tail outside the scroll viewport and exercise lazy mounting. */
export function getManyResultsQuery(count = 20): string {
    return Array.from({ length: count }, (_, index) => `SELECT ${index + 1} AS value;`).join("\n");
}

/** PRINT spacing, a batch boundary, and a divide-by-zero for the clickable error line. */
export const MESSAGES_QUERY = `PRINT '  indented   output';
GO
SELECT 1 / 0 AS boom;`;

/**
 * Compact, fully populated set for selection and keyboard tests.
 *
 * Six rows keeps every row rendered: the grid sizes itself to the row count but caps at eight
 * visible rows, so a taller fixture would virtualize the tail and `.nth(row)` would stop lining up
 * with the data.
 */
export const SELECTION_QUERY = `SELECT * FROM (VALUES
    (1, 10, 100, 1000),
    (2, 20, 200, 2000),
    (3, 30, 300, 3000),
    (4, 40, 400, 4000),
    (5, 50, 500, 5000),
    (6, 60, 600, 6000)
) AS t(id, a, b, c);`;

export const SELECTION_ROW_COUNT = 6;
export const SELECTION_COLUMN_COUNT = 4;
