-- INSERT wrapped in procs to get better error recovery (and thus test more error cases in 80/90)
-- multi-row insert
create proc p1 as
begin
    insert into t1 values (1, 2), 
        (default, 0), 
        (NULL, NULL)

    insert into t2 values ('aaa', 'bbb', 1), 
        ('ccc', 'ddd', 20)
end
GO

-- optimizer hints after values
create proc p1 as
begin
    insert into t2 values (1) option (maxdop 2, keep plan)
    insert into t2 default values option (fast 5, table hint (t2, readcommitted, index (i1)))
    insert into t2 default values option (table hint (t2))
end

GO

-- Pseudo column in target
create proc p1 as
begin
    insert into t1($ACTION, $CUID, $ROWGUID) values (1, 2, 3)
end
