import paramiko
import sys

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname, username=username, password=password)

stdin, stdout, stderr = ssh.exec_command("grep -R 'root ' /etc/nginx/")
print(stdout.read().decode())
print("---")
stdin, stdout, stderr = ssh.exec_command("cat /etc/nginx/sites-enabled/*")
print(stdout.read().decode())

ssh.close()
