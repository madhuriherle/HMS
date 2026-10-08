import re

file_path = r'D:\python_project\HMS-frontend-main\src\pages\UserManagement.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace handleSaveUser
new_save = '''  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!validateUserForm()) return;

    try {
      const payload = {
        username: formData.username.trim(),
        email: formData.email.trim(),
        mobile: formData.mobile.trim(),
        role_id: Number(formData.roleId),
        full_name: formData.fullName.trim(),
        is_active: typeof formData.status === 'boolean' ? formData.status : (formData.status === 'Active' || formData.status === 'true')
      };

      if (modalMode === 'add') {
        payload.password = formData.password;
        const res = await api.post('/users/', payload);
        setUsers(prev => [res.data, ...prev]);
        showToast('User created successfully.');
      } else {
        const res = await api.put(`/users/${editingUser.id}`, payload);
        setUsers(prev => prev.map(u => (u.id === editingUser.id || String(u.id) === String(editingUser.id)) ? res.data : u));
        
        if (viewingUser && (viewingUser.id === editingUser.id || String(viewingUser.id) === String(editingUser.id))) {
          setViewingUser(res.data);
        }
        showToast('User updated successfully.');
      }
      setIsAddEditOpen(false);
      setFormData({
        fullName: '', username: '', email: '', mobile: '', password: '', confirmPassword: '', roleId: '', status: 'Active'
      });
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error saving user', 'error');
    }
  };'''

content = re.sub(r'  const handleSaveUser = async \(e\) => \{.*?(?=  const handleToggleStatus)', new_save + '\n\n', content, flags=re.DOTALL)

# Replace confirmDelete
new_delete = '''  const confirmDelete = async () => {
    if (!deleteTargetUser) return;
    try {
      await api.delete(`/users/${deleteTargetUser.id}`);
      setUsers(prev => prev.filter(u => u.id !== deleteTargetUser.id && String(u.id) !== String(deleteTargetUser.id)));
      showToast('User deleted successfully.');
      setDeleteTargetUser(null);
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error deleting user', 'error');
    }
  };'''

content = re.sub(r'  const confirmDelete = async \(\) => \{.*?(?=  const handleCancelDelete)', new_delete + '\n\n', content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched successfully!")
