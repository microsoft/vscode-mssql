--clustered columnstore index and columnstore compression syntax tests

Create columnstore Index cindx on t(c1) with (DATA_COMPRESSION = COLUMNSTORE)
Create columnstore Index cindx on t(c1) with (DATA_COMPRESSION = COLUMNSTORE_ARCHIVE)

Create Clustered columnstore Index cindx on t with (DATA_COMPRESSION = COLUMNSTORE)
Create Clustered columnstore Index cindx on t with (DATA_COMPRESSION = COLUMNSTORE_ARCHIVE)

Create NonClustered columnstore Index cindx on t(c1,c2) with (DATA_COMPRESSION = COLUMNSTORE)
Create NonClustered columnstore Index cindx on t(c1,c2) with (DATA_COMPRESSION = COLUMNSTORE_ARCHIVE)

Create NonClustered columnstore Index cindx on t(c1,c2) With (DROP_Existing = ON, DATA_COMPRESSION = COLUMNSTORE)
Create NonClustered columnstore Index cindx on t(c1,c2) With (MaxDOP = 12, DATA_COMPRESSION = COLUMNSTORE)
Create NonClustered columnstore Index cindx on t(c1,c2) With (MaxDOP = 12, DROP_Existing = ON, DATA_COMPRESSION = COLUMNSTORE)

Create Clustered columnstore Index cindx on t With (DROP_Existing = ON, DATA_COMPRESSION = COLUMNSTORE)
Create Clustered columnstore Index cindx on t With (MaxDOP = 12, DATA_COMPRESSION = COLUMNSTORE)
Create Clustered columnstore Index cindx on t With (MaxDOP = 12, DROP_Existing = ON, DATA_COMPRESSION = COLUMNSTORE)

Create NonClustered columnstore Index cindx on t(c1,c2) With (DATA_COMPRESSION = COLUMNSTORE) on ps(c1)
Create NonClustered columnstore Index cindx on t(c1,c2) With (MaxDOP = 12, DROP_Existing = ON, DATA_COMPRESSION = COLUMNSTORE) on ps(c1)
