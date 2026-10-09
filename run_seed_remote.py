import paramiko
import os

VPS_HOST = "187.127.173.27"
VPS_USER = "root"
VPS_PASS = "D-apps@123456"

def run_seed():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("Connecting to VPS...")
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS)
    
    sftp = ssh.open_sftp()
    
    # Upload the script
    local_script = "seed_pincodes.py"
    remote_script = "/opt/hms-mma/seed_pincodes.py"
    print("Uploading seed script...")
    sftp.put(local_script, remote_script)
    
    # Upload the CSV
    local_csv = r"C:\Users\ASPIRE\Downloads\All_India_pincode_data.csv"
    remote_csv = "/opt/hms-mma/All_India_pincode_data.csv"
    print("Uploading CSV...")
    sftp.put(local_csv, remote_csv)
    sftp.close()
    
    print("Executing script on VPS backend container...")
    
    # The script currently has hardcoded CSV path 'C:\Users\ASPIRE\Downloads\All_India_pincode_data.csv'
    # Wait, the script will run INSIDE the container, so we need to copy it into the container first, or mount it, or rewrite the path!
    
    # Let's rewrite the script to use a command line argument
    script_mod_cmd = '''sed -i "s|r'C:\\\\Users\\\\ASPIRE\\\\Downloads\\\\All_India_pincode_data.csv'|'/app/All_India_pincode_data.csv'|g" /opt/hms-mma/seed_pincodes.py'''
    ssh.exec_command(script_mod_cmd)
    
    # Copy both to container
    print("Copying to container...")
    ssh.exec_command("docker cp /opt/hms-mma/seed_pincodes.py hms_mma_backend:/app/seed_pincodes.py")
    ssh.exec_command("docker cp /opt/hms-mma/All_India_pincode_data.csv hms_mma_backend:/app/All_India_pincode_data.csv")
    
    # Execute
    print("Running seed script in container...")
    stdin, stdout, stderr = ssh.exec_command("docker exec hms_mma_backend python /app/seed_pincodes.py")
    
    for line in iter(stdout.readline, ""):
        print(line, end="")
        
    for line in iter(stderr.readline, ""):
        print("ERROR:", line, end="")
        
    ssh.close()
    print("Done!")

if __name__ == '__main__':
    run_seed()
