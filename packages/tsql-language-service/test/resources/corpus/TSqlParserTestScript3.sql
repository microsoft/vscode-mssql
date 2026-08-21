-- sacaglar: Testing \r \n \rn and go varieties.

-- end of this line has a \r\n
go

-- end of this line has a \n
go

-- end of this line has a \rgo

-- end of this line has a \r\n
	  go

-- end of this line has a \n
	  go

-- end of this line has a \r		 go


CREATE TABLE A_Schema.MyTable (
	col1 int NOT NULL,
	col2 varchar(10),
	col3 decimal(20, 5),
	col4 timestamp,
	CONSTRAINT MyPimaryKey PRIMARY KEY CLUSTERED (col1 ASC) ,
	CONSTRAINT MyForeignKey FOREIGN KEY (col2)  REFERENCES A_Schema.A_TABLE(A3))
;
