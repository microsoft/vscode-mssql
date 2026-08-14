CREATE EXTERNAL TABLE t1 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1
    );

CREATE EXTERNAL TABLE t2 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = VALUE,
    REJECT_VALUE = 0.0
    );

CREATE EXTERNAL TABLE t3 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = VALUE,
    REJECT_VALUE = 0
    );

CREATE EXTERNAL TABLE t4 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = VALUE,
    REJECT_VALUE = 10.0
    );

CREATE EXTERNAL TABLE t5 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = VALUE,
    REJECT_VALUE = 10
    );

CREATE EXTERNAL TABLE t6 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = VALUE
    );

CREATE EXTERNAL TABLE t7 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = PERCENTAGE,
    REJECT_SAMPLE_VALUE = 10
    );

CREATE EXTERNAL TABLE t8 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = PERCENTAGE,
	REJECT_VALUE = 50.5,
    REJECT_SAMPLE_VALUE = 10
    );

CREATE EXTERNAL TABLE t9 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    DISTRIBUTION = REPLICATED
    );

CREATE EXTERNAL TABLE t10 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    DISTRIBUTION = ROUND_ROBIN
    );

CREATE EXTERNAL TABLE t11 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    DISTRIBUTION = SHARDED(c1)
    );

CREATE EXTERNAL TABLE t12 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1
    );

CREATE EXTERNAL TABLE t13 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    DISTRIBUTION = SHARDED(c1),
    SCHEMA_NAME = 'sys',
    OBJECT_NAME = 'tables'
    );

CREATE EXTERNAL TABLE t14 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    DISTRIBUTION = REPLICATED,
    SCHEMA_NAME = 'sys',
    OBJECT_NAME = 'tables'
    );

CREATE EXTERNAL TABLE t15 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    DISTRIBUTION = ROUND_ROBIN,
    SCHEMA_NAME = 'sys',
    OBJECT_NAME = 'tables'
    );

CREATE EXTERNAL TABLE t16 (
    c1 INT,
    c2 CHAR (16) COLLATE Latin1_General_BIN2 NOT NULL,
    c3 DATE,
    c4 DECIMAL (5, 2) NULL,
    c5 VARCHAR (50) COLLATE Latin1_General_BIN2 NULL
)
    WITH (
    DATA_SOURCE = eds1,
    LOCATION = '/test/test.txt',
    FILE_FORMAT = eff1,
    REJECT_TYPE = PERCENTAGE,
    REJECT_VALUE = 50.5,
    REJECT_SAMPLE_VALUE = 10,
    REJECTED_ROW_LOCATION = '/REJECT_Directory'
    );