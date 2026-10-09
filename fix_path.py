import re

with open('seed_pincodes.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'csv_path = r\'C:\\Users\\ASPIRE\\Downloads\\All_India_pincode_data.csv\'', 'csv_path = "/app/All_India_pincode_data.csv"', content)

with open('seed_pincodes.py', 'w', encoding='utf-8') as f:
    f.write(content)
