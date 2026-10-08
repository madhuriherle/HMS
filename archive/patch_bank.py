import re

file_path = r'D:\python_project\HMS-frontend-main\src\pages\BankDetailsManagement.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. IMPORTS
content = re.sub(
    r"import\s*\{\s*getStoredPaymentModeConfigs.*?formatPaymentModeLabel\s*\}\s*from\s*'../utils/receiptStore';",
    "import api from '../api';\nimport {\n  AVAILABLE_PAYMENT_MODES,\n  AVAILABLE_BANK_ACCOUNTS,\n  formatPaymentModeLabel,\n  getStoredReceipts\n} from '../utils/receiptStore';",
    content,
    flags=re.DOTALL
)

# 2. INITIALIZATION
content = content.replace(
    "const [paymentConfigs, setPaymentConfigs] = useState(getStoredPaymentModeConfigs());",
    "const [paymentConfigs, setPaymentConfigs] = useState([]);"
)

# 3. useEffect
fetch_configs = """
  const fetchConfigs = async () => {
    try {
      const [banksRes, modesRes] = await Promise.all([
        api.get('/master-settings/finance/banks?limit=1000'),
        api.get('/master-settings/finance/payment-modes?limit=1000')
      ]);
      const banks = banksRes.data?.items || [];
      const modes = modesRes.data?.items || [];
      const mapped = modes.map(m => {
        const bank = banks.find(b => b.id === m.bank_id);
        return {
          id: m.id,
          paymentMode: m.payment_mode,
          paymentType: m.payment_type,
          bankAccount: bank ? bank.name_en : '',
          branch: bank ? bank.branch_name : '',
          ifscCode: bank ? bank.ifsc_code : '',
          accountNumber: bank ? bank.account_number : '',
          status: m.status ? 'Active' : 'Inactive'
        };
      });
      setPaymentConfigs(mapped);
    } catch(err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchConfigs();
    setReceipts(getStoredReceipts());
  }, []);
"""
content = re.sub(
    r"  useEffect\(\(\) => \{\s*setPaymentConfigs\(getStoredPaymentModeConfigs\(\)\);\s*setReceipts\(getStoredReceipts\(\)\);\s*\}, \[\]\);",
    fetch_configs,
    content,
    flags=re.DOTALL
)

# Remove persistConfigs
content = re.sub(r"  const persistConfigs = \(updatedList\) => \{.*?\};\n", "", content, flags=re.DOTALL)

# 4. handleSaveForm
handle_save_form = r'''  const handleSaveForm = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const effectiveMode =
      formData.paymentMode === '__CUSTOM__'
        ? formData.customPaymentMode.trim()
        : formData.paymentMode.trim();

    const isOffline = effectiveMode.toLowerCase() === 'cash' || effectiveMode.toLowerCase() === 'cheque' || effectiveMode.toLowerCase() === 'dd';
    const effectiveBank = isOffline
      ? ''
      : formData.bankAccount === '__CUSTOM__'
        ? formData.customBankAccount.trim()
        : (formData.bankAccount || '').trim();

    const paymentType = isOffline ? 'Offline' : 'Online';

    try {
      let finalBankId = null;
      if (!isOffline && effectiveBank) {
        const banksRes = await api.get('/master-settings/finance/banks?limit=1000');
        const banks = banksRes.data?.items || [];
        let bank = banks.find(b => b.name_en === effectiveBank && b.account_number === formData.accountNumber.trim());
        
        if (!bank) {
          const bankCode = effectiveBank.substring(0,3).toUpperCase() + Date.now().toString().slice(-4);
          const newBankRes = await api.post('/master-settings/finance/banks', {
            code: bankCode,
            name_en: effectiveBank,
            account_number: formData.accountNumber.trim(),
            branch_name: formData.branch.trim(),
            ifsc_code: formData.ifscCode.trim().toUpperCase()
          });
          finalBankId = newBankRes.data.id;
        } else {
          finalBankId = bank.id;
        }
      }

      const payload = {
        payment_mode: effectiveMode,
        payment_type: paymentType,
        bank_id: finalBankId,
        status: formData.status === 'Active'
      };

      if (modalMode === 'add') {
        await api.post('/master-settings/finance/payment-modes', payload);
        showToast('Payment Mode added successfully.');
      } else {
        await api.put(`/master-settings/finance/payment-modes/${editingItem.id}`, payload);
        showToast('Payment Mode updated successfully.');
      }
      
      setIsAddEditOpen(false);
      fetchConfigs();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving configuration', 'error');
    }
  };'''

content = re.sub(r"  const handleSaveForm = \(e\) => \{.*?(?=\n  const confirmStatusToggle =)", lambda m: handle_save_form + "\n", content, flags=re.DOTALL)

# 5. confirmStatusToggle
confirm_status = r'''  const confirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { item, newStatus } = statusDialog;
    
    try {
      await api.put(`/master-settings/finance/payment-modes/${item.id}`, {
        status: newStatus === 'Active'
      });
      showToast(`Payment Mode "${formatPaymentModeLabel(item)}" set to ${newStatus}.`);
      setStatusDialog(null);
      fetchConfigs();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
  };'''

content = re.sub(r"  const confirmStatusToggle = \(\) => \{.*?(?=\n  const renderPagination =)", lambda m: confirm_status + "\n", content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied for bank details")
