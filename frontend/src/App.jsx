import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import MembershipTypeManagement from './pages/MembershipTypeManagement';
import ReceiptTypeManagement from './pages/ReceiptTypeManagement';
import LocationSetup from './pages/LocationSetup';
import RolesAndPrivileges from './pages/RolesAndPrivileges';
import UserManagement from './pages/UserManagement';
import ModulesManagement from './pages/ModulesManagement';
import ReceiptEntry from './pages/ReceiptEntry';
import ReceiptTracking from './pages/ReceiptTracking';
import LabelList from './pages/LabelList';
import MembershipList from './pages/MembershipList';
import UnapprovedMembership from './pages/UnapprovedMembership';
import OrganisationSettings from './pages/OrganisationSettings';
import BankDetailsManagement from './pages/BankDetailsManagement';

function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Login />} />

        <Route path="/dashboard" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          
          {/* Membership Module Routes */}
          <Route path="membership/list" element={<MembershipList />} />
          <Route path="membership/unapproved" element={<UnapprovedMembership />} />
          <Route path="membership/register" element={<MembershipList />} />
          <Route path="membership/add" element={<MembershipList />} />
          <Route path="membership" element={<Navigate to="/dashboard/membership/list" replace />} />
          <Route path="members" element={<Navigate to="/dashboard/membership/list" replace />} />
          <Route path="members/list" element={<Navigate to="/dashboard/membership/list" replace />} />

          {/* Master Management Routes */}
          <Route path="master/location-setup" element={<LocationSetup />} />
          <Route path="masters/location-setup" element={<LocationSetup />} />
          <Route path="master/location" element={<LocationSetup />} />
          <Route path="masters/location" element={<LocationSetup />} />
          <Route path="master/membership-type" element={<MembershipTypeManagement />} />
          <Route path="masters/membership-types" element={<MembershipTypeManagement />} />
          <Route path="master/receipt-type" element={<ReceiptTypeManagement />} />
          <Route path="masters/receipt-types" element={<ReceiptTypeManagement />} />
          <Route path="master/receipt" element={<ReceiptTypeManagement />} />
          <Route path="master/particulars" element={<ReceiptTypeManagement />} />
          <Route path="masters/particulars" element={<ReceiptTypeManagement />} />
          <Route path="master/particulars-master" element={<ReceiptTypeManagement />} />
          <Route path="masters/particulars-master" element={<ReceiptTypeManagement />} />
          <Route path="master/organisation-settings" element={<OrganisationSettings />} />
          <Route path="master/organisation" element={<OrganisationSettings />} />
          <Route path="settings/organisation" element={<OrganisationSettings />} />
          <Route path="settings" element={<OrganisationSettings />} />
          <Route path="master/payment-modes" element={<BankDetailsManagement />} />
          <Route path="masters/payment-modes" element={<BankDetailsManagement />} />
          <Route path="master/payment-mode" element={<BankDetailsManagement />} />
          <Route path="masters/payment-mode" element={<BankDetailsManagement />} />
          <Route path="master/bank-details" element={<BankDetailsManagement />} />
          <Route path="masters/bank-details" element={<BankDetailsManagement />} />
          <Route path="master/bank" element={<BankDetailsManagement />} />
          <Route path="masters/bank" element={<BankDetailsManagement />} />
          <Route path="users/roles" element={<RolesAndPrivileges />} />
          <Route path="users/roles-privileges" element={<RolesAndPrivileges />} />
          <Route path="user/roles" element={<RolesAndPrivileges />} />
          <Route path="users/list" element={<UserManagement />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="users/management" element={<UserManagement />} />
          <Route path="users/user-management" element={<UserManagement />} />
          <Route path="users/modules" element={<ModulesManagement />} />
          <Route path="master/modules" element={<ModulesManagement />} />
          <Route path="masters/modules" element={<ModulesManagement />} />
          <Route path="settings/modules" element={<ModulesManagement />} />

          {/* Receipts Module Routes */}
          <Route path="receipts" element={<Navigate to="/dashboard/receipts/entry" replace />} />
          <Route path="receipts/entry" element={<ReceiptEntry />} />
          <Route path="receipts/add" element={<ReceiptEntry />} />
          <Route path="receipts/tracking" element={<ReceiptTracking />} />
          <Route path="receipt/tracking" element={<ReceiptTracking />} />
          <Route path="receipts/labels" element={<LabelList />} />
          <Route path="receipts/label-list" element={<LabelList />} />
          <Route path="magazine/labels" element={<LabelList />} />

          {/* Placeholder routes for other menu items to prevent 404s during navigation */}
          <Route path="*" element={
            <div className="flex flex-col items-center justify-center h-full text-[#863221]">
              <h2 className="text-2xl font-bold mb-2 text-[#180200]">Coming Soon</h2>
              <p>This module is currently under development.</p>
            </div>
          } />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
