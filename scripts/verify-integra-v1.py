import os
import paramiko

password = os.environ.get("PERMATRAX_DEV_SSH_PASS", "")
if not password:
    raise SystemExit("Set PERMATRAX_DEV_SSH_PASS")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("103.253.212.64", username="root", password=password, timeout=30)

cmds = [
    "curl -s -o /dev/null -w 'api_finance:%{http_code}\\n' http://127.0.0.1:3003/api/finance-projects",
    "curl -s -o /dev/null -w 'api_fttt:%{http_code}\\n' http://127.0.0.1:3003/api/fttt-projects",
    "curl -s -o /dev/null -w 'api_daily:%{http_code}\\n' http://127.0.0.1:3003/api/daily-activities",
    "curl -s -o /dev/null -w 'web:%{http_code}\\n' http://127.0.0.1:3002/Permatrax",
    "pm2 jlist 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print([(x['name'], x['pm2_env']['status']) for x in d])\"",
]

for cmd in cmds:
    print("====", cmd[:120])
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    if err.strip():
        print("ERR", err[-500:])

c.close()
print("SMOKE_DONE")
