-- Table with Json Column
CREATE TABLE t1(c1 json)

-- xml compression
CREATE TABLE t1 (c1 INT) 
	WITH (XML_COMPRESSION = ON ON PARTITIONS (1))
		
CREATE TABLE t1 (c1 INT) 
	WITH (XML_COMPRESSION = ON ON PARTITIONS (2, 3 TO 5, 4)) 

CREATE TABLE t3 (c1 INT) 
	WITH (XML_COMPRESSION = ON);

CREATE TABLE t1 (c1 INT) 
	WITH (XML_COMPRESSION = OFF ON PARTITIONS (1))

-- xml compression and data_compression
CREATE TABLE t1 (c1 INT) 
	WITH (XML_COMPRESSION = ON ON PARTITIONS (1), DATA_COMPRESSION = ROW ON PARTITIONS (1))
		
CREATE TABLE t1 (c1 INT) 
	WITH (XML_COMPRESSION = ON ON PARTITIONS (2, 3 TO 5, 4), DATA_COMPRESSION = ROW ON PARTITIONS (2, 3 TO 5, 4)) 

CREATE TABLE t3 (c1 INT) 
	WITH (XML_COMPRESSION = ON, DATA_COMPRESSION = PAGE);

-- Table with vector column
CREATE TABLE t4 (c1 vector(10))

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