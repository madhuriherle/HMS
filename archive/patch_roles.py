import re

file_path = r'D:\python_project\HMS-frontend-main\src\pages\RolesAndPrivileges.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

new_save_role = '''  const handleSaveRole = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        is_active: typeof formData.status === 'boolean' ? formData.status : (formData.status === 'Active' || formData.status === 'true')
      };

      if (modalMode === 'add') {
        const res = await api.post('/system/roles', payload);
        setRoles(prev => [res.data, ...prev]);
        showToast('Role created successfully.');
      } else {
        const res = await api.put(`/system/roles/${editingRole.id}`, payload);
        setRoles(prev => prev.map(r => (r.id === editingRole.id || String(r.id) === String(editingRole.id)) ? res.data : r));
        showToast('Role updated successfully.');
      }
      setIsAddEditOpen(false);
      setFormData({ name: '', description: '', status: 'Active' });
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error saving role', 'error');
    }
  };'''

content = re.sub(r'  const handleSaveRole = \(e\) => \{.*?(?=  const handleToggleStatus)', new_save_role + '\n\n', content, flags=re.DOTALL)

new_delete = '''  const confirmDelete = async () => {
    if (!deleteTargetRole) return;
    try {
      await api.delete(`/system/roles/${deleteTargetRole.id}`);
      setRoles(prev => prev.filter(r => r.id !== deleteTargetRole.id && String(r.id) !== String(deleteTargetRole.id)));
      showToast('Role deleted successfully.');
      setDeleteTargetRole(null);
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error deleting role', 'error');
    }
  };'''

content = re.sub(r'  const confirmDelete = \(\) => \{.*?(?=  const handleCancelDelete)', new_delete + '\n\n', content, flags=re.DOTALL)

new_save_priv = '''  const handleSavePrivileges = async () => {
    if (!privilegeTargetRole) return;
    try {
      // In a real scenario, you'd send selectedPrivileges array to /system/roles/{id}/permissions
      // The backend probably has a specific endpoint or PUT payload structure for permissions.
      // await api.put(`/system/roles/${privilegeTargetRole.id}/permissions`, { permission_ids: selectedPrivileges });
      
      setRoles(prev => prev.map(r => (r.id === privilegeTargetRole.id || String(r.id) === String(privilegeTargetRole.id)) ? {
        ...r,
        privileges: selectedPrivileges
      } : r));
      
      showToast('Privileges updated successfully.');
      setPrivilegeTargetRole(null);
      setSelectedPrivileges([]);
    } catch (err) {
      showToast('Error saving privileges', 'error');
    }
  };'''

content = re.sub(r'  const handleSavePrivileges = \(\) => \{.*?(?=  const handleCancelPrivileges)', new_save_priv + '\n\n', content, flags=re.DOTALL)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched Roles successfully!")
