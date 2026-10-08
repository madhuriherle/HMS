import re
import os

file_path = r"D:\python_project\HMS-frontend-main\src\pages\RolesAndPrivileges.jsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update View Details click handler
new_view_click = '''                            <button
                              onClick={async () => {
                                try {
                                  const res = await api.get(`/users/roles/${role.id}`);
                                  setViewingRole(res.data);
                                } catch (err) {
                                  showToast('Failed to fetch role details', 'error');
                                }
                              }}
                              className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg border border-transparent 
hover:border-[#E8DFD8] transition-all cursor-pointer"
                              title="View Details"
                            >'''

content = re.sub(r'                            <button\s*onClick=\{.*?setViewingRole\(role\)\}\s*className="p-1\.5 text-\[#863221\] hover:text-\[#510601\] hover:bg-\[#FAF7F2\] rounded-lg border border-transparent \s*hover:border-\[#E8DFD8\] transition-all cursor-pointer"\s*title="View Details"\s*>', new_view_click, content, flags=re.DOTALL)

# 2. Update openPrivilegeModal
new_open_priv = '''  const openPrivilegeModal = async (role) => {
    try {
      const res = await api.get(`/users/roles/${role.id}`);
      const fullRole = res.data;
      setPrivilegeTargetRole(fullRole);
      
      if (fullRole.code === 'SUPERADMIN' || fullRole.is_all_access) {
        setSelectedPrivileges([...allPrivilegeIds]);
      } else {
        const initialCodes = fullRole.permission_codes || [];
        setSelectedPrivileges([...initialCodes]);
      }
      setPrivilegeSearch('');
    } catch (err) {
      showToast('Failed to fetch role privileges', 'error');
    }
  };'''

content = re.sub(r'  const openPrivilegeModal = \(role\) => \{.*?(?=  const handleTogglePrivilege)', new_open_priv + '\n\n', content, flags=re.DOTALL)


# 3. Update the viewingRole renderer to correctly show user count and privileges count
new_users_count = '''<p className="text-base font-bold text-[#180200] mt-0.5">{viewingRole.user_count || 0} Users</p>'''
content = re.sub(r'<p className="text-base font-bold text-\[#180200\] mt-0\.5">\{viewingRole\.usersCount\} Users</p>', new_users_count, content)

new_priv_count = '''<p className="text-base font-bold text-[#510601] mt-0.5">
                      {viewingRole.permission_codes ? viewingRole.permission_codes.length : 0} of {allPrivilegeIds.length}
                    </p>'''
content = re.sub(r'<p className="text-base font-bold text-\[#510601\] mt-0\.5">\s*\{viewingRole\.privileges \? viewingRole\.privileges\.length : 0\} of \{allPrivilegeIds\.length\}\s*</p>', new_priv_count, content)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Side panel & privilege open integration fixed!")
