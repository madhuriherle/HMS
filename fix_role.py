import paramiko

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

seed_script = """
import sys
from db.session import SessionLocal
from models.users import User, Role

db = SessionLocal()
try:
    role = db.query(Role).filter(Role.code == 'SUPERADMIN').first()
    u = db.query(User).filter(User.username == 'hmsuser').first()
    if u and role:
        u.role_id = role.id
        db.commit()
        print(f"Assigned role {role.code} (id {role.id}) to user {u.username}")
    else:
        print("User or role not found!")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
"""

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname, username=username, password=password)

stdin, stdout, stderr = ssh.exec_command("docker exec -i hms_mma_backend python -")
stdin.write(seed_script)
stdin.close()

print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
