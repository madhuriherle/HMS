import os
import re
import glob

# The regex left behind: `breadcrumb={\n}` or `breadcrumb={\n\n}` etc.
# We want to remove `breadcrumb={\s*}`.
err_pattern = re.compile(r'breadcrumb=\{\s*\}', re.DOTALL)

def fix_syntax_errors():
    pages_dir = os.path.join('frontend', 'src', 'pages')
    for filepath in glob.glob(os.path.join(pages_dir, '*.jsx')):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        new_content = err_pattern.sub('', content)
        if new_content != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Fixed JSX syntax in {filepath}")

if __name__ == '__main__':
    fix_syntax_errors()
