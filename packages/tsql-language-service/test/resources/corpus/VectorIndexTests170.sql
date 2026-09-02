-- Basic VECTOR index creation
CREATE VECTOR INDEX IX_Vector_Basic ON dbo.Documents (VectorData);

-- VECTOR index with METRIC option
CREATE VECTOR INDEX IX_Vector_Cosine ON dbo.Documents (VectorData)
WITH (METRIC = 'cosine');

CREATE VECTOR INDEX IX_Vector_Dot ON dbo.Documents (VectorData)
WITH (METRIC = 'dot');

CREATE VECTOR INDEX IX_Vector_Euclidean ON dbo.Documents (VectorData)
WITH (METRIC = 'euclidean');

-- VECTOR index with TYPE option
CREATE VECTOR INDEX IX_Vector_DiskANN ON dbo.Documents (VectorData)
WITH (TYPE = 'DiskANN');

-- VECTOR index with both METRIC and TYPE options
CREATE VECTOR INDEX IX_Vector_Complete ON dbo.Documents (VectorData)
WITH (METRIC = 'cosine', TYPE = 'DiskANN');

-- VECTOR index with MAXDOP option
CREATE VECTOR INDEX IX_Vector_MaxDop ON dbo.Documents (VectorData)
WITH (MAXDOP = 4);

-- VECTOR index with multiple options
CREATE VECTOR INDEX IX_Vector_AllOptions ON dbo.Documents (VectorData)
WITH (METRIC = 'dot', TYPE = 'DiskANN', MAXDOP = 8);

-- VECTOR index on schema-qualified table
CREATE VECTOR INDEX IX_Vector_Schema ON MySchema.MyTable (VectorColumn)
WITH (METRIC = 'euclidean');

-- VECTOR index with quoted identifiers
CREATE VECTOR INDEX [IX Vector Index] ON [dbo].[Documents] ([Vector Data])
WITH (METRIC = 'cosine');

-- VECTOR index with filegroup
CREATE VECTOR INDEX IX_Vector_Filegroup ON dbo.Documents (VectorData)
WITH (METRIC = 'cosine')
ON [PRIMARY];

-- VECTOR index with filegroup as string
CREATE VECTOR INDEX IX_Vector_DefaultFG ON dbo.Documents (VectorData)
WITH (METRIC = 'dot')
ON "default";