-- Test IIF with parentheses wrapping - regression test for customer-reported bug
-- The parser was incorrectly rejecting valid T-SQL like WHERE (IIF(...)) = 1

-- Original repro case: IIF with multiple boolean operators wrapped in parentheses
SELECT
(
    SELECT 1
    WHERE (IIF(1 > 0 AND 2 > 1, 1, 0)) = 1
);
GO

-- Simple IIF wrapped in parentheses with comparison
SELECT 1 WHERE (IIF(1 > 0, 1, 0)) = 1;
GO

-- IIF with multiple boolean operators (AND, OR) wrapped in parentheses
SELECT 1 WHERE (IIF(1 > 0 AND 2 > 1 OR 3 < 4, 1, 0)) = 1;
GO

-- IIF with comparison operators inside, wrapped in parentheses
SELECT 1 WHERE (IIF(1 >= 0 AND 2 <= 1 AND 3 <> 4, 1, 0)) = 1;
GO

-- Nested IIF wrapped in parentheses
SELECT 1 WHERE (IIF(IIF(1 > 0, 1, 0) > 0, 'yes', 'no')) = 'yes';
GO

-- IIF in SELECT clause wrapped in parentheses
SELECT (IIF(1 > 0, 1, 0)) + 1 AS result;
GO

-- Multiple IIF expressions with parentheses
SELECT 1 WHERE (IIF(1 > 0, 1, 0)) = 1 AND (IIF(2 > 1, 1, 0)) = 1;
GO

-- IIF without parentheses (should still work - baseline)
SELECT 1 WHERE IIF(1 > 0 AND 2 > 1, 1, 0) = 1;
GO

-- Deeply nested parentheses (4 levels) around IIF
SELECT 1 WHERE ((((IIF(1 > 0 AND 2 > 1, 1, 0))))) = 1;
GO

-- Deeply nested parentheses (5 levels) around IIF with complex boolean
SELECT 1 WHERE (((((IIF(1 > 0 AND 2 > 1 OR 3 < 4, 1, 0)))))) = 1;
GO

-- Mixed nesting: parentheses around boolean operators and IIF
SELECT 1 WHERE (((IIF(1 > 0, 1, 0)) = 1) AND ((IIF(2 > 1, 1, 0)) = 1));
GO

-- Deeply nested IIF inside arithmetic expression
SELECT ((((IIF(1 > 0 AND 2 > 1, 10, 20))))) + 5 AS result;
GO

-- Nested IIF with extra parentheses around outer IIF
SELECT 1 WHERE ((IIF((IIF(1 > 0, 1, 0)) > 0, 'yes', 'no'))) = 'yes';
GO

-- Nested IIF with extra parentheses around inner IIF
SELECT 1 WHERE (IIF(((IIF(1 > 0 AND 2 > 1, 1, 0))) > 0, 'a', 'b')) = 'a';
GO

-- Triple nested IIF with parentheses
SELECT 1 WHERE ((IIF((IIF((IIF(1 > 0, 1, 0)) > 0, 2, 3)) > 1, 'x', 'y'))) = 'x';
GO

-- Nested IIF with boolean operators and extra parentheses
SELECT 1 WHERE (((IIF(((IIF(1 > 0 AND 2 > 1, 1, 0))) = 1 AND 3 < 5, 'pass', 'fail')))) = 'pass';
GO

-- Edge case: IIF used as column alias (not a function call)
-- This tests that pendingIIf flag is reset when IIF is not followed by (
SELECT 1 AS IIF FROM T1;
GO
