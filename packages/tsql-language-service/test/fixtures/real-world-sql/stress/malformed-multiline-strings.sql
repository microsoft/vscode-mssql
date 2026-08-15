-- Purpose: Stresses SQL editor/parser handling for repeated multiline statements and unfinished strings.
-- Tags: sqlserver, parser-stress, multiline, intentionally-invalid
-- Warning: This file intentionally contains incomplete SQL string literals.

-- create a really …1221 tokens truncated… of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the SQL script. It should be properly handled by the SQL parser.' AS line2,
    'This is the third line of the SQL script. It should also be properly handled by the SQL parser.' AS line3;
SELECT 'This is another long SQL script that spans multiple lines. It is used to further test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the second SQL script. It should be properly handled by
            the SQL parser.' AS line2,
    'This is the third line of the second SQL script. It should also be properly handled by the SQL parser.' AS line3;
SELECT 'This is yet another long SQL script that spans multiple lines. It is used to further test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the third SQL script. It should be properly handled by' AS line2

-- create a really long sql script spanning multiple lines
SELECT 'This is a really long SQL script that spans multiple lines. It is used to test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the SQL script. It should be properly handled by the SQL parser.' AS line2,
    'This is the third line of the SQL script. It should also be properly handled by the SQL parser.' AS line3;
SELECT 'This is another long SQL script that spans multiple lines. It is used to further test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the second SQL script. It should be properly handled by
            the SQL parser.' AS line2,
    'This is the third line of the second SQL script. It should also be properly handled by the SQL parser.' AS line3;
SELECT 'This is yet another long SQL script that spans multiple lines. It is used to further test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the third SQL script. It should be properly handled by' AS line2

-- create a really long sql script spanning multiple lines
SELECT 'This is a really long SQL script that spans multiple lines. It is used to test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the SQL script. It should be properly handled by the SQL parser.' AS line2,
    'This is the third line of the SQL script. It should also be properly handled by the SQL parser.' AS line3;
SELECT 'This is another long SQL script that spans multiple lines. It is used to further test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the second SQL script. It should be properly handled by
            the SQL parser.' AS line2,
    'This is the third line of the second SQL script. It should also be properly handled by the SQL parser.' AS line3;
SELECT 'This is yet another long SQL script that spans multiple lines. It is used to further test the handling of newlines in SQL scripts. The script continues on the next line.' AS line1,
    'This is the second line of the third SQL script. It should be properly handled by' AS line2
