-- CREATE TABLE AS NODE|EDGE

CREATE TABLE PersonTable (
    name VARCHAR(32)
) AS NODE;

CREATE TABLE LikesTable (
    howmuch int
) AS EDGE;

CREATE TABLE LikesTable AS EDGE;

CREATE TABLE NODE (
    name VARCHAR(32)
) AS NODE;

CREATE TABLE edge (
    howmuch int
) AS EDGE;

CREATE TABLE PersonTable (
    name VARCHAR(32)
) AS node;

CREATE TABLE LikesTable (
    howmuch int
) AS edge;

create table LikesTable(
    id int PRIMARY KEY,
    SysStartTime datetime2 GENERATED ALWAYS AS ROW START NOT NULL,
    SysEndTime datetime2 GENERATED ALWAYS AS ROW END NOT NULL,
    PERIOD FOR SYSTEM_TIME (SysStartTime,SysEndTime)
) AS EDGE
WITH (SYSTEM_VERSIONING = ON);


-- SELECT from tables named NODE and EDGE

SELECT * FROM NODE;
SELECT * FROM node;
SELECT * FROM [NODE];

SELECT * FROM EDGE;
SELECT * FROM edge;
SELECT * FROM [EDGE];


-- CREATE INDEX on $graph columns

CREATE INDEX IX1 ON PersonTable($node_id);

CREATE INDEX IX1 ON LikesTable($edge_id, $from_id, $to_id);

CREATE NONCLUSTERED COLUMNSTORE INDEX IX1 ON PersonTable($node_id);

CREATE NONCLUSTERED COLUMNSTORE INDEX IX1 ON LikesTable($edge_id, $from_id, $to_id);


-- MATCH clause

SELECT *
FROM NODE AS N, EDGE AS E, EDGE AS E2, NODE AS N2
WHERE MATCH( N -(E) - > N2 < - (E2)-N);

SELECT *
FROM ANYTHING
WHERE MATCH(A-(B)->C-(D)->E-(F)->G-(H)->I);

SELECT *
FROM NODE AS N, EDGE AS E, EDGE AS E2, NODE AS N2
WHERE MATCH( N <-(E) - N2 - (E2)- >N AND N - (E) -> N2 <- (E) - N);

SELECT *
FROM NODE AS N, EDGE AS E, EDGE AS E2, NODE AS N2
WHERE (MATCH(N<-(E)-N2
            AND N2-(E2)->N) AND
MATCH(
            N-(E)->N2
            AND N2<-(E)-N));

SELECT *
FROM NODETABLE, MATCH() X
WHERE MATCH( A-(B)->C);

-- Disjunctions are syntactically valid
SELECT *
FROM NODE AS N, EDGE AS E, EDGE AS E2, NODE AS N2
WHERE MATCH( N <-(E) - N2 - (E2)- >N) OR MATCH(N - (E) -> N2 <- (E) - N);

-- Negations are syntactically valid
SELECT *
FROM NODE AS N, EDGE AS E, EDGE AS E2, NODE AS N2
WHERE MATCH( N <-(E) - N2 - (E2)- >N) AND NOT MATCH(N - (E) -> N2 <- (E) - N);

-- Inline indexes on Pseudo columns are allowed
--

CREATE TABLE [dbo].[node_1] (c1 int, index idx nonclustered ($node_id)) AS NODE;

CREATE TABLE [dbo].[node_2] (c1 int, index idx nonclustered ($node_id, c1)) AS NODE;

CREATE TABLE [dbo].[node_3] (c1 int, index idx nonclustered columnstore($node_id)) AS NODE;

CREATE TABLE [dbo].[node_4] (c1 int, index idx nonclustered columnstore(c1, $node_id)) AS NODE;

create index NC_node_4	ON node_4 (c1) INCLUDE ($node_id);

-- Inline indexes require another column element, so inline indexes don't work on edge tables
-- without a column.
--
CREATE TABLE [dbo].[edge_1] (c1 int, index idx nonclustered ($edge_id)) AS EDGE;

CREATE TABLE [dbo].[edge_2] (c1 int, index idx nonclustered ($from_id, c1)) AS EDGE;

CREATE TABLE [dbo].[edge_3] (c1 int, index idx nonclustered ($to_id, $from_id, $edge_id, c1)) AS EDGE;

CREATE TABLE [dbo].[edge_4] (c1 int, index idx nonclustered columnstore ($edge_id, c1)) AS EDGE;

CREATE TABLE [dbo].[edge_5] (c1 int, index idx nonclustered columnstore ($from_id, $to_id, $edge_id, c1)) AS EDGE;

create statistics stat2 on n1(c1, $node_id, c2)
