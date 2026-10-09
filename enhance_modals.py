import os
import glob

def enhance_modals():
    pages_dir = os.path.join('frontend', 'src', 'pages')
    
    for filepath in glob.glob(os.path.join(pages_dir, '*.jsx')):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        
        # We REMOVED the widen modals logic here to keep original widths!
        
        # 2. Fix footers
        # Common right-aligned footers
        content = content.replace(
            'className="flex items-center justify-end gap-3 pt-4 border-t border-[#E8DFD8]"',
            'className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl"'
        )
        content = content.replace(
            'className="pt-4 border-t border-[#E8DFD8] flex items-center justify-end gap-2.5 shrink-0"',
            'className="px-6 py-4 border-t border-[#E8DFD8] flex items-center justify-end gap-2.5 shrink-0 bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl"'
        )
        
        # Common between-aligned footers (like import modal)
        content = content.replace(
            'className="flex items-center justify-between pt-4 border-t border-[#E8DFD8]"',
            'className="flex items-center justify-between px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl"'
        )

        if content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Updated modals in {filepath}")

if __name__ == '__main__':
    enhance_modals()
