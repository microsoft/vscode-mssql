--column store index tests
Create columnstore Index cindx on t(c1)

Create Clustered columnstore Index cindx on t
Create NonClustered columnstore Index cindx on t(c1,c2)

Create NonClustered columnstore Index cindx on t(c1,c2) With (DROP_Existing = ON)
Create NonClustered columnstore Index cindx on t(c1,c2) With (MaxDOP = 12)
Create NonClustered columnstore Index cindx on t(c1,c2) With (MaxDOP = 12, DROP_Existing = ON)

Create NonClustered columnstore Index cindx on t(c1,c2) on ps(c1)
Create NonClustered columnstore Index cindx on t(c1,c2) With (MaxDOP = 12,DROP_Existing = ON) on ps(c1)
