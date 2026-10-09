import sys
import os
sys.path.append(os.path.abspath('backend'))

import csv
from sqlalchemy.orm import Session
from db.session import SessionLocal
from models.masters import State, District, Taluk, PostalCode

def seed_pincodes(csv_path):
    db: Session = SessionLocal()
    
    target_states = {"KARNATAKA", "KERALA"}
    
    state_cache = {}
    district_cache = {}
    taluk_cache = {}
    
    # Pre-fetch existing states, districts, taluks
    for s in db.query(State).all():
        state_cache[s.name_en.upper()] = s.id
        
    for d in db.query(District).all():
        district_cache[(d.state_id, d.name_en.upper())] = d.id
        
    for t in db.query(Taluk).all():
        taluk_cache[(t.district_id, t.name_en.upper())] = t.id
        
    existing_pincodes = set()
    for p in db.query(PostalCode.pincode, PostalCode.post_office_name).all():
        existing_pincodes.add((p.pincode, p.post_office_name.upper() if p.post_office_name else ""))
        
    print(f"Loaded {len(state_cache)} states, {len(district_cache)} districts, {len(taluk_cache)} taluks, {len(existing_pincodes)} pincodes.")
    
    to_add_states = {}
    to_add_districts = {}
    to_add_taluks = {}
    
    added_count = 0
    
    with open(csv_path, 'r', encoding='latin-1') as f:
        reader = csv.DictReader(f)
        batch = []
        for row in reader:
            state_name = row['statename'].strip().upper()
            if state_name not in target_states:
                continue
                
            dist_name = row['districtname'].strip().upper()
            taluk_name = row['taluk'].strip().upper()
            if not taluk_name or taluk_name.lower() == 'na':
                taluk_name = dist_name
                
            pincode = row['pincode'].strip()
            office_name = row['officename'].strip()
            
            # 1. State
            if state_name not in state_cache:
                s = State(name_en=state_name, created_by=1)
                db.add(s)
                db.flush()
                state_cache[state_name] = s.id
            state_id = state_cache[state_name]
            
            # 2. District
            dist_key = (state_id, dist_name)
            if dist_key not in district_cache:
                d = District(state_id=state_id, name_en=dist_name, created_by=1)
                db.add(d)
                db.flush()
                district_cache[dist_key] = d.id
            dist_id = district_cache[dist_key]
            
            # 3. Taluk
            taluk_key = (dist_id, taluk_name)
            if taluk_key not in taluk_cache:
                t = Taluk(district_id=dist_id, name_en=taluk_name, created_by=1)
                db.add(t)
                db.flush()
                taluk_cache[taluk_key] = t.id
            taluk_id = taluk_cache[taluk_key]
            
            # 4. Postal Code
            pc_key = (pincode, office_name.upper())
            if pc_key not in existing_pincodes:
                pc = PostalCode(
                    pincode=pincode,
                    post_office_name=office_name,
                    state_id=state_id,
                    district_id=dist_id,
                    taluk_id=taluk_id,
                    created_by=1
                )
                db.add(pc)
                existing_pincodes.add(pc_key)
                added_count += 1
                
            if added_count > 0 and added_count % 1000 == 0:
                db.commit()
                print(f"Added {added_count} pincodes...")
                
    db.commit()
    print(f"Done! Total pincodes added: {added_count}")
    
if __name__ == '__main__':
    csv_path = "/app/All_India_pincode_data.csv"
    seed_pincodes(csv_path)
