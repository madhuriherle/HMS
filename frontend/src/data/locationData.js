export const initialStates = [
  { id: 'ST-01', name: 'Karnataka', code: 'KA', status: 'Active', createdDate: '2025-01-10' },
  { id: 'ST-02', name: 'Kerala', code: 'KL', status: 'Active', createdDate: '2025-01-15' },
];

export const initialDistricts = [
  // --- Karnataka Districts ---
  { id: 'DT-01', name: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'DT-02', name: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'DT-03', name: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'DT-04', name: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'DT-05', name: 'Bengaluru Urban', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'DT-06', name: 'Chikkamagaluru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-15' },
  { id: 'DT-07', name: 'Mysuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-18' },
  { id: 'DT-08', name: 'Dharwad', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-05' },
  { id: 'DT-09', name: 'Belagavi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-08' },
  { id: 'DT-10', name: 'Hassan', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-10' },
  { id: 'DT-11', name: 'Tumakuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-12' },

  // --- Kerala Districts ---
  { id: 'DT-12', name: 'Kasaragod', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-25' },
  { id: 'DT-13', name: 'Kannur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-28' },
  { id: 'DT-14', name: 'Kozhikode', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-01' },
  { id: 'DT-15', name: 'Ernakulam', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-03' },
  { id: 'DT-16', name: 'Thiruvananthapuram', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-05' },
  { id: 'DT-17', name: 'Thrissur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-07' },
  { id: 'DT-18', name: 'Wayanad', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-09' },
  { id: 'DT-19', name: 'Palakkad', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-11' },
];

export const initialTaluks = [
  // Dakshina Kannada Taluks
  { id: 'TK-01', name: 'Mangaluru', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'TK-02', name: 'Bantwal', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'TK-03', name: 'Puttur', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'TK-04', name: 'Sullia', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'TK-05', name: 'Belthangady', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'TK-06', name: 'Kadaba', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-07', name: 'Moodbidri', districtId: 'DT-01', districtName: 'Dakshina Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },

  // Uttara Kannada Taluks
  { id: 'TK-08', name: 'Sirsi', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'TK-09', name: 'Siddapur', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-10' },
  { id: 'TK-10', name: 'Yellapur', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'TK-11', name: 'Kumta', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'TK-12', name: 'Honnavar', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-13', name: 'Bhatkal', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-14', name: 'Ankola', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },
  { id: 'TK-15', name: 'Karwar', districtId: 'DT-02', districtName: 'Uttara Kannada', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-14' },

  // Udupi Taluks
  { id: 'TK-16', name: 'Udupi', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'TK-17', name: 'Kundapura', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-11' },
  { id: 'TK-18', name: 'Karkala', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-19', name: 'Byndoor', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-20', name: 'Brahmavara', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },
  { id: 'TK-21', name: 'Kaup', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },
  { id: 'TK-22', name: 'Hebri', districtId: 'DT-03', districtName: 'Udupi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-14' },

  // Shivamogga Taluks
  { id: 'TK-23', name: 'Sagar', districtId: 'DT-04', districtName: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-24', name: 'Thirthahalli', districtId: 'DT-04', districtName: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-25', name: 'Hosanagara', districtId: 'DT-04', districtName: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },
  { id: 'TK-26', name: 'Shivamogga', districtId: 'DT-04', districtName: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },
  { id: 'TK-27', name: 'Soraba', districtId: 'DT-04', districtName: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-14' },
  { id: 'TK-28', name: 'Bhadravathi', districtId: 'DT-04', districtName: 'Shivamogga', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-15' },

  // Bengaluru Urban Taluks
  { id: 'TK-29', name: 'Bengaluru North', districtId: 'DT-05', districtName: 'Bengaluru Urban', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-30', name: 'Bengaluru South', districtId: 'DT-05', districtName: 'Bengaluru Urban', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-12' },
  { id: 'TK-31', name: 'Bengaluru East', districtId: 'DT-05', districtName: 'Bengaluru Urban', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },
  { id: 'TK-32', name: 'Anekal', districtId: 'DT-05', districtName: 'Bengaluru Urban', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-13' },

  // Chikkamagaluru Taluks
  { id: 'TK-33', name: 'Chikkamagaluru', districtId: 'DT-06', districtName: 'Chikkamagaluru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-15' },
  { id: 'TK-34', name: 'Sringeri', districtId: 'DT-06', districtName: 'Chikkamagaluru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-15' },
  { id: 'TK-35', name: 'Koppa', districtId: 'DT-06', districtName: 'Chikkamagaluru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-16' },
  { id: 'TK-36', name: 'Mudigere', districtId: 'DT-06', districtName: 'Chikkamagaluru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-16' },

  // Mysuru Taluks
  { id: 'TK-37', name: 'Mysuru', districtId: 'DT-07', districtName: 'Mysuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-18' },
  { id: 'TK-38', name: 'Hunsur', districtId: 'DT-07', districtName: 'Mysuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-18' },
  { id: 'TK-39', name: 'Nanjangud', districtId: 'DT-07', districtName: 'Mysuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-01-19' },

  // Dharwad Taluks
  { id: 'TK-40', name: 'Dharwad', districtId: 'DT-08', districtName: 'Dharwad', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-05' },
  { id: 'TK-41', name: 'Hubballi Urban', districtId: 'DT-08', districtName: 'Dharwad', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-05' },

  // Belagavi Taluks
  { id: 'TK-42', name: 'Belagavi', districtId: 'DT-09', districtName: 'Belagavi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-08' },
  { id: 'TK-43', name: 'Gokak', districtId: 'DT-09', districtName: 'Belagavi', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-08' },

  // Hassan Taluks
  { id: 'TK-44', name: 'Hassan', districtId: 'DT-10', districtName: 'Hassan', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-10' },
  { id: 'TK-45', name: 'Sakleshpur', districtId: 'DT-10', districtName: 'Hassan', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-10' },

  // Tumakuru Taluks
  { id: 'TK-46', name: 'Tumakuru', districtId: 'DT-11', districtName: 'Tumakuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-12' },
  { id: 'TK-47', name: 'Tiptur', districtId: 'DT-11', districtName: 'Tumakuru', stateId: 'ST-01', stateName: 'Karnataka', status: 'Active', createdDate: '2025-02-12' },

  // --- Kerala Taluks ---
  // Kasaragod Taluks
  { id: 'TK-48', name: 'Kasaragod', districtId: 'DT-12', districtName: 'Kasaragod', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-25' },
  { id: 'TK-49', name: 'Manjeshwaram', districtId: 'DT-12', districtName: 'Kasaragod', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-25' },
  { id: 'TK-50', name: 'Hosdurg', districtId: 'DT-12', districtName: 'Kasaragod', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-26' },
  { id: 'TK-51', name: 'Vellarikundu', districtId: 'DT-12', districtName: 'Kasaragod', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-26' },

  // Kannur Taluks
  { id: 'TK-52', name: 'Kannur', districtId: 'DT-13', districtName: 'Kannur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-28' },
  { id: 'TK-53', name: 'Thalassery', districtId: 'DT-13', districtName: 'Kannur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-28' },
  { id: 'TK-54', name: 'Taliparamba', districtId: 'DT-13', districtName: 'Kannur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-01-29' },

  // Kozhikode Taluks
  { id: 'TK-55', name: 'Kozhikode', districtId: 'DT-14', districtName: 'Kozhikode', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-01' },
  { id: 'TK-56', name: 'Vadakara', districtId: 'DT-14', districtName: 'Kozhikode', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-01' },

  // Ernakulam Taluks
  { id: 'TK-57', name: 'Kochi', districtId: 'DT-15', districtName: 'Ernakulam', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-03' },
  { id: 'TK-58', name: 'Aluva', districtId: 'DT-15', districtName: 'Ernakulam', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-03' },
  { id: 'TK-59', name: 'Kanayannur', districtId: 'DT-15', districtName: 'Ernakulam', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-04' },

  // Thiruvananthapuram Taluks
  { id: 'TK-60', name: 'Thiruvananthapuram', districtId: 'DT-16', districtName: 'Thiruvananthapuram', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-05' },
  { id: 'TK-61', name: 'Neyyattinkara', districtId: 'DT-16', districtName: 'Thiruvananthapuram', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-05' },

  // Thrissur Taluks
  { id: 'TK-62', name: 'Thrissur', districtId: 'DT-17', districtName: 'Thrissur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-07' },
  { id: 'TK-63', name: 'Mukundapuram', districtId: 'DT-17', districtName: 'Thrissur', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-07' },

  // Wayanad Taluks
  { id: 'TK-64', name: 'Vythiri', districtId: 'DT-18', districtName: 'Wayanad', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-09' },
  { id: 'TK-65', name: 'Sulthan Bathery', districtId: 'DT-18', districtName: 'Wayanad', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-09' },

  // Palakkad Taluks
  { id: 'TK-66', name: 'Palakkad', districtId: 'DT-19', districtName: 'Palakkad', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-11' },
  { id: 'TK-67', name: 'Ottapalam', districtId: 'DT-19', districtName: 'Palakkad', stateId: 'ST-02', stateName: 'Kerala', status: 'Active', createdDate: '2025-02-11' },
];
