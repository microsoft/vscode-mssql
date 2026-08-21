-- multi-param aggregates
CREATE AGGREGATE a1(@input1 xml(zzz), @input2 int) RETURNS int EXTERNAL NAME ag1
