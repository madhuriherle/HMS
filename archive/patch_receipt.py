import re

file_path = r'D:\python_project\HMS-frontend-main\src\pages\ReceiptTypeManagement.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. IMPORTS
content = re.sub(
    r"import\s*\{\s*getStoredParticulars.*?\s*\}\s*from\s*'../utils/receiptStore';",
    "import api from '../api';",
    content,
    flags=re.DOTALL
)

# 2. INITIALIZATION
content = content.replace(
    "const [receiptTypes, setReceiptTypes] = useState(getStoredParticulars());",
    "const [receiptTypes, setReceiptTypes] = useState([]);"
)

# 3. useEffect
fetch_receipts = """
  const fetchReceiptTypes = async () => {
    try {
      const res = await api.get('/master-settings/finance/service-types?limit=2000');
      const allItems = res.data?.items || [];
      const parents = allItems.filter(i => !i.parent_id);
      
      const mapped = parents.map(p => {
        const subs = allItems.filter(i => i.parent_id === p.id).map(s => ({
          id: s.id,
          name: s.name_en,
          status: s.status ? 'Active' : 'Inactive'
        }));
        return {
          id: p.id,
          name: p.name_en,
          status: p.status ? 'Active' : 'Inactive',
          subTypes: subs
        };
      });
      setReceiptTypes(mapped);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchReceiptTypes();
  }, []);
"""
content = re.sub(
    r"  useEffect\(\(\) => \{\s*setReceiptTypes\(getStoredParticulars\(\)\);\s*\}, \[\]\);",
    fetch_receipts,
    content,
    flags=re.DOTALL
)

# Remove persistReceiptTypes
content = re.sub(r"  const persistReceiptTypes = \(updatedList\) => \{.*?\};\n", "", content, flags=re.DOTALL)

# 4. handleSaveType
handle_save_type = r'''  const handleSaveType = async (e) => {
    e.preventDefault();
    if (!validateTypeForm()) return;

    const trimmedName = typeFormData.name.trim();
    const isActive = typeFormData.status === 'Active';

    try {
      if (typeModalMode === 'add') {
        const typeCode = trimmedName.substring(0,3).toUpperCase() + Date.now().toString().slice(-4);
        await api.post('/master-settings/finance/service-types', {
          code: typeCode,
          name_en: trimmedName,
          status: isActive
        });
        showToast(`Particular "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/master-settings/finance/service-types/${editingType.id}`, {
          name_en: trimmedName,
          status: isActive
        });
        showToast(`Particular "${trimmedName}" updated successfully.`);
      }
      setIsTypeModalOpen(false);
      fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving particular', 'error');
    }
  };'''

content = re.sub(r"  const handleSaveType = \(e\) => \{.*?(?=\n  // ----------------------------------------------------\n  // SUB-TYPE ADD / EDIT HANDLERS)", lambda m: handle_save_type + "\n", content, flags=re.DOTALL)

# 5. handleSaveSubType
handle_save_subtype = r'''  const handleSaveSubType = async (e) => {
    e.preventDefault();
    if (!validateSubTypeForm()) return;

    const trimmedName = subTypeFormData.name.trim();
    const parentId = parentTypeForSubType.id;
    const isActive = subTypeFormData.status === 'Active';

    try {
      if (subTypeModalMode === 'add') {
        const typeCode = trimmedName.substring(0,3).toUpperCase() + Date.now().toString().slice(-4);
        await api.post('/master-settings/finance/service-types', {
          code: typeCode,
          name_en: trimmedName,
          parent_id: parentId,
          status: isActive
        });
        showToast(`Sub-Type "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/master-settings/finance/service-types/${editingSubType.id}`, {
          name_en: trimmedName,
          status: isActive
        });
        showToast(`Sub-Type "${trimmedName}" updated successfully.`);
      }
      setIsSubTypeModalOpen(false);
      fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving sub-type', 'error');
    }
  };'''

content = re.sub(r"  const handleSaveSubType = \(e\) => \{.*?(?=\n  // ----------------------------------------------------\n  // DELETE & STATUS TOGGLE HANDLERS)", lambda m: handle_save_subtype + "\n", content, flags=re.DOTALL)

# 6. handleConfirmDelete & handleConfirmStatusToggle
new_confirms = r'''  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    const { targetType, item, parentType } = deletingItem;

    try {
      await api.delete(`/master-settings/finance/service-types/${item.id}`);
      if (targetType === 'receiptType') {
        showToast(`Particular "${item.name}" deleted.`);
      } else {
        showToast(`Sub-Type "${item.name}" deleted from "${parentType.name}".`);
      }
      setDeletingItem(null);
      fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting item', 'error');
    }
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { targetType, item, parentType, newStatus } = statusDialog;
    const isActive = newStatus === 'Active';

    try {
      await api.put(`/master-settings/finance/service-types/${item.id}`, { status: isActive });
      if (targetType === 'receiptType') {
        showToast(`Particular "${item.name}" set to ${newStatus}.`);
      } else {
        showToast(`Sub-Type "${item.name}" under "${parentType.name}" set to ${newStatus}.`);
      }
      setStatusDialog(null);
      fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
  };'''

content = re.sub(r"  const handleConfirmDelete = \(\) => \{.*?(?=\n  // ----------------------------------------------------\n  // RENDER HELPERS)", lambda m: new_confirms + "\n", content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied for receipt types")
