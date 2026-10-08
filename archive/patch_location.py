import re
import os

file_path = r'D:\python_project\HMS-frontend-main\src\pages\LocationSetup.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
content = re.sub(
    r"import\s*\{\s*getStoredStates.*?saveStoredPostalCodes\s*\}\s*from\s*'../utils/receiptStore';",
    "import api from '../api';",
    content,
    flags=re.DOTALL
)

# 2. States Initialization
content = content.replace("const [states, setStates] = useState(getStoredStates());", "const [states, setStates] = useState([]);")
content = content.replace("const [districts, setDistricts] = useState(getStoredDistricts());", "const [districts, setDistricts] = useState([]);")
content = content.replace("const [taluks, setTaluks] = useState(getStoredTaluks());", "const [taluks, setTaluks] = useState([]);")
content = content.replace("const [postalCodes, setPostalCodes] = useState(getStoredPostalCodes());", "const [postalCodes, setPostalCodes] = useState([]);")

# 3. useEffect and persist helpers
old_use_effect = """  // Reload data from store on initial mount
  useEffect(() => {
    setStates(getStoredStates());
    setDistricts(getStoredDistricts());
    setTaluks(getStoredTaluks());
    setPostalCodes(getStoredPostalCodes());
  }, []);

  // Sync helpers
  const persistStates = (updated) => {
    setStates(updated);
    saveStoredStates(updated);
  };

  const persistDistricts = (updated) => {
    setDistricts(updated);
    saveStoredDistricts(updated);
  };

  const persistTaluks = (updated) => {
    setTaluks(updated);
    saveStoredTaluks(updated);
  };

  const persistPostalCodes = (updated) => {
    setPostalCodes(updated);
    saveStoredPostalCodes(updated);
  };"""

new_use_effect = """  const fetchMasters = async () => {
    try {
      const [stRes, dtRes, tkRes, pcRes] = await Promise.all([
        api.get('/master-settings/geography/states?limit=2000'),
        api.get('/master-settings/geography/districts?limit=2000'),
        api.get('/master-settings/geography/taluks?limit=2000'),
        api.get('/master-settings/geography/postal-codes?limit=2000')
      ]);
      
      const sName = (arr, id) => { const f = arr?.find(x => x.id === id); return f ? f.name_en : ''; };
      const dState = (arr, id) => { const f = arr?.find(x => x.id === id); return f ? f.state_id : ''; };

      const mapState = s => ({ id: s.id, name: s.name_en, status: s.status ? 'Active' : 'Inactive' });
      const mapDist = d => ({ id: d.id, name: d.name_en, stateId: d.state_id, status: d.status ? 'Active' : 'Inactive', stateName: sName(stRes.data?.items, d.state_id) });
      const mapTk = t => ({ id: t.id, name: t.name_en, districtId: t.district_id, stateId: dState(dtRes.data?.items, t.district_id), status: t.status ? 'Active' : 'Inactive', districtName: sName(dtRes.data?.items, t.district_id) });
      const mapPc = p => ({ 
        id: p.id, 
        postalCode: p.pincode, 
        area: p.post_office_name, 
        stateId: p.state_id, 
        districtId: p.district_id, 
        talukId: p.taluk_id, 
        status: p.status ? 'Active' : 'Inactive',
        stateName: sName(stRes.data?.items, p.state_id),
        districtName: sName(dtRes.data?.items, p.district_id),
        talukName: sName(tkRes.data?.items, p.taluk_id)
      });

      setStates((stRes.data?.items || []).map(mapState));
      setDistricts((dtRes.data?.items || []).map(mapDist));
      setTaluks((tkRes.data?.items || []).map(mapTk));
      setPostalCodes((pcRes.data?.items || []).map(mapPc));
    } catch (err) {
      console.error(err);
      // alert('Failed to fetch geography data');
    }
  };

  useEffect(() => {
    fetchMasters();
  }, []);

  const persistStates = () => { fetchMasters(); };
  const persistDistricts = () => { fetchMasters(); };
  const persistTaluks = () => { fetchMasters(); };
  const persistPostalCodes = () => { fetchMasters(); };"""

content = content.replace(old_use_effect, new_use_effect)

# Replace handleSaveDistrict
handle_save_dist = '''  const handleSaveDistrict = async (e) => {
    e.preventDefault();
    const errors = {};
    const trimmedName = districtFormData.name.trim();

    if (!trimmedName) {
      errors.name = 'District name is required';
    }

    if (Object.keys(errors).length > 0) {
      setDistrictFormErrors(errors);
      return;
    }

    const targetState = states.find((s) => s.id === districtFormData.stateId) || currentState;

    try {
      if (districtModalMode === 'add') {
        await api.post('/master-settings/geography/districts', {
          name_en: trimmedName,
          state_id: targetState.id,
          status: districtFormData.status === 'Active'
        });
        showToast(`District "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/master-settings/geography/districts/${editingDistrict.id}`, {
          name_en: trimmedName,
          state_id: targetState.id,
          status: districtFormData.status === 'Active'
        });
        showToast(`District "${trimmedName}" updated successfully.`);
      }
      setIsDistrictModalOpen(false);
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving district', 'error');
    }
  };'''
content = re.sub(r"  const handleSaveDistrict = \(e\) => \{.*?(?=\n  // --- Taluk CRUD Operations ---)", lambda m: handle_save_dist + "\n", content, flags=re.DOTALL)


# Replace handleSaveTaluk
handle_save_taluk = '''  const handleSaveTaluk = async (e) => {
    e.preventDefault();
    const errors = {};
    const trimmedName = talukFormData.name.trim();

    if (!trimmedName) {
      errors.name = 'Taluk name is required';
    } else if (!talukFormData.districtId) {
      errors.districtId = 'Please select a parent district';
    }

    if (Object.keys(errors).length > 0) {
      setTalukFormErrors(errors);
      return;
    }

    const targetDist = districts.find((d) => d.id === talukFormData.districtId);

    try {
      if (talukModalMode === 'add') {
        await api.post('/master-settings/geography/taluks', {
          name_en: trimmedName,
          district_id: targetDist.id,
          status: talukFormData.status === 'Active'
        });
        showToast(`Taluk "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/master-settings/geography/taluks/${editingTaluk.id}`, {
          name_en: trimmedName,
          district_id: targetDist.id,
          status: talukFormData.status === 'Active'
        });
        showToast(`Taluk "${trimmedName}" updated successfully.`);
      }
      setIsTalukModalOpen(false);
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving taluk', 'error');
    }
  };'''
content = re.sub(r"  const handleSaveTaluk = \(e\) => \{.*?(?=\n  // ====================================================)", lambda m: handle_save_taluk + "\n", content, flags=re.DOTALL)

# Replace handleSavePostal
handle_save_postal = r'''  const handleSavePostal = async (e) => {
    e.preventDefault();
    const errors = {};
    const cleanPin = postalFormData.postalCode.trim();
    const cleanArea = postalFormData.area.trim();

    if (!cleanPin) {
      errors.postalCode = 'PIN Code is required';
    } else if (!/^\d{6}$/.test(cleanPin)) {
      errors.postalCode = 'PIN Code must be exactly 6 numeric digits (0-9)';
    }

    if (!cleanArea) {
      errors.area = 'Post Office / Area Name is required';
    }
    if (!postalFormData.stateId) errors.stateId = 'Please select a State';
    if (!postalFormData.districtId) errors.districtId = 'Please select a District';
    if (!postalFormData.talukId) errors.talukId = 'Please select a Taluk';

    if (Object.keys(errors).length > 0) {
      setPostalFormErrors(errors);
      return;
    }

    try {
      if (postalModalMode === 'add') {
        await api.post('/master-settings/geography/postal-codes', {
          pincode: cleanPin,
          post_office_name: cleanArea,
          state_id: postalFormData.stateId,
          district_id: postalFormData.districtId,
          taluk_id: postalFormData.talukId,
          status: postalFormData.status === 'Active'
        });
        showToast(`PIN Code ${cleanPin} (${cleanArea}) added successfully.`);
      } else {
        await api.put(`/master-settings/geography/postal-codes/${editingPostal.id}`, {
          pincode: cleanPin,
          post_office_name: cleanArea,
          state_id: postalFormData.stateId,
          district_id: postalFormData.districtId,
          taluk_id: postalFormData.talukId,
          status: postalFormData.status === 'Active'
        });
        showToast(`PIN Code ${cleanPin} updated successfully.`);
      }
      setIsPostalModalOpen(false);
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving postal code', 'error');
    }
  };'''
content = re.sub(r"  const handleSavePostal = \(e\) => \{.*?(?=\n  // ====================================================\n  // BULK IMPORT LOGIC)", lambda m: handle_save_postal + "\n", content, flags=re.DOTALL)

# Replace handleConfirmStatusToggle & handleConfirmDelete
new_confirm = '''  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { type, item, nextStatus } = statusDialog;
    const isActive = nextStatus === 'Active';

    try {
      if (type === 'state') {
        await api.put(`/master-settings/geography/states/${item.id}`, { status: isActive });
        showToast(`State "${item.name}" set to ${nextStatus}.`);
      } else if (type === 'district') {
        await api.put(`/master-settings/geography/districts/${item.id}`, { status: isActive });
        showToast(`District "${item.name}" set to ${nextStatus}.`);
      } else if (type === 'taluk') {
        await api.put(`/master-settings/geography/taluks/${item.id}`, { status: isActive });
        showToast(`Taluk "${item.name}" set to ${nextStatus}.`);
      } else if (type === 'postal') {
        await api.put(`/master-settings/geography/postal-codes/${item.id}`, { status: isActive });
        showToast(`PIN Code "${item.postalCode}" set to ${nextStatus}.`);
      }
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
    setStatusDialog(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    const { type, item } = deleteDialog;

    try {
      if (type === 'district') {
        await api.delete(`/master-settings/geography/districts/${item.id}`);
        showToast(`District "${item.name}" deleted.`);
      } else if (type === 'taluk') {
        await api.delete(`/master-settings/geography/taluks/${item.id}`);
        showToast(`Taluk "${item.name}" deleted.`);
      } else if (type === 'postal') {
        await api.delete(`/master-settings/geography/postal-codes/${item.id}`);
        showToast(`PIN Code "${item.postalCode}" (${item.area}) removed.`);
      }
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting item', 'error');
    }
    setDeleteDialog(null);
  };'''

content = re.sub(r"  const handleConfirmStatusToggle = \(\) => \{.*?(?=\n    return \(\n      <div className)", lambda m: new_confirm + "\n", content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully.")
