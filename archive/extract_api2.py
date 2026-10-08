import os, re
frontend_dir = r'D:\python_project\HMS-frontend-main\src'
for root, dirs, files in os.walk(frontend_dir):
    for file in files:
        if file.endswith(('.jsx', '.js')):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                found = []
                for i, line in enumerate(lines):
                    if 'axios.' in line or 'fetch(' in line or 'http://' in line or '/api/' in line:
                        found.append(f"{i+1}: {line.strip()}")
                if found:
                    rel_path = os.path.relpath(path, frontend_dir)
                    print(f'\n--- {rel_path} ---')
                    for f in found:
                        print(f)
