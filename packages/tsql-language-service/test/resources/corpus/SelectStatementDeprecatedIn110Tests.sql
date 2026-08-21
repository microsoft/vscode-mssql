--old style join syntax
SELECT Tab1.name, Tab2.id FROM Tab1, Tab2 WHERE Tab1.id *= Tab2.id
GO

SELECT Tab1.name, Tab2.id FROM Tab1, Tab2 WHERE Tab1.id =* Tab2.id
GO

IF c1 *= c2
SELECT * FROM t1
GO

IF c1 =* c2
SELECT * FROM t1
GO

--compute clause
-- basic
select c1 from t1 compute avg(c1)

-- all the possible functions
select c1 from t1 compute avg(c1), count(c1), max(c1), min(c1), stdev(c1), stdevp(c1), sum(c1), var(c1), varp(c1), count_big(c1) ,checksum_agg(c1) 
-- multiple computes
select c1 from t1 compute avg(c1), count(c1), max(c1) compute min(c1), stdev(c1), stdevp(c1) compute sum(c1), var(c1), varp(c1), count_big(c1) ,checksum_agg(c1) 

-- mixing in by
-- basic
select c1 from t1 order by c1 compute avg(c1) by c1

select c1, c2 from t1 order by c1, c2 compute sum(c1) by c1, c2 compute avg(c1) by c1
select c1, c2 from t1 order by c1, c2 compute sum(c1), avg(c1) by c1, c2 compute avg(c1) by c1 compute avg(c1), varp(c2) by c1, c2
GO

