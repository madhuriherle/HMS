import os
import re

utils_exports = ['getStoredOrganisationSettings', 'getStoredUnapprovedRenewals', 'getStoredUnapprovedMembers', 'getStoredReceipts', 'getStoredMembers', 'getStoredLabelList', 'getStoredMembershipTypes', 'getStoredStates', 'getStoredDistricts', 'getStoredTaluks', 'getStoredPostalCodes', 'getStoredParticulars', 'getStoredReceiptTypes', 'getStoredPaymentModes', 'getStoredGothras', 'getStoredPaymentModeConfigs', 'getStoredBankDetails']

frontend_src = 'frontend/src'

for root, dirs, files in os.walk(frontend_src):
    for file in files:
        if file.endswith('.jsx') or file.endswith('.js'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            for export in utils_exports:
                if re.search(r'\b' + export + r'\b', content):
                    import_blocks = re.findall(r'import\s+.*?from\s+[\'\"].*?[\'\"]', content, re.DOTALL)
                    is_imported = False
                    for block in import_blocks:
                        if export in block:
                            is_imported = True
                            break
                    if not is_imported and 'export const ' + export not in content:
                        print(f'{filepath} {export}')
