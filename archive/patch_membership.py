import re

file_path = r'D:\python_project\HMS-frontend-main\src\pages\MembershipTypeManagement.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. IMPORTS
content = re.sub(
    r"import\s*\{\s*getStoredMembershipTypes.*?saveStoredMembershipTypes\s*\}\s*from\s*'../utils/receiptStore';",
    "import api from '../api';",
    content,
    flags=re.DOTALL
)

# 2. INITIALIZATION
content = content.replace(
    "const [membershipTypes, setMembershipTypes] = useState(getStoredMembershipTypes());",
    "const [membershipTypes, setMembershipTypes] = useState([]);"
)

# 3. useEffect
fetch_masters = """
  const fetchMembershipTypes = async () => {
    try {
      const res = await api.get('/master-settings/membership/membership-types?limit=1000');
      const mapped = (res.data?.items || []).map(m => ({
        id: m.id,
        name: m.name_en,
        code: m.code,
        currentPrice: m.current_price || 0,
        status: m.status ? 'Active' : 'Inactive',
        effectiveFrom: 'Present',
        priceHistory: [] // Can fetch lazily or in another call
      }));
      setMembershipTypes(mapped);
    } catch (err) {
      console.error(err);
      // alert('Failed to fetch membership types');
    }
  };

  useEffect(() => {
    fetchMembershipTypes();
  }, []);
"""
content = re.sub(
    r"// Master state.*?const \[membershipTypes, setMembershipTypes\] = useState\(\[\]\);",
    "// Master state\n  const [membershipTypes, setMembershipTypes] = useState([]);\n" + fetch_masters,
    content,
    flags=re.DOTALL
)


# 4. handleSaveMembershipType
handle_save_type = r'''  const handleSaveMembershipType = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const amountVal = Number(formData.amount);
      const isActive = formData.status === 'Active';

      if (modalMode === 'add') {
        const typeCode = formData.name.substring(0, 3).toUpperCase() + Date.now().toString().slice(-4);
        const res = await api.post('/master-settings/membership/membership-types', {
          code: typeCode,
          name_en: formData.name,
          status: isActive
        });
        
        await api.post(`/master-settings/membership/membership-types/${res.data.id}/prices`, {
          amount: amountVal,
          effective_from: today,
          change_reason: 'Initial price'
        });
        
        showToast(`Membership Type "${formData.name}" added successfully.`);
      } else {
        await api.put(`/master-settings/membership/membership-types/${editingItem.id}`, {
          name_en: formData.name,
          status: isActive
        });
        
        showToast(`Membership Type "${formData.name}" updated successfully.`);
      }
      setIsAddEditOpen(false);
      fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving membership type', 'error');
    }
  };'''

content = re.sub(r"  const handleSaveMembershipType = \(e\) => \{.*?(?=\n  const handleSavePriceUpdate)", lambda m: handle_save_type + "\n", content, flags=re.DOTALL)

# 5. handleSavePriceUpdate
handle_save_price = r'''  const handleSavePriceUpdate = async (e) => {
    e.preventDefault();
    if (!validatePriceForm()) return;

    try {
      const newPriceVal = Number(priceFormData.newPrice);
      await api.post(`/master-settings/membership/membership-types/${priceTargetItem.id}/prices`, {
        amount: newPriceVal,
        effective_from: priceFormData.effectiveFrom,
        change_reason: priceFormData.reason?.trim() || 'Price revision'
      });
      
      showToast('Price updated successfully.');
      setIsUpdatePriceOpen(false);
      
      if (viewingItem && viewingItem.id === priceTargetItem.id) {
         setViewingItem({ ...viewingItem, currentPrice: newPriceVal });
      }
      
      fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating price', 'error');
    }
  };'''

content = re.sub(r"  const handleSavePriceUpdate = \(e\) => \{.*?(?=\n  const handleConfirmDelete)", lambda m: handle_save_price + "\n", content, flags=re.DOTALL)


# 6. handleConfirmDelete & handleConfirmStatusToggle
new_confirms = r'''  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    try {
      await api.delete(`/master-settings/membership/membership-types/${deletingItem.id}`);
      showToast(`Membership Type "${deletingItem.name}" deleted.`);
      setDeletingItem(null);
      fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting item', 'error');
    }
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { item, newStatus } = statusDialog;
    const isActive = newStatus === 'Active';
    try {
      await api.put(`/master-settings/membership/membership-types/${item.id}`, { status: isActive });
      showToast(`Membership Type "${item.name}" set to ${newStatus}.`);
      setStatusDialog(null);
      fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
  };
  
  // History loader
  const handleOpenHistory = async (item) => {
    try {
      const res = await api.get(`/master-settings/membership/membership-types/${item.id}/prices`);
      const mappedHistory = (res.data || []).map(p => ({
        id: p.id,
        price: p.amount,
        effectiveFrom: p.effective_from,
        effectiveTo: p.effective_to || 'Present',
        reason: p.change_reason || 'N/A'
      }));
      setHistoryTargetItem({ ...item, priceHistory: mappedHistory });
    } catch (err) {
      setHistoryTargetItem({ ...item, priceHistory: [] });
    }
  };
'''

content = re.sub(r"  const handleConfirmDelete = \(\) => \{.*?(?=\n  const showToast =)", lambda m: new_confirms + "\n", content, flags=re.DOTALL)
# wait, handleOpenHistory might override something or I need to adjust it in JSX?
# The JSX uses onClick={() => setHistoryTargetItem(item)}. I will change it to handleOpenHistory(item).
content = content.replace("onClick={() => setHistoryTargetItem(item)}", "onClick={() => handleOpenHistory(item)}")
content = content.replace("onClick={() => setHistoryTargetItem(viewingItem)}", "onClick={() => handleOpenHistory(viewingItem)}")


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied for membership types")
