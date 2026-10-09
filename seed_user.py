import paramiko

hostname = "187.127.173.27"
username = "root"
password = "D-apps@123456"

seed_script = """
import sys
from db.session import SessionLocal
from models.users import User
from core.security import get_password_hash

db = SessionLocal()
try:
    u = db.query(User).filter(User.username == 'hmsuser').first()
    if not u:
        u = User(
            username='hmsuser',
            email='hms@example.com',
            name='HMS Admin',
            password_hash=get_password_hash('Hms@2026'),
            user_type='SUPERADMIN',
            status=True
        )
        db.add(u)
        print("Created new user: hmsuser")
    else:
        u.password_hash = get_password_hash('Hms@2026')
        u.user_type = 'SUPERADMIN'
        u.status = True
        print("Updated existing user: hmsuser")
    db.commit()
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
