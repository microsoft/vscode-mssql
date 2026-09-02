-- VS Feedback 1286384: Including columns in inline index inside a table variable
DECLARE @t1 TABLE (
    c1 INT NOT NULL,
    c2 INT NULL,
    c3 VARCHAR(20),
    INDEX idx NONCLUSTERED (c1) INCLUDE (c2, c3));