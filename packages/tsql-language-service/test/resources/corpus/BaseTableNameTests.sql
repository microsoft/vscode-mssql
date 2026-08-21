-- sacaglar: All the combinations of a three part name is tested.

create table t1 (c1 int);

create table .t1 (c1 int);

create table ..t1 (c1 int);

create table s1.t1 (c1 int);

create table .s1.t1 (c1 int);

create table d1.s1.t1 (c1 int);

create table d1..t1 (c1 int);


