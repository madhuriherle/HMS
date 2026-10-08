import re

file_users = r"D:\python_project\HMS-frontend-main\src\pages\UserManagement.jsx"
with open(file_users, "r", encoding="utf-8") as f:
    content = f.read()

new_user_toggle = '''  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { user, newStatus } = statusDialog;

    try {
      const payload = { status: newStatus };
      const res = await api.put(`/users/${user.id}`, payload);
      
      setUsers(prev => prev.map(u => (u.id === user.id || String(u.id) === String(user.id)) ? { ...u, status: newStatus } : u));
      if (viewingUser && (viewingUser.id === user.id || String(viewingUser.id) === String(user.id))) {
        setViewingUser(prev => ({ ...prev, status: newStatus }));
      }
      showToast('User status updated successfully.');
      setStatusDialog(null);
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error updating status', 'error');
    }
  };'''

content = re.sub(r'  const handleConfirmStatusToggle = \(\) => \{.*?(?=  const handleResetPassword)', new_user_toggle + '\n\n', content, flags=re.DOTALL)

with open(file_users, "w", encoding="utf-8") as f:
    f.write(content)

file_roles = r"D:\python_project\HMS-frontend-main\src\pages\RolesAndPrivileges.jsx"
with open(file_roles, "r", encoding="utf-8") as f:
    content = f.read()

new_role_toggle = '''  const handleConfirmStatusToggle = async () => {
    if (!statusDialog || isSystemRole(statusDialog.role)) return;
    const { role, newStatus } = statusDialog;
    const today = new Date().toISOString().split('T')[0];

    try {
      const payload = { status: newStatus };
      const res = await api.put(`/users/roles/${role.id}`, payload);

      setRoles(prev => prev.map(r => (r.id === role.id || String(r.id) === String(role.id)) ? { ...r, status: newStatus, updatedAt: today } : r));
      if (viewingRole && (viewingRole.id === role.id || String(viewingRole.id) === String(role.id))) {
        setViewingRole(prev => ({ ...prev, status: newStatus, updatedAt: today }));
      }
      showToast(`Role "${role.name}" is now ${newStatus ? 'Active' : 'Inactive'}.`);
      setStatusDialog(null);
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error updating status', 'error');
    }
  };'''

content = re.sub(r'  const handleConfirmStatusToggle = \(\) => \{.*?(?=  const handleSearch)', new_role_toggle + '\n\n', content, flags=re.DOTALL)

with open(file_roles, "w", encoding="utf-8") as f:
    f.write(content)

print("Status toggles patched to hit API!")
