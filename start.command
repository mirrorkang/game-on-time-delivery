#!/bin/bash
cd "$(dirname "$0")"
PORT=8790
# 如果端口被占用，自动往后找
for p in 8790 8791 8792 8793 8794; do
  if ! nc -z 127.0.0.1 "$p" >/dev/null 2>&1; then PORT=$p; break; fi
done
echo "《准时送达》MVP 启动中… http://127.0.0.1:$PORT"
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 0.8
open "http://127.0.0.1:$PORT"
wait $SERVER_PID
