import re

file_users = r"D:\python_project\HMS-frontend-main\src\pages\UserManagement.jsx"
with open(file_users, "r", encoding="utf-8") as f:
    content = f.read()

new_payload = '''      const payload = {
        name: formData.fullName.trim(),
        username: formData.username.trim(),
        email: formData.email.trim(),
        mobile: formData.mobile.trim(),
        mobile_country_code: '+91',
        role_id: Number(formData.roleId),
        status: typeof formData.status === 'boolean' ? formData.status : (formData.status === 'Active' || formData.status === 'true')
      };
      if (formData.password) {
        payload.password = formData.password;
      }'''

content = re.sub(r'      const payload = \{.*?\n      \};', new_payload, content, flags=re.DOTALL)

with open(file_users, "w", encoding="utf-8") as f:
    f.write(content)

print("Added password to payload!")
