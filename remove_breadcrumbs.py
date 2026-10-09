import os
import re
import glob

# Pattern to find <nav ...> ... </nav> block (usually before an <h1>)
# We will use re.sub with re.DOTALL to remove it.
nav_pattern = re.compile(r'\s*<nav\b[^>]*>.*?</nav>\s*', re.DOTALL)

def remove_breadcrumbs():
    pages_dir = os.path.join('frontend', 'src', 'pages')
    for filepath in glob.glob(os.path.join(pages_dir, '*.jsx')):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check if file has a <nav> tag for breadcrumbs (most do in this project based on our check)
        if '<nav ' in content:
            new_content = nav_pattern.sub('\n', content)
            if new_content != content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Removed breadcrumbs from {filepath}")

if __name__ == '__main__':
    remove_breadcrumbs()
