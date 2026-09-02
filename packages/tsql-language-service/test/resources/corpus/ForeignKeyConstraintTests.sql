-- sacaglar: comments inline

create table t1 (	
	-- Column level tests
	a1 int CONSTRAINT C1 FOREIGN KEY REFERENCES TestDB.Gokhan.Employees (c1) ON DELETE CASCADE ON UPDATE nO  
		aCTION NOT FOR REPLICATION,
	a2 int FOREIGN KEY REFERENCES DB.Sch.T1 (C1) ON DELETE No Action ON UPDATE CASCADE ,
	a3 int CONSTRAINT C2 REFERENCES DB.Sch.T1 ON DELETE CASCADE ON UPDATE No ACTiON,
	a4 int REFERENCES DB.Sch.T1 ON DELETE CASCADE,

	-- Table level tests
	CONSTRAINT C1 FOREIGN KEY REFERENCES TestDB.Gokhan.Employees (c1, c2) ON DELETE CASCADE ON UPDATE nO  
		aCTION NOT FOR REPLICATION,
	FOREIGN KEY REFERENCES DB.Sch.T1 (C1) ON DELETE No Action ON UPDATE CASCADE ,
	CONSTRAINT C2 FOREIGN KEY (a1) REFERENCES DB.Sch.T1 ON DELETE CASCADE ON UPDATE No ACTiON,
	CONSTRAINT C3 FOREIGN KEY REFERENCES TestDB.Gokhan.Employees (c1, c2) ON DELETE Set Null ON UPDATE set  
		default NOT FOR REPLICATION,
	FOREIGN KEY REFERENCES TestDB.Gokhan.Employees (c1, c2) ON DELETE Set DEFAULT ON UPDATE set  
		NULL NOT FOR REPLICATION,

)
;

create table MStracer_history
(
	parent_tracer_id	int not null,
	agent_id			int not NULL,
	subscriber_commit	datetime null
	
	constraint fk_MStracer_tokens_parent_tracer_id foreign key 
	(
		parent_tracer_id
	) 
	references MStracer_tokens
	(
		tracer_id
	)
)