-- Test On
select c1 into t2 on fg from t1;
select c1 into t2 on [default] from t1;
select c1 into t2 on [fg] from t1;
select all c1 into myDb..t2 on fg from t1;
(select c1 into t2 on fg from t1);
((select c1 into t2 on fg from t1));
select c1 into t2 on fg from t1 union select c1 from t2;
(select c1 into t2 on fg from t1) union select c1 from t2;
GO