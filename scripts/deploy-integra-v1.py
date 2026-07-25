import paramiko
import sys
import os
import tarfile
import tempfile
from pathlib import Path

HOST = "103.253.212.64"
USER = "root"
PASSWORD = os.environ.get("PERMATRAX_DEV_SSH_PASS", "")
REMOTE_DIR = "/var/www/permatrax-dev"
LOCAL_ROOT = Path(r"d:\Projects\AI Tech\PermaTrack")

INCLUDE_DIRS = [
    "packages/db",
    "apps/api",
    "apps/web",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "ecosystem.dev.config.js",
    "deploy-dev.sh",
]

EXCLUDE_PARTS = {
    "node_modules",
    ".next",
    "dist",
    ".turbo",
    "__pycache__",
    ".git",
    "uploads",
}


def should_exclude(path: Path) -> bool:
    return any(p in EXCLUDE_PARTS for p in path.parts)


def make_tarball() -> Path:
    tmp = Path(tempfile.gettempdir()) / "permatrax-integra-v1.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        for item in INCLUDE_DIRS:
            src = LOCAL_ROOT / item
            if not src.exists():
                print("skip missing", item)
                continue
            if src.is_file():
                tar.add(src, arcname=item)
                continue
            for root, dirs, files in os.walk(src):
                root_p = Path(root)
                dirs[:] = [d for d in dirs if d not in EXCLUDE_PARTS]
                for f in files:
                    fp = root_p / f
                    if should_exclude(fp):
                        continue
                    arc = fp.relative_to(LOCAL_ROOT).as_posix()
                    tar.add(fp, arcname=arc)
    print("tarball", tmp, "size", tmp.stat().st_size)
    return tmp


def ssh_exec(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(">>", cmd[:200])
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        try:
            print(out[-4000:])
        except UnicodeEncodeError:
            print(out[-4000:].encode("ascii", "replace").decode("ascii"))
    if err.strip():
        try:
            print("ERR:", err[-2000:])
        except UnicodeEncodeError:
            print("ERR:", err[-2000:].encode("ascii", "replace").decode("ascii"))
    print("exit", code)
    return code, out, err


def main():
    if not PASSWORD:
        print("Set PERMATRAX_DEV_SSH_PASS env var")
        sys.exit(2)
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    print("connected")

    if mode == "probe":
        for cmd in [
            "ls -la /var/www/permatrax-dev | head -25",
            "cd /var/www/permatrax-dev && (git rev-parse --abbrev-ref HEAD; git status -sb | head -8) 2>&1 | head -20",
            "pm2 list 2>&1 | head -25",
            "ls /var/www/permatrax-dev/packages/db/prisma/migrations 2>&1 | tail -12",
        ]:
            ssh_exec(client, cmd, timeout=60)
        client.close()
        return

    if mode == "deploy":
        tarball = make_tarball()
        sftp = client.open_sftp()
        remote_tar = "/tmp/permatrax-integra-v1.tar.gz"
        print("uploading...")
        sftp.put(str(tarball), remote_tar)
        sftp.close()
        print("uploaded")

        cmds = [
            f"mkdir -p {REMOTE_DIR} && tar -xzf {remote_tar} -C {REMOTE_DIR}",
            f"cd {REMOTE_DIR} && export PNPM_HOME=/root/.local/share/pnpm && export PATH=$PNPM_HOME:$PATH && pnpm install --frozen-lockfile",
            f"cd {REMOTE_DIR}/packages/db && export DATABASE_URL='postgresql://permatrax:permatrax123@127.0.0.1:5432/permatrax_dev?schema=public&connection_limit=5' && npx prisma generate && npx prisma migrate deploy",
            f"cd {REMOTE_DIR}/apps/api && pnpm build",
            f"cd {REMOTE_DIR}/apps/web && BASE_PATH=/Permatrax API_URL=http://127.0.0.1:3003 NEXT_PUBLIC_API_URL=https://aitech-ilt.co.id/Permatrax/api NEXT_PUBLIC_FILES_URL=https://aitech-ilt.co.id/Permatrax/api/files NEXT_PUBLIC_APP_NAME=PermaTrax NODE_OPTIONS='--max-old-space-size=4096' pnpm build",
            f"cd {REMOTE_DIR} && pm2 restart ecosystem.dev.config.js --update-env || pm2 start ecosystem.dev.config.js",
            "pm2 save",
            "sleep 3; pm2 list; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/health || curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/api/health || true",
        ]
        for cmd in cmds:
            code, _, _ = ssh_exec(client, cmd, timeout=900)
            if code != 0 and "pm2" not in cmd and "curl" not in cmd:
                print("FAILED:", cmd)
                client.close()
                sys.exit(code)
        client.close()
        print("DEPLOY_OK")
        return

    print("unknown mode")
    client.close()
    sys.exit(2)


if __name__ == "__main__":
    main()
