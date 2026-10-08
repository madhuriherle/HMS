import re
import os

file_path = r"D:\python_project\HMS-frontend-main\src\pages\RolesAndPrivileges.jsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

new_save_priv = '''  const handleSavePrivileges = async () => {
    if (!privilegeTargetRole) return;
    try {
      const res = await api.put(`/users/roles/${privilegeTargetRole.id}/permissions`, {
        permission_codes: selectedPrivileges,
        approval_required_codes: []
      });

      setRoles(prev => prev.map(r => (r.id === privilegeTargetRole.id || String(r.id) === String(privilegeTargetRole.id)) ? {
        ...r,
        permission_codes: res.data.permission_codes || selectedPrivileges,
        privileges: res.data.permission_codes || selectedPrivileges,
      } : r));

      showToast('Privileges updated successfully.');
      setPrivilegeTargetRole(null);
      setSelectedPrivileges([]);
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error saving privileges', 'error');
    }
  };'''

content = re.sub(r'  const handleSavePrivileges = async \(\) => \{.*?(?=  const handleCancelPrivileges)', new_save_priv + '\n\n', content, flags=re.DOTALL)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("RolesAndPrivileges privileges save patched!")
