create table t1 (	
	-- Column level tests
	a1 int UNIQUE,
	a2 int CONSTRAINT C2 UNIQUE Nonclustered,
	a3 int CONSTRAINT C3 UNIQUE Clustered WITH FILLFACTOR = 34 ON [DEFAULT],
	a4 int CONSTRAINT C4 UNIQUE WITH FILLFACTOR = 34 ON MyGroup,
	a5 int Primary Key,
	a6 int CONSTRAINT C6 PRIMARY KEY Clustered,
	a7 int CONSTRAINT C7 PRIMARY KEY Nonclustered WITH FILLFACTOR = 34 ON [DEFAULT],
	a8 int CONSTRAINT C8 PRIMARY KEY WITH FILLFACTOR = 34 ON MyGroup,
	a9 int CONSTRAINT C3 UNIQUE Clustered WITH FILLFACTOR = 34 ON partScheme,
	a11 int CONSTRAINT C8 PRIMARY KEY WITH sorted_data_reorg ON MyGroup,
	a12 int CONSTRAINT C8 PRIMARY KEY WITH sorted_data fillfactor = 1 ON MyGroup,
	a13 int CONSTRAINT C8 PRIMARY KEY WITH fillfactor = 12 sorted_data_reorg ON MyGroup,

	-- Table level tests
	UNIQUE (a1 asc, a2 desc, a3, a4 desc),
	CONSTRAINT C12 UNIQUE Nonclustered (a1 asc),
	CONSTRAINT C13 UNIQUE Clustered (a1 asc, a2 desc) WITH FILLFACTOR = 34 ON [DEFAULT],
	CONSTRAINT C14 UNIQUE (a1 asc, a2 desc, a3) WITH FILLFACTOR = 34 ON MyGroup,
	Primary Key (a1 asc, a2, a3, a4 desc),
	CONSTRAINT C16 PRIMARY KEY Clustered (a1 asc),
	CONSTRAINT C17 PRIMARY KEY Nonclustered (a1 asc, a2 desc) WITH FILLFACTOR = 34 ON [DEFAULT],
	CONSTRAINT C18 PRIMARY KEY (a1 asc, a2 desc, a3) WITH FILLFACTOR = 34 ON MyGroup,
	CONSTRAINT C19 UNIQUE Clustered (a1 asc, a2 desc) WITH FILLFACTOR = 34,
	CONSTRAINT C21 PRIMARY KEY (a1 asc, a2 desc, a3) WITH sorted_data ON MyGroup,
	CONSTRAINT C22 PRIMARY KEY (a1 asc, a2 desc, a3) WITH sorted_data_reorg fillfactor = 12 ON MyGroup,
	CONSTRAINT C23 PRIMARY KEY (a1 asc, a2 desc, a3) WITH fillfactor = 12 sorted_data ON MyGroup,
)
;

