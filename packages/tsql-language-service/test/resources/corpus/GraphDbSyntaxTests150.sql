create table [dbo].[node_5] (c1 int, index idx (c1) include ($node_id)) As Node;

ALTER TABLE edge add constraint myConstraint CONNECTION (node3 TO node4);

ALTER TABLE edge2
ADD CONSTRAINT myConstraint CONNECTION (node3 TO node4, node1 TO node2, node1 TO node4);

CREATE TABLE edge3 (howmuch INT,constraint myConstraint CONNECTION (node1 TO node2)
) AS EDGE;

create table edge4 (
howmuch int,
CONSTRAINT myConstraint connection (node1 to node2, node3 TO node4)
) AS EDGE;
merge into Owns
using (Source join Person on Source.FirstName = Person.FirstName join Dog on Source.DogName = Dog.DogName)
on match (Person-(Owns)->Dog) 
when not matched by source then delete
output inserted.*, deleted.*;
