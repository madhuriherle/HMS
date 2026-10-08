import re

frontend_path = r"D:\python_project\HMS-frontend-main\src\pages\OrganisationSettings.jsx"
with open(frontend_path, "r", encoding="utf-8") as f:
    content = f.read()

# Remove fetch logic
content = re.sub(r'  useEffect\(\(\) => \{\n    const fetchSettings[\s\S]*?fetchSettings\(\);\n  \}, \[\]\);\n', '', content)
content = content.replace("import api from '../api';\n", "")
content = content.replace("import api from '../api';", "")

# Revert handleSave
orig_save_logic = """
    const success = saveStoredOrganisationSettings(payload);
    if (success) {
      setSavedSettingsSnapshot(payload);
      setSettings(payload);
      setIsDirty(false);
      showToast('Organisation settings updated successfully.');
    } else {
      showToast('Failed to save settings to local storage.', 'error');
    }
"""

content = re.sub(r'    // API Sync[\s\S]*?showToast\(\'Failed to save settings to API.\', \'error\'\);\n      \}\);', orig_save_logic.strip(), content)

with open(frontend_path, "w", encoding="utf-8") as f:
    f.write(content)

print("OrganisationSettings reverted.")
