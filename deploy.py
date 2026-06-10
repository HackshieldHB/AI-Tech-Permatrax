import paramiko, io, sys

HOST = '103.253.212.64'
USER = 'root'
PASS = '@IntegraAitech2026'
PROJ = '/var/www/permatrax-dev'

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def run(client, cmd, timeout=300):
    print('\n$ ' + cmd); sys.stdout.flush()
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc  = stdout.channel.recv_exit_status()
    if out.strip(): print(out.rstrip()); sys.stdout.flush()
    if err.strip(): print('[STDERR] ' + err.rstrip()); sys.stdout.flush()
    return rc, out, err

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15)
print('=== Connected ===')

run(client, 'cd ' + PROJ + ' && git pull origin dev')
run(client, 'cd ' + PROJ + ' && git log --oneline -1')

print('\n--- Build API ---')
rc, _, _ = run(client, 'cd ' + PROJ + '/apps/api && pnpm run build 2>&1', timeout=300)
print('API build rc=' + str(rc))

print('\n--- Restart API ---')
run(client, 'pm2 restart permatrax-dev-api 2>&1 | tail -5', timeout=30)
run(client, 'pm2 list 2>&1 | grep permatrax-dev-api', timeout=15)

print('\n=== Done rc=' + str(rc) + ' ===')
client.close()
