CREATE TABLE mytable (
    id   BIGINT         IDENTITY (1, 1) PRIMARY KEY,
    col2 VARBINARY (64) NOT NULL,
    col1 NVARCHAR (256) NOT NULL INDEX ix__mytable__col1__col2 NONCLUSTERED (col1) INCLUDE (col2)
);

CREATE TABLE mytable (
    id   BIGINT         IDENTITY (1, 1) PRIMARY KEY,
    col2 VARBINARY (64) NOT NULL,
    col1 NVARCHAR (256) NOT NULL INDEX ix__mytable__col1__col2 NONCLUSTERED (col1)
);

CREATE TABLE mytable (
    id   BIGINT         IDENTITY (1, 1) PRIMARY KEY,
    col2 VARBINARY (64) NOT NULL,
    col1 NVARCHAR (256) NOT NULL INDEX ix__mytable__col1__col2 NONCLUSTERED (col1) INCLUDE (col2, id)
);