-- Purpose: Emits result sets containing newlines, tabs, CRLF text, and formatted strings.
-- Tags: sqlserver, text-formatting, newlines, tabs, release-validation

-- Select with embedded newlines and tabs in the text
SELECT
    'First Line' + CHAR(10) + 'Second Line' + CHAR(10) + 'Third Line' AS MultiLineText,
    'Column1' + CHAR(9) + 'Column2' + CHAR(9) + 'Column3' AS TabDelimitedText;

-- Select with complex multi-line formatted text
SELECT
    'Header: Product Information' + CHAR(10) + CHAR(10) +
    CHAR(9) + 'Name:' + CHAR(9) + 'Laptop' + CHAR(10) +
    CHAR(9) + 'Price:' + CHAR(9) + '$1299.99' + CHAR(10) +
    CHAR(9) + 'Stock:' + CHAR(9) + 'Available' + CHAR(10) + CHAR(10) +
    'End of Report' AS FormattedReport;

-- Select with table-like formatted text using tabs and newlines
SELECT
    'ID' + CHAR(9) + 'Name' + CHAR(9) + 'Value' + CHAR(10) +
    '---' + CHAR(9) + '----' + CHAR(9) + '-----' + CHAR(10) +
    '1' + CHAR(9) + 'Alpha' + CHAR(9) + '100' + CHAR(10) +
    '2' + CHAR(9) + 'Beta' + CHAR(9) + '200' + CHAR(10) +
    '3' + CHAR(9) + 'Gamma' + CHAR(9) + '300' AS TableFormat;

-- Select with nested indentation using multiple tabs
SELECT
    'Root Level' + CHAR(10) +
    CHAR(9) + 'Level 1' + CHAR(10) +
    CHAR(9) + CHAR(9) + 'Level 2' + CHAR(10) +
    CHAR(9) + CHAR(9) + CHAR(9) + 'Level 3' + CHAR(10) +
    CHAR(9) + CHAR(9) + CHAR(9) + CHAR(9) + 'Level 4' + CHAR(10) +
    CHAR(9) + CHAR(9) + CHAR(9) + 'Back to Level 3' + CHAR(10) +
    CHAR(9) + CHAR(9) + 'Back to Level 2' + CHAR(10) +
    CHAR(9) + 'Back to Level 1' AS NestedText;

-- Select with mixed newlines, tabs, and carriage returns
SELECT
    'Address Block:' + CHAR(13) + CHAR(10) +
    'John Doe' + CHAR(13) + CHAR(10) +
    '123 Main Street' + CHAR(13) + CHAR(10) +
    'Apartment' + CHAR(9) + '#456' + CHAR(13) + CHAR(10) +
    'City, State' + CHAR(9) + 'ZIP' + CHAR(13) + CHAR(10) +
    'Country' AS AddressWithCRLF;

-- Select with code-like formatting
SELECT
    'function example() {' + CHAR(10) +
    CHAR(9) + 'var x = 10;' + CHAR(10) +
    CHAR(9) + 'var y = 20;' + CHAR(10) +
    CHAR(9) + 'if (x < y) {' + CHAR(10) +
    CHAR(9) + CHAR(9) + 'console.log("x is less");' + CHAR(10) +
    CHAR(9) + '}' + CHAR(10) +
    CHAR(9) + 'return x + y;' + CHAR(10) +
    '}' AS CodeSnippet;

-- Select creating a runtime table with newlines and tabs in data
CREATE TABLE #TextData (
    Id INT,
    TextContent NVARCHAR(MAX)
);

INSERT INTO #TextData (Id, TextContent) VALUES
    (1, 'Line 1' + CHAR(10) + CHAR(9) + 'Indented Line 2' + CHAR(10) + 'Line 3'),
    (2, 'Header' + CHAR(10) + CHAR(9) + 'Detail 1' + CHAR(10) + CHAR(9) + 'Detail 2'),
    (3, 'Name:' + CHAR(9) + 'Value' + CHAR(10) + 'Description:' + CHAR(9) + 'Some text');

SELECT * FROM #TextData;

DROP TABLE #TextData;
