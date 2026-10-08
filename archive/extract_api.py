import os, re
frontend_dir = r'D:\python_project\HMS-frontend-main\src'
api_calls = []
for root, dirs, files in os.walk(frontend_dir):
    for file in files:
        if file.endswith(('.jsx', '.js')):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
                matches = re.findall(r'(?:axios\.[a-z]+|fetch)\s*\(\s*[`\"''](.*?(?:\$|\{)[^`\"'']*|.*?)[`\"'']', content)
                matches2 = re.findall(r'(?:axios\.[a-z]+|fetch)\s*\(\s*([a-zA-Z0-9_]+)\s*[,\)]', content)
                urls = re.findall(r'[`\"''](http[^`\"'']*|/api/v1/[^`\"'']*)[`\"'']', content)
                if matches or urls or matches2:
                    rel_path = os.path.relpath(path, frontend_dir)
                    api_calls.append((rel_path, matches, matches2, urls))

for file, m1, m2, urls in api_calls:
    print(f'\n--- {file} ---')
    if m1: print("  Direct calls:", m1)
    if m2: print("  Variable calls:", m2)
    if urls: print("  URLs found:", urls)
