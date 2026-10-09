import paramiko
import os
import sys

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

local_base = r"D:\python_project\hms"
remote_repo = "/opt/hms-mma/repo"
web_root = "/var/www/html/hms"

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
    
    local_path = os.path.join(local_base, "frontend", "src", "pages", "Dashboard.jsx")
    remote_path = f"{remote_repo}/frontend/src/pages/Dashboard.jsx"
    print(f"Uploading {local_path} -> {remote_path}")
    sftp.put(local_path, remote_path)
    
    print("--- Building Frontend ---")
    run_command(ssh, f"cd {remote_repo}/frontend && npm run build")
    
    print(f"--- Deploying Frontend to Nginx ---")
    run_command(ssh, f"mkdir -p {web_root}")
    run_command(ssh, f"cp -r {remote_repo}/frontend/dist/* {web_root}/")
    
    print("--- Restarting Nginx ---")
    run_command(ssh, "systemctl restart nginx")

    sftp.close()
    ssh.close()
    print("Frontend Deployment complete.")
