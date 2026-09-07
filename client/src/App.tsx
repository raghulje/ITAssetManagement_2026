import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './api/AuthContext'
import { ToastProvider } from './components/Toast'
import type { ReactNode } from 'react'
import Dashboard from './pages/Dashboard'
import AssetsList from './pages/assets/AssetsList'
import AssetDetail from './pages/assets/AssetDetail'
import AssetForm from './pages/assets/AssetForm'
import { AssetCheckout, AssetCheckin } from './pages/assets/AssetCheckout'
import {
  // AssetAudit, AuditDue, BulkAudit, // Audit feature — restore when needed
  EolDue, CheckinDue, QuickscanCheckin, BulkCheckout,
  RequestedAssets, Maintenances, MaintenanceForm, ImportHistory,
} from './pages/assets/AssetExtras'
import AgentActivity from './pages/assets/AgentActivity'
import { LicensesList, LicenseDetail, LicenseForm, LicenseCheckout } from './pages/inventory/Licenses'
import {
  AccessoriesList, AccessoryDetail, AccessoryForm, AccessoryCheckout,
  ConsumablesList, ConsumableDetail, ConsumableForm, ConsumableCheckout,
  ComponentsList, ComponentDetail, ComponentForm, ComponentCheckout,
  KitsList, KitDetail, KitForm, KitCheckout,
} from './pages/inventory/QtyModules'
import { UsersList, UserDetail, UserForm } from './pages/users/Users'
import {
  EmployeesList, EmployeeDetail, EmployeeForm, EmployeeImport,
} from './pages/employees/Employees'
import {
  ModelsList, ModelDetail, ModelForm,
  CategoriesList, CategoryDetail, CategoryForm,
  StatusLabelsList, StatusLabelForm,
  LocationsList, LocationDetail, LocationForm,
  CompaniesList, CompanyForm, CompanyDetail,
  ManufacturersList, ManufacturerForm,
  SuppliersList, SupplierForm,
  DepartmentsList, DepartmentForm, DepartmentDetail,
  DepreciationsList, DepreciationForm,
  FieldsList, FieldForm,
} from './pages/settings/MasterData'
import {
  ReportsHub, ActivityReport, CustomReport,
  // AuditReport, // Audit feature — restore when needed
  DepreciationReport,
  LicenseReport, MaintenanceReport, UnacceptedReport, AccessoryReport,
} from './pages/Reports'
import {
  AccountAssets, AccountRequested, AccountAccept, AccountProfile,
  AccountPassword, AccountApi, AdminHub, ImportPage, RequestableItems,
  LoginPage, SettingsGeneral,
} from './pages/Misc'
import RolesPermissions from './pages/settings/RolesPermissions'
import SpaceManagement from './pages/spaces/SpaceManagement'
import NotificationsSettings from './pages/settings/NotificationsSettings'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordReset'
import SsoCallback from './pages/SsoCallback'
import PublicAsset from './pages/assets/PublicAsset'
import LabelsModule from './pages/labels/LabelsModule'
import LogoutPage from './pages/Logout'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="suite-page"><p style={{ padding: 40, textAlign: 'center' }}>Loading…</p></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

/** Settings / Reports — Admin or Superuser only */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return <div className="suite-page"><p style={{ padding: 40, textAlign: 'center' }}>Loading…</p></div>
  if (!isAdmin) {
    return (
      <div className="suite-page">
        <p style={{ padding: 40, textAlign: 'center' }}>Only Admin users can access this page.</p>
      </div>
    )
  }
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/sso/callback" element={<SsoCallback />} />
          <Route path="/logout" element={<LogoutPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/asset/:token" element={<PublicAsset />} />
          <Route path="/*" element={
            <RequireAuth>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/hardware" element={<AssetsList />} />
                <Route path="/labels" element={<LabelsModule />} />
                <Route path="/hardware/create" element={<AssetForm />} />
                {/* Audit feature — restore when needed
                <Route path="/hardware/audit/due" element={<AuditDue />} />
                <Route path="/hardware/bulkaudit" element={<BulkAudit />} />
                <Route path="/hardware/:id/audit" element={<AssetAudit />} />
                */}
                <Route path="/hardware/eol/due" element={<EolDue />} />
                <Route path="/hardware/checkins/due" element={<CheckinDue />} />
                <Route path="/hardware/quickscancheckin" element={<QuickscanCheckin />} />
                <Route path="/hardware/bulkcheckout" element={<BulkCheckout />} />
                <Route path="/hardware/requested" element={<RequestedAssets />} />
                <Route path="/hardware/history" element={<ImportHistory />} />
                <Route path="/hardware/agent-activity" element={<AgentActivity />} />
                <Route path="/hardware/:id/edit" element={<AssetForm />} />
                <Route path="/hardware/:id/clone" element={<AssetForm />} />
                <Route path="/hardware/:id/checkout" element={<AssetCheckout />} />
                <Route path="/hardware/:id/checkin" element={<AssetCheckin />} />
                <Route path="/hardware/:id" element={<AssetDetail />} />
                <Route path="/maintenances" element={<Maintenances />} />
                <Route path="/maintenances/create" element={<MaintenanceForm />} />
                <Route path="/maintenances/:id/edit" element={<MaintenanceForm />} />
                <Route path="/licenses" element={<LicensesList />} />
                <Route path="/licenses/create" element={<LicenseForm />} />
                <Route path="/licenses/:id" element={<LicenseDetail />} />
                <Route path="/licenses/:id/edit" element={<LicenseForm />} />
                <Route path="/licenses/:id/checkout" element={<LicenseCheckout />} />
                <Route path="/accessories" element={<AccessoriesList />} />
                <Route path="/accessories/create" element={<AccessoryForm />} />
                <Route path="/accessories/:id" element={<AccessoryDetail />} />
                <Route path="/accessories/:id/edit" element={<AccessoryForm />} />
                <Route path="/accessories/:id/checkout" element={<AccessoryCheckout />} />
                <Route path="/consumables" element={<ConsumablesList />} />
                <Route path="/consumables/create" element={<ConsumableForm />} />
                <Route path="/consumables/:id" element={<ConsumableDetail />} />
                <Route path="/consumables/:id/edit" element={<ConsumableForm />} />
                <Route path="/consumables/:id/checkout" element={<ConsumableCheckout />} />
                <Route path="/components" element={<ComponentsList />} />
                <Route path="/components/create" element={<ComponentForm />} />
                <Route path="/components/:id" element={<ComponentDetail />} />
                <Route path="/components/:id/edit" element={<ComponentForm />} />
                <Route path="/components/:id/checkout" element={<ComponentCheckout />} />
                <Route path="/kits" element={<KitsList />} />
                <Route path="/kits/create" element={<KitForm />} />
                <Route path="/kits/:id" element={<KitDetail />} />
                <Route path="/kits/:id/edit" element={<KitForm />} />
                <Route path="/kits/:id/checkout" element={<KitCheckout />} />
                <Route path="/users" element={<UsersList />} />
                <Route path="/users/create" element={<UserForm />} />
                <Route path="/users/:id" element={<UserDetail />} />
                <Route path="/users/:id/edit" element={<UserForm />} />
                <Route path="/users/:id/clone" element={<UserForm />} />
                <Route path="/employees" element={<EmployeesList />} />
                <Route path="/employees/import" element={<EmployeeImport />} />
                <Route path="/employees/create" element={<EmployeeForm />} />
                <Route path="/employees/:id" element={<EmployeeDetail />} />
                <Route path="/employees/:id/edit" element={<EmployeeForm />} />
                <Route path="/models" element={<ModelsList />} />
                <Route path="/models/create" element={<ModelForm />} />
                <Route path="/models/:id" element={<ModelDetail />} />
                <Route path="/models/:id/edit" element={<ModelForm />} />
                <Route path="/categories" element={<CategoriesList />} />
                <Route path="/categories/create" element={<CategoryForm />} />
                <Route path="/categories/:id" element={<CategoryDetail />} />
                <Route path="/categories/:id/edit" element={<CategoryForm />} />
                <Route path="/statuslabels" element={<StatusLabelsList />} />
                <Route path="/statuslabels/create" element={<StatusLabelForm />} />
                <Route path="/statuslabels/:id/edit" element={<StatusLabelForm />} />
                <Route path="/locations" element={<LocationsList />} />
                <Route path="/locations/create" element={<LocationForm />} />
                <Route path="/locations/:id" element={<LocationDetail />} />
                <Route path="/locations/:id/edit" element={<LocationForm />} />
                <Route path="/spaces" element={<SpaceManagement />} />
                <Route path="/companies" element={<CompaniesList />} />
                <Route path="/companies/create" element={<CompanyForm />} />
                <Route path="/companies/:id" element={<CompanyDetail />} />
                <Route path="/companies/:id/edit" element={<CompanyForm />} />
                <Route path="/manufacturers" element={<ManufacturersList />} />
                <Route path="/manufacturers/create" element={<ManufacturerForm />} />
                <Route path="/manufacturers/:id/edit" element={<ManufacturerForm />} />
                <Route path="/suppliers" element={<SuppliersList />} />
                <Route path="/suppliers/create" element={<SupplierForm />} />
                <Route path="/suppliers/:id/edit" element={<SupplierForm />} />
                <Route path="/departments" element={<DepartmentsList />} />
                <Route path="/departments/create" element={<DepartmentForm />} />
                <Route path="/departments/:id" element={<DepartmentDetail />} />
                <Route path="/departments/:id/edit" element={<DepartmentForm />} />
                <Route path="/depreciations" element={<DepreciationsList />} />
                <Route path="/depreciations/create" element={<DepreciationForm />} />
                <Route path="/depreciations/:id/edit" element={<DepreciationForm />} />
                <Route path="/fields" element={<FieldsList />} />
                <Route path="/fields/create" element={<FieldForm />} />
                <Route path="/fields/:id/edit" element={<FieldForm />} />
                <Route path="/reports" element={<RequireAdmin><ReportsHub /></RequireAdmin>} />
                <Route path="/reports/activity" element={<RequireAdmin><ActivityReport /></RequireAdmin>} />
                <Route path="/reports/custom" element={<RequireAdmin><CustomReport /></RequireAdmin>} />
                {/* Audit feature — restore when needed
                <Route path="/reports/audit" element={<RequireAdmin><AuditReport /></RequireAdmin>} />
                */}
                <Route path="/reports/depreciation" element={<RequireAdmin><DepreciationReport /></RequireAdmin>} />
                <Route path="/reports/licenses" element={<RequireAdmin><LicenseReport /></RequireAdmin>} />
                <Route path="/reports/maintenances" element={<RequireAdmin><MaintenanceReport /></RequireAdmin>} />
                <Route path="/reports/unaccepted" element={<RequireAdmin><UnacceptedReport /></RequireAdmin>} />
                <Route path="/reports/accessories" element={<RequireAdmin><AccessoryReport /></RequireAdmin>} />
                <Route path="/account/assets" element={<AccountAssets />} />
                <Route path="/account/requested" element={<AccountRequested />} />
                <Route path="/account/accept" element={<AccountAccept />} />
                <Route path="/account/profile" element={<AccountProfile />} />
                <Route path="/account/password" element={<AccountPassword />} />
                <Route path="/account/api" element={<AccountApi />} />
                <Route path="/admin" element={<RequireAdmin><AdminHub /></RequireAdmin>} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/requestable" element={<RequestableItems />} />
                <Route path="/settings" element={<RequireAdmin><SettingsGeneral /></RequireAdmin>} />
                <Route path="/settings/roles" element={<RequireAdmin><RolesPermissions /></RequireAdmin>} />
                <Route path="/settings/notifications" element={<RequireAdmin><NotificationsSettings /></RequireAdmin>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RequireAuth>
          }
          />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
