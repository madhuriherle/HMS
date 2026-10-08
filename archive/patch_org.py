import re
import os

frontend_path = r"D:\python_project\HMS-frontend-main\src\pages\OrganisationSettings.jsx"
with open(frontend_path, "r", encoding="utf-8") as f:
    content = f.read()

# Add imports for api
if "import api " not in content and "import api from" not in content:
    content = content.replace("import { Link } from 'react-router-dom';", "import { Link } from 'react-router-dom';\nimport api from '../api';")

# Add fetch logic in useEffect
fetch_logic = """
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await api.get('/system/settings');
        if (response.data && response.data.data) {
          const apiData = response.data.data;
          
          setSettings(prev => {
            const next = {
              ...prev,
              profile: {
                ...prev.profile,
                organisationName: apiData.name_en || prev.profile.organisationName,
                registrationNumber: apiData.registration_no || prev.profile.registrationNumber,
                website: apiData.website || prev.profile.website,
                addressLine1: apiData.address_en || prev.profile.addressLine1
              },
              contact: {
                ...prev.contact,
                email: apiData.email || prev.contact.email,
                contactNumber: apiData.mobile || prev.contact.contactNumber,
                alternateContactNumber: apiData.phone || prev.contact.alternateContactNumber
              },
              printHeaders: {
                ...prev.printHeaders,
                showLogo: apiData.print_header_enabled !== null ? apiData.print_header_enabled : prev.printHeaders.showLogo,
                footerText: apiData.receipt_footer_note_en || prev.printHeaders.footerText,
                presidentTitleEn: apiData.president_title_en || prev.printHeaders.presidentTitleEn,
                secretaryTitleEn: apiData.secretary_title_en || prev.printHeaders.secretaryTitleEn,
                treasurerTitleEn: apiData.treasurer_title_en || prev.printHeaders.treasurerTitleEn,
                payModeCashEn: apiData.pay_mode_cash_en || prev.printHeaders.payModeCashEn,
                payModeChequeEn: apiData.pay_mode_cheque_en || prev.printHeaders.payModeChequeEn,
                payModeDdEn: apiData.pay_mode_dd_en || prev.printHeaders.payModeDdEn,
                payModeUpiEn: apiData.pay_mode_upi_en || prev.printHeaders.payModeUpiEn
              },
              notifications: {
                ...prev.notifications,
                enableNotifications: apiData.notify_email_enabled !== null ? apiData.notify_email_enabled : prev.notifications.enableNotifications
              }
            };
            setSavedSettingsSnapshot(next);
            return next;
          });
        }
      } catch (err) {
        console.error("Failed to load settings from API", err);
      }
    };
    fetchSettings();
  }, []);
"""

if "const fetchSettings = async" not in content:
    content = content.replace("const fileInputRef = useRef(null);", "const fileInputRef = useRef(null);\n" + fetch_logic)


# Update handleSave
save_logic = """
    // API Sync
    const apiPayload = {
      name_en: payload.profile.organisationName,
      registration_no: payload.profile.registrationNumber,
      website: payload.profile.website,
      address_en: payload.profile.addressLine1,
      email: payload.contact.email,
      mobile: payload.contact.contactNumber,
      phone: payload.contact.alternateContactNumber,
      print_header_enabled: payload.printHeaders.showLogo,
      receipt_footer_note_en: payload.printHeaders.footerText,
      president_title_en: payload.printHeaders.presidentTitleEn,
      secretary_title_en: payload.printHeaders.secretaryTitleEn,
      treasurer_title_en: payload.printHeaders.treasurerTitleEn,
      pay_mode_cash_en: payload.printHeaders.payModeCashEn,
      pay_mode_cheque_en: payload.printHeaders.payModeChequeEn,
      pay_mode_dd_en: payload.printHeaders.payModeDdEn,
      pay_mode_upi_en: payload.printHeaders.payModeUpiEn,
      notify_email_enabled: payload.notifications.enableNotifications
    };
    
    api.put('/system/settings', apiPayload)
      .then(() => {
        setSavedSettingsSnapshot(payload);
        setSettings(payload);
        setIsDirty(false);
        showToast('Organisation settings updated successfully via API.');
      })
      .catch(err => {
        console.error(err);
        showToast('Failed to save settings to API.', 'error');
      });
"""

import re

content = re.sub(r'const success = saveStoredOrganisationSettings\(payload\);[\s\S]*?\} else \{[\s\S]*?showToast\(\'Failed to save settings to local storage.\', \'error\'\);\n    \}', save_logic, content)


with open(frontend_path, "w", encoding="utf-8") as f:
    f.write(content)

print("OrganisationSettings patched.")
