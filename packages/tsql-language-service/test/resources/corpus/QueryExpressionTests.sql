--sacaglar, comments inline:

--test beginning with paranthesis
(select * from t1);
(select c1 from t1 where c1.t1 < 10 and t1 > 3)
(((select * from t1)))

-- test basic union
select * from t1 union select * from t2

-- test all
select * from t1 union all select * from t2

GO
-- test union with paranthesis
(select * from t1 union select c2 from t2 group by c1 having count(*) > 1) union (select c3 from t3) union all select c4 from t4 where c4 < 100 union select * from [table 5]

-- test basic except
select * from t1 except select * from t2

-- test all
select * from t1 except all select * from t2

-- test basic intersect
select * from t1 intersect select * from t2

-- test all
select * from t1 intersect all select * from t2

GO
-- test union, except, intersect
(select * from t1 intersect select c2 from t2 group by c1) except (select c3 from t3) union all select c4 from t4 where c4 < 100 intersect select * from [table 5]

GO
-- test join/non join disabmiguation in FROM clause, DTS 654522
select * from
(
	(select A.c2 FROM A)  
union all
	SELECT A.c1 FROM A left join B on A.c1=B.c3
) C
