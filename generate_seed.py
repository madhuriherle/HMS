import csv
import io

input_file = r'C:\Users\ASPIRE\Downloads\All_India_pincode_data.csv'
output_file = 'seed_kerala_karnataka.sql'

target_states = ['KARNATAKA', 'KERALA']

states = {}
districts = {}
taluks = {}
postal_codes = []

with open(input_file, mode='r', encoding='iso-8859-1') as f:
    reader = csv.DictReader(f)
    for row in reader:
        state = row['statename'].strip().upper()
        if state not in target_states:
            continue
            
        district = row['districtname'].strip().upper()
        taluk = row['taluk'].strip().upper()
        pincode = row['pincode'].strip()
        officename = row['officename'].strip()
        
        # We need to build unique lists
        if state not in states:
            states[state] = len(states) + 1
            
        dist_key = f"{state}|{district}"
        if dist_key not in districts:
            districts[dist_key] = len(districts) + 1
            
        taluk_key = f"{state}|{district}|{taluk}"
        if taluk_key not in taluks:
            taluks[taluk_key] = len(taluks) + 1
            
        # Pincode uniqueness?
        # A pincode can have multiple post offices. 
        # But for hms_mma, PostalCode model has pincode, post_office_name, state_id, district_id, taluk_id
        postal_codes.append({
            'pincode': pincode,
            'post_office_name': officename,
            'state_id': states[state],
            'district_id': districts[dist_key],
            'taluk_id': taluks[taluk_key]
        })

with open(output_file, 'w', encoding='iso-8859-1') as out:
    out.write("BEGIN;\n")
    
    out.write("DELETE FROM postal_codes;\n")
    out.write("DELETE FROM taluks;\n")
    out.write("DELETE FROM districts;\n")
    out.write("DELETE FROM states;\n")
    
    # Insert states
    for state, state_id in states.items():
        # name_en, name_kn, code, country_code, status
        out.write(f"INSERT INTO states (id, name_en, name_kn, code, country_code, status, is_deleted, created_at, updated_at) VALUES ({state_id}, '{state.replace(chr(39), '')}', NULL, '{state[:3]}', 'IND', true, false, NOW(), NOW());\n")
        
    # Insert districts
    for dist_key, dist_id in districts.items():
        state, district = dist_key.split('|')
        state_id = states[state]
        out.write(f"INSERT INTO districts (id, state_id, name_en, name_kn, code, status, is_deleted, created_at, updated_at) VALUES ({dist_id}, {state_id}, '{district.replace(chr(39), '')}', NULL, '{district[:3]}', true, false, NOW(), NOW());\n")
        
    # Insert taluks
    for taluk_key, taluk_id in taluks.items():
        state, district, taluk = taluk_key.split('|')
        dist_id = districts[f"{state}|{district}"]
        out.write(f"INSERT INTO taluks (id, district_id, name_en, name_kn, status, is_deleted, created_at, updated_at) VALUES ({taluk_id}, {dist_id}, '{taluk.replace(chr(39), '')}', NULL, true, false, NOW(), NOW());\n")
        
    # Insert postal_codes
    # Some pincodes might have apostrophes in post_office_name
    pc_id = 1
    for pc in postal_codes:
        po_name = pc['post_office_name'].replace(chr(39), "''")
        out.write(f"INSERT INTO postal_codes (id, pincode, post_office_name, state_id, district_id, taluk_id, status, is_deleted, created_at, updated_at) VALUES ({pc_id}, '{pc['pincode']}', '{po_name}', {pc['state_id']}, {pc['district_id']}, {pc['taluk_id']}, true, false, NOW(), NOW());\n")
        pc_id += 1

    # Rows above use explicit ids, so advance each id sequence past them;
    # otherwise the next UI insert reuses id 1 and fails with a duplicate key.
    for table in ("states", "districts", "taluks", "postal_codes"):
        out.write(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM {table}));\n")

    out.write("COMMIT;\n")

print(f"Generated {output_file} successfully.")
print(f"States: {len(states)}")
print(f"Districts: {len(districts)}")
print(f"Taluks: {len(taluks)}")
print(f"Postal Codes: {len(postal_codes)}")
