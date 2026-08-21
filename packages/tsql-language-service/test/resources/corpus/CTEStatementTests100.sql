-- new syntax for T-SQL 100
-- Insert with CTEs
with change_tracking_context (0xff),DirReps(c1, c2) as (select c1 from t1) Insert @v1 default values;
GO

-- Testing CTEs, these are tested in more depth at SelectStatement tests
with change_tracking_context (0xff),DirReps(c1, c2) as (select c1 from t1) Update t1 set c1 = 23 + 10;
GO

with change_tracking_context (0xff),DirReps(c1, c2) as (select c1 from t1) delete t1 from t1
GO

-- Testing with just the new option - CHANGE_TRACKING_CONTEXT
with change_tracking_context (0xff) delete t1 from t1