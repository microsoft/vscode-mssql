-- REGEXP_COUNT(text, pattern [, start [, flags ]])
SELECT REGEXP_COUNT('hello', 'he(l+)o');
SELECT REGEXP_COUNT('hello', 'he(l+)o', 1);
SELECT REGEXP_COUNT('hello', 'he(l+)o', 1, 'i');

-- REGEXP_INSTR(text, pattern [, start [, occurrence [, return_option [, flags [, group ]]]]])
SELECT REGEXP_INSTR('hello', 'he(l+)o');
SELECT REGEXP_INSTR('hello', 'he(l+)o', 1);
SELECT REGEXP_INSTR('hello', 'he(l+)o', 1, 1);
SELECT REGEXP_INSTR('hello', 'he(l+)o', 1, 1, 0);
SELECT REGEXP_INSTR('hello', 'he(l+)o', 1, 1, 0, 'i');
SELECT REGEXP_INSTR('hello', 'he(l+)o', 1, 1, 0, 'c', 1);

-- REGEXP_REPLACE(text, pattern [, replacement [, start [, occurrence [, flags ]]]])
SELECT REGEXP_REPLACE('hello', 'he(l+)o');
SELECT REGEXP_REPLACE('hello', 'he(l+)o', 'hi\1o');
SELECT REGEXP_REPLACE('hello', 'he(l+)o', 'hi\1o', 1);
SELECT REGEXP_REPLACE('hello', 'he(l+)o', 'hi\1o', 1, 1);
SELECT REGEXP_REPLACE('hello', 'he(l+)o', 'hi\1o', 1, 1, 'm');

-- REGEXP_SUBSTR(text, pattern [, start [, occurrence [, flags [, group ]]]])
SELECT REGEXP_SUBSTR('hello', 'he(l+)o');
SELECT REGEXP_SUBSTR('hello', 'he(l+)o', 1);
SELECT REGEXP_SUBSTR('hello', 'he(l+)o', 1, 1);
SELECT REGEXP_SUBSTR('hello', 'he(l+)o', 1, 1, 's');
SELECT REGEXP_SUBSTR('hello', 'he(l+)o', 1, 1, 'c', 1);