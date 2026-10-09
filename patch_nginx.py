import paramiko

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname, username=username, password=password)

script = """
with open('/etc/nginx/sites-enabled/anegudde', 'r') as f:
    lines = f.readlines()

out = []
for line in lines:
    out.append(line)
    if 'try_files $uri $uri/ /index.html;' in line:
        out.append('\\n    # HMS Frontend\\n')
        out.append('    location ^~ /hms/ {\\n')
        out.append('        alias /var/www/html/hms/;\\n')
        out.append('        try_files $uri $uri/ /hms/index.html;\\n')
        out.append('        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";\\n')
        out.append('    }\\n')

with open('/etc/nginx/sites-enabled/anegudde', 'w') as f:
    f.writelines(out)
"""

stdin, stdout, stderr = ssh.exec_command(f"python3 -c \"{script}\"")
print(stderr.read().decode())
ssh.exec_command("systemctl reload nginx")
ssh.close()
