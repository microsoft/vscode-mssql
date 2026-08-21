--sacaglar, comments inline

-- Identifier
save tran myTransaction

-- variable
save transaction @tranVariable

-- legacy name testing
save tran 5 : a . b;
save tran -5:a.b;
save tran - 100 : 
		a		.
		b;

save tran - 100 : 
		[a	]	.
		[b
		
		];
