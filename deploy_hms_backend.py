import paramiko
import os
import sys

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

local_base = r"D:\python_project\hms"
remote_repo = "/opt/hms-mma/repo"
docker_dir = "/opt/hms-mma"

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
    
    local_path = os.path.join(local_base, "backend", "api", "v1", "endpoints", "master_settings", "geography.py")
    remote_path = f"{remote_repo}/backend/api/v1/endpoints/master_settings/geography.py"
    print(f"Uploading {local_path} -> {remote_path}")
    sftp.put(local_path, remote_path)
    
    print("--- Restarting Backend (Docker) ---")
    run_command(ssh, f"cd {docker_dir} && docker compose up -d --build")

    sftp.close()
    ssh.close()
    print("Backend Deployment complete.")
