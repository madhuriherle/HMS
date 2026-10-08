import os
import re

files = [
    r"D:\python_project\HMS-frontend-main\src\pages\RolesAndPrivileges.jsx",
    r"D:\python_project\HMS-frontend-main\src\pages\UserManagement.jsx"
]

for file_path in files:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    content = content.replace("/system/roles", "/users/roles")

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

print("Fixed API endpoints for Users & Roles!")
