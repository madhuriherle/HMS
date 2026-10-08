import re

frontend_file = r"D:\python_project\HMS-frontend-main\src\pages\ReceiptTypeManagement.jsx"
with open(frontend_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Revert '/particulars' back to '/service-types'
content = content.replace('/particulars', '/service-types')

with open(frontend_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("ReceiptTypeManagement reverted.")
