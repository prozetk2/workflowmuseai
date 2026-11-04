#!/bin/bash
# Runs t1..t22 against the extension folder (default ../cos-alpha-flow). Output of each test goes to out-tN.txt.
cd "$(dirname "$0")"; EXT=$(cd "${1:-../cos-alpha-flow}" && pwd); fail=0
for t in t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11 t12 t13 t14 t15 t16 t17 t18 t19 t20 t21 t22; do echo "##### $t"; timeout 500 node $t.js "$EXT" > out-$t.txt 2>&1; code=$?; tail -1 out-$t.txt; grep -E "^FAIL|ERRORS:" out-$t.txt; [ $code -ne 0 ] && { echo "exit $code"; fail=1; }; done
exit $fail
