-- drop database
DROP DATABASE publishing
DROP DATABASE pubs, newpubs

-- drop index
DROP INDEX authors.au_id_ind
DROP INDEX authors.au_id_ind, authors.au_id_ind2

-- drop table 
DROP TABLE pubs.dbo.authors2

-- drop statistics
DROP STATISTICS authors.anames, titles.tnames
DROP STATISTICS ..T1.S1

-- all other drops
DROP PROCEDURE p1	

DROP FUNCTION f1

DROP VIEW v1

DROP DEFAULT d1
	
DROP RULE [r1]
	
DROP TRIGGER t1

DROP PROC p1

-- No collision with DATABASE SCOPED CREDENTIALS
DROP DATABASE SCOPED

DROP DATABASE [SCOPED CREDENTIAL]

DROP DATABASE SCOPED, CREDENTIAL

