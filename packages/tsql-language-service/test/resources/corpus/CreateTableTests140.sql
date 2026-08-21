-- Tests for ignore_dup_key/suppress_messages options.
CREATE TABLE tab_with_ignoredupkey_suppressmessages_on_pk (
    COL0 INT PRIMARY KEY WITH (IGNORE_DUP_KEY = ON (SUPPRESS_MESSAGES = ON))
);

CREATE TABLE tab_with_ignoredupkey_suppressmessages_on_uk (
    COL0 INT UNIQUE WITH (IGNORE_DUP_KEY = ON (SUPPRESS_MESSAGES = ON))
);

CREATE TABLE tab_with_ignoredupkey_suppressmessages_on_pk (
    COL0 INT PRIMARY KEY WITH (IGNORE_DUP_KEY = ON)
);

CREATE TABLE tab_with_ignoredupkey_suppressmessages_on_uk (
    COL0 INT UNIQUE WITH (IGNORE_DUP_KEY = ON)
);

CREATE TABLE tab_with_ignoredupkey_suppressmessages_on_pk (
    COL0 INT PRIMARY KEY WITH (ALLOW_PAGE_LOCKS = ON, IGNORE_DUP_KEY = ON (SUPPRESS_MESSAGES = ON), ALLOW_ROW_LOCKS = ON)
);

CREATE TABLE tab_with_ignoredupkey_suppressmessages_on_uk (
    COL0 INT UNIQUE WITH (ALLOW_PAGE_LOCKS = ON, IGNORE_DUP_KEY = ON (SUPPRESS_MESSAGES = ON), ALLOW_ROW_LOCKS = ON)
);

CREATE TABLE tab_with_hidden_on_all_column_types (
    pk int PRIMARY KEY,
    col1  BIGINT HIDDEN          ,
    col2  NUMERIC (10, 5) HIDDEN ,
    col3  BIT HIDDEN             ,
    col4  SMALLINT HIDDEN        ,
    col5  DECIMAL (5, 2) HIDDEN  ,
    col6  SMALLMONEY HIDDEN      ,
    col7  INT HIDDEN             ,
    col8  TINYINT HIDDEN         ,
    col9  MONEY HIDDEN           ,
    col10 FLOAT HIDDEN           ,
    col11 REAL HIDDEN            ,
    col12 DATE HIDDEN            ,
    col13 DATETIMEOFFSET HIDDEN  ,
    col14 DATETIME2 HIDDEN       ,
    col15 DATETIME2 (5) HIDDEN   ,
    col16 SMALLDATETIME HIDDEN   ,
    col17 DATETIME HIDDEN        ,
    col18 TIME HIDDEN            ,
    col19 CHAR HIDDEN            ,
    col20 CHAR (20) HIDDEN       ,
    col21 VARCHAR HIDDEN         ,
    col22 VARCHAR (5) HIDDEN     ,
    col23 VARCHAR (MAX) HIDDEN   ,
    col24 TEXT HIDDEN            ,
    col25 NCHAR HIDDEN           ,
    col26 NCHAR (32) HIDDEN      ,
    col27 NVARCHAR HIDDEN        ,
    col28 NVARCHAR (256) HIDDEN  ,
    col29 NVARCHAR (MAX) HIDDEN  ,
    col30 NTEXT HIDDEN           ,
    col31 BINARY HIDDEN          ,
    col32 BINARY (8) HIDDEN      ,
    col33 VARBINARY HIDDEN       ,
    col34 VARBINARY (32) HIDDEN  ,
    col35 IMAGE HIDDEN           ,
    col36 TIMESTAMP HIDDEN       ,
    col37 hierarchyid HIDDEN     ,
    col38 UNIQUEIDENTIFIER HIDDEN,
    col39 UNIQUEIDENTIFIER HIDDEN ROWGUIDCOL UNIQUE,
    col40 SQL_VARIANT HIDDEN     ,
    col41 XML HIDDEN             ,
    col42 geometry HIDDEN        ,
    col43 geography HIDDEN       
);

CREATE TABLE tab_with_hidden_cols (
    [A] int,
    [B] char(32) HIDDEN NULL,
    [C] float HIDDEN NOT NULL,
    [D] int HIDDEN DEFAULT 1,
    [E] int HIDDEN PRIMARY KEY DEFAULT 1,
    [F] datetime2(5) HIDDEN NOT NULL CONSTRAINT [constr1] DEFAULT '2010/01/01',
    [G] nchar(64) HIDDEN NULL CONSTRAINT [constr1] DEFAULT N'SQL',
    [H] int HIDDEN IDENTITY,
    [I] int HIDDEN IDENTITY NOT FOR REPLICATION,
    [J] nchar(10) COLLATE Traditional_Spanish_ci_ai HIDDEN NOT NULL,
    [K] int HIDDEN UNIQUE,
    [L] uniqueidentifier HIDDEN ROWGUIDCOL NOT NULL UNIQUE DEFAULT '123',
);

CREATE TABLE tab_with_hidden_and_temporal (
    [sys_start] datetime2(7) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    [sys_end] datetime2(7) GENERATED ALWAYS AS ROW END NOT NULL,
    [product_code] int NOT NULL,
    [value] int HIDDEN,
    [row_id] int IDENTITY,
    CONSTRAINT [constr1] PRIMARY KEY NONCLUSTERED ([product_code]),
    PERIOD FOR SYSTEM_TIME (sys_start, sys_end)
) WITH ( MEMORY_OPTIMIZED = OFF, SYSTEM_VERSIONING = ON ( HISTORY_TABLE = tab_history ));

CREATE TABLE tab_with_hidden_and_sparse (
    [A] int,
    [B] char(32) SPARSE HIDDEN NULL,
    [C] float SPARSE NULL,
    [D] nchar(64) SPARSE HIDDEN NULL,
    [SpColset] xml COLUMN_SET FOR ALL_SPARSE_COLUMNS HIDDEN
);

CREATE TABLE tab_with_hidden_and_encrypted (
    CustName nvarchar(60)
        COLLATE  Latin1_General_BIN2 ENCRYPTED WITH (COLUMN_ENCRYPTION_KEY = key1,
        ENCRYPTION_TYPE = RANDOMIZED,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256') HIDDEN,
    SSN varchar(11)
        COLLATE  Latin1_General_BIN2 ENCRYPTED WITH (COLUMN_ENCRYPTION_KEY = key1,
        ENCRYPTION_TYPE = DETERMINISTIC ,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'),
    Age int NULL
);

CREATE TABLE tab_with_hidden_and_masked (
    [PK] int not null,
    [Data1] nvarchar(32) masked with (function = 'default()') hidden not null default 'a',
    [Data2] nvarchar(32) masked with (function = 'default()') not null default 'b',
    CONSTRAINT [constr1] PRIMARY KEY ([PK])
);

CREATE TABLE tab_with_hidden_and_filestream (
    [Id] uniqueidentifier ROWGUIDCOL NOT NULL UNIQUE,
    [SerialNumber] INTEGER UNIQUE,
    [Chart] VARBINARY(MAX) FILESTREAM HIDDEN NULL
);

-- Table - Multi Column Distribution 
--
CREATE TABLE myTable1_HASH_MCD (
    id       INT          NOT NULL,
    lastName VARCHAR (20),
    zipCode  VARCHAR (6) 
)
WITH (DISTRIBUTION = HASH(id, lastName));
GO

CREATE TABLE myTable2_HEAP_HASH_MCD (
    id       INT          NOT NULL,
    lastName VARCHAR (20),
    zipCode  VARCHAR (6) 
)
WITH (DISTRIBUTION = HASH(id, lastName, zipCode), HEAP);
GO

CREATE TABLE myTable3_CI_HASH_MCD (
    id       INT          NOT NULL,
    lastName VARCHAR (20),
    zipCode  VARCHAR (6) 
)
WITH (DISTRIBUTION = HASH(id, lastName), CLUSTERED INDEX(zipCode));
GO

CREATE TABLE myTable4_CCI_HASH_MCD (
    [id]       INT          NOT NULL,
    [lastName] VARCHAR (20) NULL,
    [zipCode]  VARCHAR (6)  NULL
)
WITH (CLUSTERED COLUMNSTORE INDEX, DISTRIBUTION = HASH([id], [lastName], [zipCode]));