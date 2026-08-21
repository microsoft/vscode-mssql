-- CREATE TABLE .. with OPTIMIZE_FOR_SEQUENTIAL_KEY index option for index, primary key, and uniquey key
CREATE TABLE table1 (
    a int INDEX idx1 NONCLUSTERED WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = ON),
    b int INDEX idx2 NONCLUSTERED WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF),
    INDEX idx_pk CLUSTERED (a, b) WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = ON)
);

CREATE TABLE table1 (
    a int PRIMARY KEY WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = ON),
    b int UNIQUE WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = ON),
    c int UNIQUE WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF)
);

CREATE TABLE table1 (
    a int,
    b int,
    c int,
    d int,
    CONSTRAINT pk PRIMARY KEY (a, b) WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = ON),
    CONSTRAINT uq_c UNIQUE NONCLUSTERED (c) WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = ON),
    CONSTRAINT uq_d UNIQUE NONCLUSTERED (d) WITH (OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF)
);

-- Table with nonclustered inline index with included columns
CREATE TABLE T1 (
	C1 INT NOT NULL,
	C2 INT NOT NULL,
	C3 INT NULL,
	INDEX idx NONCLUSTERED (C1) INCLUDE (C2, C3)
);

-- Table with inline index of unspecified type with included columns
CREATE TABLE T2 (
	C1 INT NOT NULL,
	C2 INT NOT NULL,
	C3 INT NULL,
	INDEX idx (C1) INCLUDE (C2, C3)
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