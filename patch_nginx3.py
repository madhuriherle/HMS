import paramiko
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('187.127.173.27', username='root', password='D-apps@123456')

sftp = ssh.open_sftp()
with sftp.file('/etc/nginx/sites-enabled/anegudde', 'r') as f:
    lines = f.readlines()

out = []
skip = False
for line in lines:
    if 'location ^~ /hms/ {' in line:
        skip = True
    if skip:
        if '}' in line:
            skip = False
        continue
    
    out.append(line)
    
    if 'location / {' in line:
        # We will insert it BEFORE location /
        out.pop() # remove location /
        out.append('    location ^~ /hms/ {\n')
        out.append('        alias /var/www/html/hms/;\n')
        out.append('        try_files $uri $uri/ /hms/index.html;\n')
        out.append('    }\n\n')
        out.append(line) # put location / back

with sftp.file('/etc/nginx/sites-enabled/anegudde', 'w') as f:
    f.writelines(out)

sftp.close()
ssh.exec_command('systemctl reload nginx')
ssh.close()
print("Done")
