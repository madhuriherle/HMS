import os
import re
import glob

# Find </h1> followed by a <p> element, optionally with spaces/newlines in between
subtitle_pattern = re.compile(r'(</h1>)\s*<p[^>]*>.*?</p>', re.DOTALL)

def remove_subtitles():
    pages_dir = os.path.join('frontend', 'src', 'pages')
    for filepath in glob.glob(os.path.join(pages_dir, '*.jsx')):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        new_content = subtitle_pattern.sub(r'\1', content)
        if new_content != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Removed subtitle from {filepath}")

if __name__ == '__main__':
    remove_subtitles()
