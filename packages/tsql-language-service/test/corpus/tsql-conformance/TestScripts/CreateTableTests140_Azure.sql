CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE=dbo.t_history, DATA_CONSISTENCY_CHECK=ON, HISTORY_RETENTION_PERIOD=INFINITE));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE=dbo.t_history, DATA_CONSISTENCY_CHECK=ON, HISTORY_RETENTION_PERIOD=3 DAYS));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE=dbo.t_history, HISTORY_RETENTION_PERIOD=3 MONTHS));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON ( HISTORY_RETENTION_PERIOD=5 YEARS));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE=dbo.t_history, DATA_CONSISTENCY_CHECK=OFF, HISTORY_RETENTION_PERIOD=8 WEEKS));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON ( DATA_CONSISTENCY_CHECK=OFF, HISTORY_RETENTION_PERIOD=1 WEEK));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON ( DATA_CONSISTENCY_CHECK=OFF, HISTORY_RETENTION_PERIOD=2 MONTH));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE=dbo.t_history, DATA_CONSISTENCY_CHECK=OFF, HISTORY_RETENTION_PERIOD=10 MONTH));


GO
CREATE TABLE tab_with_retention (
    COL0      INT                                        ,
    COL1      XML                                        ,
    COL2      FLOAT                                      ,
    COL3      NVARCHAR (64)                              ,
    SYS_START DATETIME2 (7) GENERATED ALWAYS AS ROW START NOT NULL,
    SYS_END   DATETIME2 (7) GENERATED ALWAYS AS ROW END   NOT NULL,
    CONSTRAINT PK_MY_PRIMARY_KEY PRIMARY KEY CLUSTERED (COL0),
    PERIOD FOR SYSTEM_TIME (SYS_START, SYS_END)
)
WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE=dbo.t_history, DATA_CONSISTENCY_CHECK=OFF, HISTORY_RETENTION_PERIOD=1 YEAR));


GO