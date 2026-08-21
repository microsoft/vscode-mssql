--Azure SQLDb usecase
CREATE TRIGGER [test]
    ON DATABASE
    AFTER RENAME
    AS BEGIN
           PRINT 'Test';
       END