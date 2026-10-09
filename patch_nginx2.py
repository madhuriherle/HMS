import paramiko
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('187.127.173.27', username='root', password='D-apps@123456')

sftp = ssh.open_sftp()
with sftp.file('/etc/nginx/sites-enabled/anegudde', 'r') as f:
    lines = f.readlines()

out = []
for line in lines:
    out.append(line)
    if 'try_files $uri $uri/ /index.html;' in line:
        out.append('    location ^~ /hms/ {\n')
        out.append('        alias /var/www/html/hms/;\n')
        out.append('        try_files $uri $uri/ /hms/index.html;\n')
        out.append('    }\n')

with sftp.file('/etc/nginx/sites-enabled/anegudde', 'w') as f:
    f.writelines(out)

sftp.close()
ssh.exec_command('systemctl reload nginx')
ssh.close()
print("Done")
