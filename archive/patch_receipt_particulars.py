import re

frontend_file = r"D:\python_project\HMS-frontend-main\src\pages\ReceiptTypeManagement.jsx"
with open(frontend_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace '/service-types' with '/particulars'
content = content.replace('/service-types', '/particulars')

with open(frontend_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("ReceiptTypeManagement patched for particulars API.")
