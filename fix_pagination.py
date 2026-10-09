import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('187.127.173.27', username='root', password='D-apps@123456')

# Run sed inside the container
print("Modifying file in container...")
ssh.exec_command('docker exec hms_mma_backend sed -i "s/MAX_PAGE_SIZE = 500/MAX_PAGE_SIZE = 25000/" /app/core/pagination.py')
time.sleep(2)

print("Restarting container...")
ssh.exec_command('docker restart hms_mma_backend')
time.sleep(3)

print("Verifying...")
stdin, stdout, stderr = ssh.exec_command('docker exec hms_mma_backend cat /app/core/pagination.py | grep MAX_PAGE_SIZE')
print("Verification output:", stdout.read().decode())
ssh.close()
