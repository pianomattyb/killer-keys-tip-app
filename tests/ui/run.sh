#!/bin/bash
cd /workspace/kk-app
for spec in "outer-live.html 390 844 m390" "outer-live.html 1280 800 desk"; do
  pkill -f "node server.js$" ; sleep 0.5
  rm -f data/app.db*; (PORT=3000 node server.js > /tmp/kk-server.log 2>&1 &); sleep 2
  set -- $spec
  (cd /workspace/kk-harness && timeout 300 python3 fulltest.py $1 $2 $3 $4 1 > /tmp/t-$4.log 2>&1)
  grep -n "^FAIL\|Error" /tmp/t-$4.log | cut -c1-250; tail -1 /tmp/t-$4.log
done
