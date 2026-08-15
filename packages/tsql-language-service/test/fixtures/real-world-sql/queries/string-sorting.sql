-- Purpose: Demonstrates descending string sort behavior with mixed-case sample values.
-- Tags: sqlserver, sorting, strings, demo

DECLARE @SortingExample TABLE
(
    String VARCHAR(50) NOT NULL
);

INSERT INTO @SortingExample
    (String)
VALUES
    ('apple'),
    ('Banana'),
    ('grape'),
    ('Kiwi'),
    ('orange'),
    ('Pineapple'),
    ('strawberry'),
    ('Watermelon');

SELECT String
FROM @SortingExample
ORDER BY String DESC;
