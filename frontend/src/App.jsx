import React from 'react';
import PermissionGate from './components/PermissionGate';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import MembershipTypeManagement from './pages/MembershipTypeManagement';
import ReceiptTypeManagement from './pages/ReceiptTypeManagement';
import LocationSetup from './pages/LocationSetup';
import RolesAndPrivileges from './pages/RolesAndPrivileges';
import UserManagement from './pages/UserManagement';
import ModulesManagement from './pages/ModulesManagement';
import ReceiptEntry from './pages/ReceiptEntry';
import ReceiptTracking from './pages/ReceiptTracking';
import LabelList from './pages/LabelList';
import MagazineManagement from './pages/MagazineManagement';
import MembershipList from './pages/MembershipList';
import UnapprovedMembership from './pages/UnapprovedMembership';
import AssignedApprovals from './pages/AssignedApprovals';
import OrganisationSettings from './pages/OrganisationSettings';
import NumberFormats from './pages/NumberFormats';
import SystemSettings from './pages/SystemSettings';
import MyProfile from './pages/MyProfile';
import RecycleBin from './pages/RecycleBin';
import DataCleanup from './pages/DataCleanup';
import BankDetailsManagement from './pages/BankDetailsManagement';
import Approvals from './pages/Approvals';
import RegisterNewMember from './pages/RegisterNewMember';
import MemberProfile from './pages/MemberProfile';
import ActivityLogs from './pages/ActivityLogs';
import FormModalHost from './components/FormModalHost';
import MemberImport from './pages/MemberImport';
import BulkReceiptMapping from './pages/BulkReceiptMapping';
import KycForm from './pages/KycForm';
import EventsManagement from './pages/EventsManagement';
import EngagementsManagement from './pages/EngagementsManagement';
import ReportsManagement from './pages/ReportsManagement';
import NotificationsManagement from './pages/NotificationsManagement';
// Personal Masters (gotra / qualification / native place) screen is switched off for now:
// import PersonalMasters from './pages/MasterLists';

// Anyone without a login is sent to the sign-in page before any panel screen renders
const RequireLogin = ({ children }) => {
  let signedIn = false;
  try {
    signedIn = Boolean(localStorage.getItem('access_token'));
  } catch (_) {
    signedIn = false;
  }
  return signedIn ? children : <Navigate to="/" replace />;
};

function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <FormModalHost />
      <Routes>
        <Route path="/" element={<Login />} />

        {/* Public, token-authenticated pages (no sign-in, not a panel page) */}
        <Route path="/kyc" element={<KycForm />} />

        {/* Shortcuts without the /dashboard prefix */}
        <Route path="/membership/register" element={<Navigate to="/dashboard/membership/register" replace />} />
        <Route path="/membership/add" element={<Navigate to="/dashboard/membership/register" replace />} />
        <Route path="/membership/list" element={<Navigate to="/dashboard/membership/list" replace />} />
        <Route path="/membership/unapproved" element={<Navigate to="/dashboard/membership/unapproved" replace />} />
        <Route path="/membership" element={<Navigate to="/dashboard/membership/list" replace />} />
        <Route path="/events" element={<Navigate to="/dashboard/events" replace />} />
        <Route path="/engagements" element={<Navigate to="/dashboard/engagements" replace />} />
        <Route path="/reports" element={<Navigate to="/dashboard/reports" replace />} />
        <Route path="/notifications" element={<Navigate to="/dashboard/notifications" replace />} />

        <Route path="/dashboard" element={<RequireLogin><MainLayout /></RequireLogin>}>
          <Route index element={<PermissionGate required="dashboard.read" title="Access Restricted" message="You need the Dashboard privilege to open this page."><Dashboard /></PermissionGate>} />
          
          {/* Membership Module Routes */}
          <Route path="membership/list" element={<MembershipList />} />
          <Route path="membership/import" element={<PermissionGate required={['members.import.read', 'members.import.write']} title="Access Restricted" message="You need permission to register or import members."><MemberImport /></PermissionGate>} />
          <Route path="membership/unapproved" element={<UnapprovedMembership />} />
          <Route path="membership/assigned" element={<AssignedApprovals />} />
          <Route path="membership/register" element={<RegisterNewMember />} />
          <Route path="membership/add" element={<RegisterNewMember />} />
          <Route path="membership/edit/:id" element={<RegisterNewMember />} />
          <Route path="membership/view/:id" element={<MemberProfile />} />
          <Route path="membership/profile/:id" element={<MemberProfile />} />
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
          <Route path="system/number-formats" element={<NumberFormats />} />
          <Route path="master/organisation" element={<OrganisationSettings />} />
          <Route path="settings/organisation" element={<OrganisationSettings />} />
          <Route path="profile" element={<PermissionGate required="users.my_profile.read" title="Access Restricted" message="You need the My Profile privilege to open this page."><MyProfile /></PermissionGate>} />
          <Route path="settings" element={<SystemSettings />} />
          <Route path="settings/recycle-bin" element={<RecycleBin />} />
          <Route path="settings/cleanup" element={<DataCleanup />} />
          <Route path="master/payment-modes" element={<BankDetailsManagement />} />
          {/* <Route path="master/personal-masters" element={<PersonalMasters />} /> */}
          <Route path="approvals" element={<Approvals />} />
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
          <Route path="users/modules" element={<PermissionGate minRank={0} required="users.modules.read" title="Access Restricted" message="You do not have access to this page."><ModulesManagement /></PermissionGate>} />
          <Route path="users/activity" element={<PermissionGate required="activity.read"><ActivityLogs /></PermissionGate>} />
          <Route path="activity/logs" element={<PermissionGate required="activity.read"><ActivityLogs /></PermissionGate>} />
          <Route path="activity" element={<PermissionGate required="activity.read"><ActivityLogs /></PermissionGate>} />
          <Route path="master/modules" element={<PermissionGate minRank={0} required="users.modules.read" title="Access Restricted" message="You do not have access to this page."><ModulesManagement /></PermissionGate>} />
          <Route path="masters/modules" element={<PermissionGate minRank={0} required="users.modules.read" title="Access Restricted" message="You do not have access to this page."><ModulesManagement /></PermissionGate>} />
          <Route path="settings/modules" element={<PermissionGate minRank={0} required="users.modules.read" title="Access Restricted" message="You do not have access to this page."><ModulesManagement /></PermissionGate>} />

          {/* Receipts Module Routes */}
          <Route path="receipts" element={<Navigate to="/dashboard/receipts/entry" replace />} />
          <Route path="receipts/entry" element={<ReceiptEntry />} />
          <Route path="receipts/add" element={<ReceiptEntry />} />
          <Route path="receipts/edit/:id" element={<ReceiptEntry />} />
          <Route path="receipts/tracking" element={<ReceiptTracking />} />
          <Route path="receipt/tracking" element={<ReceiptTracking />} />
          <Route path="receipts/bulk-mapping" element={<PermissionGate required="receipts.bulk_mapping.read" title="Access Restricted" message="You need the Bulk Receipt Mapping privilege to open this page."><BulkReceiptMapping /></PermissionGate>} />
          <Route path="receipts/auto-map" element={<PermissionGate required="receipts.bulk_mapping.read" title="Access Restricted" message="You need the Bulk Receipt Mapping privilege to open this page."><BulkReceiptMapping /></PermissionGate>} />
          <Route path="receipts/labels" element={<PermissionGate required="members.label_list.read" title="Access Restricted"><LabelList /></PermissionGate>} />
          <Route path="receipts/label-list" element={<PermissionGate required="members.label_list.read" title="Access Restricted"><LabelList /></PermissionGate>} />
          <Route path="magazine" element={<Navigate to="/dashboard/magazine/subscriptions" replace />} />
          <Route path="magazine/management" element={<Navigate to="/dashboard/magazine/subscriptions" replace />} />
          <Route path="magazine/subscriptions" element={<MagazineManagement />} />
          <Route path="magazine/pauses-returns" element={<Navigate to="/dashboard/magazine/subscriptions" replace />} />
          <Route path="magazine/labels-delivery" element={<MagazineManagement />} />
          <Route path="magazines" element={<Navigate to="/dashboard/magazine" replace />} />
          <Route path="magazine/labels" element={<PermissionGate required="members.label_list.read" title="Access Restricted"><LabelList /></PermissionGate>} />

          {/* Events Module Routes */}
          <Route path="events" element={<PermissionGate required="events.read" title="Access Restricted" message="You need the Events privilege to view this page."><EventsManagement /></PermissionGate>} />
          <Route path="events/management" element={<PermissionGate required="events.read" title="Access Restricted" message="You need the Events privilege to view this page."><EventsManagement /></PermissionGate>} />

          {/* Engagements Module Routes */}
          <Route path="engagements" element={<PermissionGate required={['engagements.read', 'engagements.affiliations.read', 'engagements.associates.read', 'engagements.press_media.read', 'engagements.committee.read']} title="Access Restricted" message="You need Engagements privilege to view this page."><EngagementsManagement /></PermissionGate>} />
          <Route path="engagements/management" element={<PermissionGate required={['engagements.read', 'engagements.affiliations.read', 'engagements.associates.read', 'engagements.press_media.read', 'engagements.committee.read']} title="Access Restricted" message="You need Engagements privilege to view this page."><EngagementsManagement /></PermissionGate>} />
          <Route path="engagements/affiliations" element={<PermissionGate required={['engagements.read', 'engagements.affiliations.read']} title="Access Restricted"><EngagementsManagement /></PermissionGate>} />
          <Route path="engagements/associates" element={<PermissionGate required={['engagements.read', 'engagements.associates.read']} title="Access Restricted"><EngagementsManagement /></PermissionGate>} />
          <Route path="engagements/press-media" element={<PermissionGate required={['engagements.read', 'engagements.press_media.read']} title="Access Restricted"><EngagementsManagement /></PermissionGate>} />
          <Route path="engagements/committee" element={<PermissionGate required={['engagements.read', 'engagements.committee.read']} title="Access Restricted"><EngagementsManagement /></PermissionGate>} />

          {/* Reports Module Routes */}
          <Route path="reports" element={<Navigate to="/dashboard/reports/summary" replace />} />
          <Route path="reports/summary" element={<PermissionGate required="reports.summary_report.read" title="Access Restricted" message="You need the Reports privilege to view this page."><ReportsManagement /></PermissionGate>} />
          <Route path="reports/members" element={<PermissionGate required="reports.members_report.read" title="Access Restricted" message="You need the Reports privilege to view this page."><ReportsManagement /></PermissionGate>} />
          <Route path="reports/receipts" element={<PermissionGate required="reports.receipts_report.read" title="Access Restricted" message="You need the Reports privilege to view this page."><ReportsManagement /></PermissionGate>} />
          <Route path="reports/magazines" element={<PermissionGate required="reports.magazines_report.read" title="Access Restricted" message="You need the Reports privilege to view this page."><ReportsManagement /></PermissionGate>} />
          <Route path="reports/saved" element={<PermissionGate required="reports.saved_report.read" title="Access Restricted" message="You need the Reports privilege to view this page."><ReportsManagement /></PermissionGate>} />
        
          {/* Notifications Module Routes */}
          <Route path="notifications" element={<Navigate to="/dashboard/notifications/campaigns" replace />} />
          <Route path="notifications/campaigns" element={<PermissionGate required="notifications.campaigns.read" title="Access Restricted" message="You need the Notifications privilege to view this page."><NotificationsManagement /></PermissionGate>} />
          <Route path="notifications/templates" element={<PermissionGate required="notifications.message_templates.read" title="Access Restricted" message="You need the Notifications privilege to view this page."><NotificationsManagement /></PermissionGate>} />
          <Route path="notifications/quick-send" element={<Navigate to="/dashboard/notifications/campaigns" replace />} />
          <Route path="notifications/inbox" element={<PermissionGate required="notifications.read" title="Access Restricted" message="You need the Notifications privilege to view this page."><NotificationsManagement /></PermissionGate>} />
        </Route>

        {/* Any unknown address: a full-screen page, no panel around it */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;
