import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('187.127.173.27', username='root', password='D-apps@123456')

sftp = client.open_sftp()
with sftp.file('/tmp/script.py', 'w') as f:
    f.write('''
import requests
res = requests.post("http://187.127.173.27/hmsmma/api/v1/auth/login", data={"username": "admin", "password": "password"})
token = res.json()["access_token"]
res2 = requests.get("http://187.127.173.27/hmsmma/api/v1/masters/postal-codes?limit=20000", headers={"Authorization": f"Bearer "+token})
data = res2.json()
print("Total in DB according to API:", data.get("total"))
print("Rows returned:", len(data.get("data", [])))
''')
sftp.close()

stdin, stdout, stderr = client.exec_command('python3 /tmp/script.py')
print(stdout.read().decode())
print(stderr.read().decode())
client.close()
