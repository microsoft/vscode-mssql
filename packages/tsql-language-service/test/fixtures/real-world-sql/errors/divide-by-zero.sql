-- Purpose: Demonstrates a runtime divide-by-zero error after several padding result sets.
-- Tags: sqlserver, error, divide-by-zero, repro

SELECT 'padding 1';
SELECT 'padding 2';
SELECT 'padding 3';
SELECT 'padding 4';

SELECT 1;
SELECT 1 / 0;
