import paramiko
import os
import sys

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

local_base = r"D:\python_project\hms\frontend\src"
remote_base = "/opt/hms-mma/repo/frontend/src"
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

def put_dir(sftp, source, target):
    try:
        sftp.mkdir(target)
    except:
        pass
    for item in os.listdir(source):
        src_path = os.path.join(source, item)
        dst_path = f"{target}/{item}"
        if os.path.isfile(src_path):
            sftp.put(src_path, dst_path)
        elif os.path.isdir(src_path):
            put_dir(sftp, src_path, dst_path)

if __name__ == "__main__":
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"Connecting to {hostname}...")
    ssh.connect(hostname, username=username, password=password)
    sftp = ssh.open_sftp()
    
    print(f"Uploading entire frontend/src from {local_base} to {remote_base}")
    put_dir(sftp, local_base, remote_base)
    
    print("--- Building Frontend ---")
    run_command(ssh, f"cd /opt/hms-mma/repo/frontend && npm run build")
    
    print(f"--- Deploying Frontend to Nginx ---")
    run_command(ssh, f"mkdir -p {web_root}")
    run_command(ssh, f"rm -rf {web_root}/*")
    run_command(ssh, f"cp -r /opt/hms-mma/repo/frontend/dist/* {web_root}/")
    
    print("--- Restarting Nginx ---")
    run_command(ssh, "systemctl restart nginx")

    sftp.close()
    ssh.close()
    print("Frontend Deployment complete.")
