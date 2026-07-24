import os
import paramiko

password = os.environ.get("PERMATRAX_DEV_SSH_PASS", "")
if not password:
    raise SystemExit("Set PERMATRAX_DEV_SSH_PASS")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("103.253.212.64", username="root", password=password, timeout=30)

cmds = [
    "cd /var/www/permatrax-dev/packages/db && DATABASE_URL='postgresql://permatrax:permatrax123@127.0.0.1:5432/permatrax_dev?schema=public' npx prisma migrate status 2>&1 | tail -25",
    "ls /var/www/permatrax-dev/packages/db/prisma/migrations | grep -E 'daily_activity_detail|integra_v2' || true",
    "pm2 jlist 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print([(x['name'], x['pm2_env']['status']) for x in d])\"",
    "curl -s -o /dev/null -w 'web:%{http_code} daily:%{http_code}\\n' http://127.0.0.1:3002/Permatrax/daily-activity",
    "curl -s -o /dev/null -w 'api_daily:%{http_code}\\n' http://127.0.0.1:3003/api/daily-activities",
    "ls '/var/www/permatrax-dev/apps/web/.next/server/app/(dashboard)/daily-activity' 2>&1 | head",
    'docker exec permatrax-dev-postgres psql -U permatrax -d permatrax_dev -c "\\d \\"DailyActivityEvidence\\"" 2>&1 | head -20',
    'docker exec permatrax-dev-postgres psql -U permatrax -d permatrax_dev -c "SELECT column_name FROM information_schema.columns WHERE table_name=\'FtttSpan\' AND column_name=\'lengthMeters\';" 2>&1',
]

for cmd in cmds:
    print("====", cmd[:130])
    stdin, stdout, stderr = c.exec_command(cmd, timeout=180)
    print(stdout.read().decode("utf-8", "replace")[-2500:])
    err = stderr.read().decode("utf-8", "replace")
    if err.strip():
        print("ERR", err[-800:])

c.close()
print("V2_VERIFY_DONE")
