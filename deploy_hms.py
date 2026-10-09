import paramiko
import os
import sys

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

local_base = r"D:\python_project\hms"
remote_repo = "/opt/hms-mma/repo"
docker_dir = "/opt/hms-mma"
web_root = "/var/www/html/hms" # Changed to /hms subfolder

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

def upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except IOError:
        pass
    for item in os.listdir(local_dir):
        # Prevent uploading heavy/unnecessary folders
        if item in ['.env', '.venv', 'node_modules', 'dist', '__pycache__', '.git', 'uploads', '.pytest_cache', 'deploy_hms.py']:
            continue
        
        local_path = os.path.join(local_dir, item)
        remote_path = f"{remote_dir}/{item}"
        
        if os.path.isfile(local_path):
            print(f"Uploading {local_path} -> {remote_path}")
            sftp.put(local_path, remote_path)
        elif os.path.isdir(local_path):
            upload_dir(sftp, local_path, remote_path)

if __name__ == "__main__":
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"Connecting to {hostname}...")
    ssh.connect(hostname, username=username, password=password)
    sftp = ssh.open_sftp()
    
    # Ensure remote repo directory exists
    try:
        sftp.stat(remote_repo)
    except IOError:
        run_command(ssh, f"mkdir -p {remote_repo}")

    print("--- Uploading Latest Backend ---")
    upload_dir(sftp, os.path.join(local_base, "backend"), f"{remote_repo}/backend")

    print("--- Uploading Latest Frontend ---")
    upload_dir(sftp, os.path.join(local_base, "frontend"), f"{remote_repo}/frontend")

    print("--- Rebuilding and Restarting Backend (Docker) ---")
    # Build and restart backend container
    run_command(ssh, f"cd {docker_dir} && docker compose up -d --build")

    print("--- Building Frontend ---")
    # Install dependencies and build React app
    run_command(ssh, f"cd {remote_repo}/frontend && npm install && npm run build")
    
    print(f"--- Deploying Frontend to Nginx ---")
    # Copy production build to Nginx web root
    run_command(ssh, f"mkdir -p {web_root}")
    run_command(ssh, f"cp -r {remote_repo}/frontend/dist/* {web_root}/")
    
    print("--- Restarting Nginx ---")
    run_command(ssh, "systemctl restart nginx")

    sftp.close()
    ssh.close()
    print("Deployment complete.")
