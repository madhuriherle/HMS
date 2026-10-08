import re

file_path = r"D:\python_project\HMS-frontend-main\src\pages\RolesAndPrivileges.jsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Remove static imports
content = content.replace("import { allPrivileges, allPrivilegeIds, initialRoles } from '../data/rolesData';", "import { initialRoles } from '../data/rolesData';")

# Add state variables
state_vars = """
  const [allPrivileges, setAllPrivileges] = useState([]);
  const [allPrivilegeIds, setAllPrivilegeIds] = useState([]);
"""
content = content.replace("const [systemPrivileges, setSystemPrivileges] = useState([]);", state_vars)

# Update useEffect
new_use_effect = """  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const rolesRes = await api.get('/users/roles');
        setRoles(rolesRes.data);
        
        const privRes = await api.get('/users/modules/privilege-tree');
        let formattedGroups = [];
        let allIds = [];

        const traverse = (modList, path = "") => {
           for (const mod of modList) {
              const currentPath = path ? `${path} > ${mod.name}` : mod.name;
              if (mod.privileges && mod.privileges.length > 0) {
                 const formattedPrivs = mod.privileges.map(p => ({
                    id: p.code, // using code as id for frontend
                    name: p.name,
                    description: p.description
                 }));
                 formattedGroups.push({
                    module: currentPath,
                    privileges: formattedPrivs
                 });
                 allIds.push(...formattedPrivs.map(p => p.id));
              }
              if (mod.submodules && mod.submodules.length > 0) {
                 traverse(mod.submodules, currentPath);
              }
           }
        };
        
        traverse(privRes.data);
        setAllPrivileges(formattedGroups);
        setAllPrivilegeIds(allIds);

      } catch (err) {
        console.error("Error fetching data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);"""

content = re.sub(r'  React\.useEffect\(\(\) => \{[\s\S]*?fetchRoles\(\);\n  \}, \[\]\);', new_use_effect, content)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("RolesAndPrivileges dynamic privileges patched!")
