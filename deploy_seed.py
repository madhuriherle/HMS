import paramiko
import os
import sys

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

local_sql = r"D:\python_project\hms\seed_kerala_karnataka.sql"
remote_sql = "/opt/hms-mma/seed_kerala_karnataka.sql"

def safe_print(value):
    encoding = sys.stdout.encoding or "utf-8"
    print(str(value).encode(encoding, errors="replace").decode(encoding, errors="replace"))

def run_command(ssh, command):
    safe_print(f"Executing: {command}")
    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out: safe_print(out)
    if err: safe_print(f"Error: {err}")
    return exit_status, out, err

if __name__ == "__main__":
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"Connecting to {hostname}...")
    ssh.connect(hostname, username=username, password=password)
    sftp = ssh.open_sftp()
    
    print(f"Uploading {local_sql} to {remote_sql}")
    sftp.put(local_sql, remote_sql)
    
    print("--- Executing SQL in DB container ---")
    # Determine the container name for postgres. It is usually something like hms-mma-db-1 or hms-mma_db_1
    exit_status, out, err = run_command(ssh, f"docker exec -i hms_mma_db psql -U hms_mma -d hms_mma < {remote_sql}")
    if exit_status != 0:
        # try another name
        run_command(ssh, f"docker exec -i hms-mma-db-1 psql -U hms_mma -d hms_mma < {remote_sql}")

    sftp.close()
    ssh.close()
    print("Seeding complete.")
