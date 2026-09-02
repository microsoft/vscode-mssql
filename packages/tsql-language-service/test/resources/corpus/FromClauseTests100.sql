-- sub DMLs
-- inner insert
INSERT INTO t1 SELECT * FROM 
(INSERT INTO t2 OUTPUT c1 SELECT * FROM zzz) AS ao
GO

-- inner update
INSERT INTO t1 SELECT * FROM 
(UPDATE t3 SET c1 = 10 OUTPUT c1) AS ao
GO

-- inner delete
INSERT INTO t1 SELECT * FROM 
(DELETE FROM t3 OUTPUT c1) AS ao
GO

-- inner merge
INSERT INTO t1 SELECT * FROM 
(MERGE pi USING t1 ON (pi.PID = t1.PID) 
    WHEN MATCHED THEN UPDATE SET pi.Qty = t1.Qty OUTPUT c1) AS ao
GO

-- CHANGETABLE
-- CHANGETABLE CHANGES
SELECT * FROM CHANGETABLE(CHANGES t1, 10) AS a
DELETE t1 FROM CHANGETABLE(CHANGES dbo.t1, @v1) AS a (c1)
UPDATE t1 SET c1 = 10 FROM CHANGETABLE(CHANGES d1.dbo.t1, NULL) AS a

-- CHANGETABLE VERSION
SELECT * FROM CHANGETABLE(VERSION s1.d1.dbo.t1, (c1), (1)) AS a
SELECT * FROM CHANGETABLE(VERSION z..t1, (c1, c2), ('a', 'b')) AS a (z1, z2)
GO

-- Inlined table
SELECT * FROM (VALUES (10)) AS derived
DELETE t1 FROM (VALUES ('a', 'b'), ('c', 'd')) AS derived(c1, c2)
GO

-- Multiple columns passed to aggregate in PIVOT
SELECT * FROM st
PIVOT
(
	dbo.z1.MyAggregate(StandardCost, st.OtherColumn)
	FOR DaysToManufacture IN ([0], [1])
) AS PivotTable;

-- ForceSeek with parameter
SELECT * FROM t with (FORCESEEK(i134(c1,c3,c4))) where (c1 = 0 and c3 = 100 and c4 = 0.5)

SELECT * FROM t with (FORCESEEK(1(c1))) where (c1 = 0 and c3 = 100 and c4 = 0.5)

select count(*)
from
  outerside as L,
  multitvl as R 
where
  L.a = R.a
  and
  (
    R.b = 0
    or
    (
      R.b > 1  
    )
  )
  option(TABLE HINT (R,FORCESEEK(nci_abc(a,b))))

SELECT * FROM t with (FORCESEEK) where c1 = 0 and c3 = 100
-- ForceScan
SELECT * FROM t with (FORCESCAN) where c1 = 0 and c3 = 100

SELECT * FROM t with (FORCESCAN, index = 1) where c1 = 0 and c3 = 100

SELECT * FROM t where c1 = 3 option(TABLE HINT(t, FORCESCAN))
