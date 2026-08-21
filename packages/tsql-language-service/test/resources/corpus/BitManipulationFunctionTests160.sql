-- LEFT_SHIFT
SELECT LEFT_SHIFT(12345, 5);

-- RIGHT_SHIFT
SELECT RIGHT_SHIFT(12345, 5);

-- BIT_COUNT
SELECT BIT_COUNT ( 0xabcdef ) as Count;

SELECT BIT_COUNT ( 17 ) as Count;

-- GET_BIT
SELECT GET_BIT ( 0xabcdef, 2 ) as Get_2nd_Bit,
       GET_BIT ( 0xabcdef, 4 ) as Get_4th_Bit;

-- SET_BIT
SELECT SET_BIT ( 0x00, 2 ) as VARBIN1;

SELECT SET_BIT ( 0xabcdef, 0, 0 ) as VARBIN2;