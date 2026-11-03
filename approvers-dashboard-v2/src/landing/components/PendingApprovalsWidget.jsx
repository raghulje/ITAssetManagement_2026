import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { kf } from '../../sdk/index.js'
import CurrentStepBadges from './CurrentStepBadges.jsx'
import SlaCell from './SlaCell.jsx'
import { getEmptyPeriodState, requestedDateInPeriod } from './RecordsPeriodPicker.jsx'
import {
    customPendingRequestsIcon,
    customTravelBookingIcon,
    customTravelAdvanceIcon,
    customTravelExpenseIcon,
} from '../../../../raghul_icons/index.js'

class WidgetErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error) {
        console.error('PendingApprovalsWidget crashed', error)
    }

    render() {
        if (!this.state.hasError) return this.props.children
        const msg = this.state.error?.message || String(this.state.error || 'Unknown error')
        const stack = this.state.error?.stack ? String(this.state.error.stack) : ''
        return (
            <div className="bg-white rounded-lg sm:rounded-2xl p-3 sm:p-4" style={{ border: '1px solid #FDA29B', background: '#FFFBFA' }}>
                <div className="text-xs font-bold" style={{ color: '#B42318' }}>
                    Widget error (white page prevented)
                </div>
                <div className="text-[11px] mt-1" style={{ color: '#7A271A', whiteSpace: 'pre-wrap' }}>
                    {msg}
                </div>
                {!!stack && (
                    <div className="text-[10px] mt-2" style={{ color: '#7A271A', opacity: 0.9, whiteSpace: 'pre-wrap' }}>
                        {stack}
                    </div>
                )}
            </div>
        )
    }
}

const APP_ID = 'Expense_and_Travel_Management_A00'
const PAGE_SIZE = 2000
const MAX_PAGES = 15
const NEARING_SLA_MS = 48 * 60 * 60 * 1000
const TABS = [
    { key: 'travel', label: 'Travel Booking', short: 'Booking', processId: 'Travel_Management_A02', reportId: 'All_Items_A00', popup: 'Popup_wGLvx_vJ6z', color: '#1E88E5', glow: 'rgba(30,136,229,0.45)', icon: customTravelBookingIcon },
    { key: 'advance', label: 'Travel Advance', short: 'Advance', processId: 'Advance_Payment_Request_Process_A01', reportId: 'ALL_ITEMS_WITH_TABLE_A00', popup: 'Popup_W4HX3YpAL1', color: '#43A047', glow: 'rgba(67,160,71,0.45)', icon: customTravelAdvanceIcon },
    { key: 'expense', label: 'Travel Expense', short: 'Expense', processId: 'Expense_Management_A03', reportId: 'All_Items_MK_A00', popup: 'Popup_I3OfQFU_01', color: '#FB8C00', glow: 'rgba(251,140,0,0.45)', icon: customTravelExpenseIcon },
]
const HIDDEN_COLUMNS = ['Column_BliavHBah3', 'Column_RzqotquBQV', 'Column_eFd2LUqnSP']

/** Deadline cells: IST wall time (same as expense-management `index.jsx`). */
const EXPENSE_DATETIME_DISPLAY_TZ = 'Asia/Kolkata'

const EXPENSE_TYPE_STYLE = {
    allowance: { icon: 'ri-sun-line', colorFrom: '#EE6A31', colorTo: '#F59E21', text: '#EE6A31' },
    food: { icon: 'ri-restaurant-2-line', colorFrom: '#139B49', colorTo: '#7dc244', text: '#139B49' },
    local: { icon: 'ri-taxi-line', colorFrom: '#2879b6', colorTo: '#1D9AD4', text: '#2879b6' },
    other: { icon: 'ri-file-list-3-line', colorFrom: '#64748b', colorTo: '#94a3b8', text: '#64748b' },
}

/** Travel Expense All_Items_MK_A00 column ids (same as employee-dashboard-v2). */
const EXPENSE_REPORT_FIELD_IDS = {
    expenseId: 'Column_9Y8-uPPDVi',
    requestDate: 'Column_gJidmn-kAv',
    requestor: 'Column_rCBEwniBuE',
    expenseType: 'Column_XcXTxxA4-C',
    totalAmount: 'Column_Nvns1CPpfI',
    currentStep: 'Column_bzLJNkKQZO',
    slaDeadline: 'Column_KD_a7365Yi',
}

/** Pending API FieldIds (approver My Tasks payload). */
const EXPENSE_PENDING_FIELD_IDS = {
    expenseId: 'Expense_ID',
    requestDate: 'Expense_Date',
    requestor: '_created_by',
    expenseType: 'Expense_Type',
    totalAmount: 'Total_Claimable_Amount',
    currentStep: '_current_step',
    slaDeadline: 'SLA_Deadline',
}

/** View mapping: prefer report Column_* (after enrichment), same as employee dashboard. */
const EMPTY_EXPENSE_FIELD_IDS = {
    ...EXPENSE_REPORT_FIELD_IDS,
}

// Travel Expense status when `_status` isn't reliable (FieldId from preference columns).
const EXPENSE_STATUS_COL_ID = 'current_step_status'

/** Travel Advance ALL_ITEMS_WITH_TABLE_A00 column ids (same as employee-dashboard-v2). */
const ADVANCE_REPORT_FIELD_IDS = {
    requestId: 'Column_gmgjecOFBH',
    requestedDate: 'Column_RmtnLwNoFB',
    requestor: 'Column_9XVj5RhJI0',
    linkToTravel: 'Column_ctQorHPmAU',
    advanceAmount: 'Column_rMCWa-_7NO',
    currentStep: 'Column_LTs78WRTDp',
    slaDeadline: 'Column_Wc-2EfDPkD',
}

/** Pending API FieldIds for Travel Advance. */
const ADVANCE_PENDING_FIELD_IDS = {
    requestId: 'Advance_Request_ID',
    requestedDate: 'Requested_Date',
    requestor: 'created_by_user_id',
    linkToTravel: 'List_of_Travel_Requests_lookup',
    advanceAmount: 'Advance_amount_value',
    currentStep: '_current_step',
    slaDeadline: 'SLA_Deadline',
}

/** View mapping prefers report Column_* after enrichment (same as employee). */
const ADVANCE_FIELD_IDS = {
    ...ADVANCE_REPORT_FIELD_IDS,
}

/** All Items report column ids (same as employee dashboard). */
const TRAVEL_FIELD_IDS = {
    requestId: 'Column_DRz-V78ZHe',
    /** Common Departure_Date for oneWay / roundTrip / multiCity */
    departureDate: 'Column_HQjIt021s2',
    /** Legacy FS departure (fallback) */
    departureDateLegacy: 'Column_T7yk_UT6Hk',
    requestor: 'Column_MfwZaTYIE8',
    from: 'Column_1qX1HxE34f',
    to: 'Column_6VWxLVKxdg',
    bookingAmount: 'Column_S7qHj2qlIJ',
    currentStep: 'Column_z0s-oAG3rN',
    slaDeadline: 'Column_3l8DHla3JD',
    /** Travel_Type — oneWay | roundTrip | multiCity */
    travelType: 'Column_WHUJTy6aCd',
    /** Multi-city total booking amount */
    mcBookingAmount: 'Column_emdSnf_50o',
    /** Multi-city route e.g. MAA → DEL → BOM */
    mcRouteSummary: 'Column_wLODKWpmSS',
}

/** Pending API field ids (fallback when rows use FieldId keys). */
const TRAVEL_PENDING_FIELD_IDS = {
    requestId: 'Travel_Request_ID',
    departureDate: 'Departure_Date',
    departureDateLegacy: 'FS_Departure_Date',
    requestor: 'Created_By',
    from: 'FS_From_City',
    to: 'FS_To_City',
    bookingAmount: 'FS_Booking_Amount_1',
    currentStep: '_current_step',
    slaDeadline: 'SLA_Deadline',
    travelType: 'Travel_Type',
    mcBookingAmount: 'MC_Total_Booking_Amount',
    mcRouteSummary: 'MC_Route_Summary',
}

function normalizeTravelTypeKey(raw) {
    const s = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
    if (s === 'multicity' || s.includes('multi')) return 'multiCity'
    if (s === 'roundtrip' || s.includes('round')) return 'roundTrip'
    if (s === 'oneway' || s.includes('one')) return 'oneWay'
    return ''
}

function travelTypeLabel(key) {
    if (key === 'multiCity') return 'Multi-City'
    if (key === 'roundTrip') return 'Round Trip'
    if (key === 'oneWay') return 'One Way'
    return '—'
}

function tripRouteIconName(key) {
    if (key === 'roundTrip') return 'ri-arrow-left-right-line'
    if (key === 'multiCity') return 'ri-route-line'
    return 'ri-arrow-right-line'
}

function TripRouteIcon({ tripTypeKey, label }) {
    const kind = tripTypeKey || 'oneWay'
    return (
        <span
            className={`trip-route-icon is-${kind}`}
            title={label || travelTypeLabel(tripTypeKey)}
            aria-hidden="true"
        >
            <i className={tripRouteIconName(tripTypeKey)} />
        </span>
    )
}

function splitTravelRoute(entry) {
    if (entry?.isMultiCity) {
        const raw = String(entry.routeSummary || entry.fromText || '')
        const parts = raw
            .split(/\s*(?:→|->|—|-)\s*/)
            .map((part) => part.trim())
            .filter(Boolean)
        if (parts.length >= 2) {
            return { from: parts[0], to: parts[parts.length - 1] }
        }
        return { from: raw || '—', to: '—' }
    }
    return { from: entry?.fromText || '—', to: entry?.toTextValue || '—' }
}

function readTravelField(row, key) {
    const colKey = TRAVEL_FIELD_IDS[key]
    const fieldKey = TRAVEL_PENDING_FIELD_IDS[key]
    const colVal = colKey ? row?.[colKey] : undefined
    if (colVal !== undefined && colVal !== null && colVal !== '') return colVal
    const fieldVal = fieldKey ? row?.[fieldKey] : undefined
    if (fieldVal !== undefined && fieldVal !== null && fieldVal !== '') return fieldVal
    return undefined
}

function readTravelDeparture(row) {
    return (
        readTravelField(row, 'departureDate') ??
        readTravelField(row, 'departureDateLegacy') ??
        row?.Departure_Date ??
        row?.From_Date ??
        row?.FS_Departure_Date ??
        row?.Common_from_date
    )
}

function firstFilled(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
}

/** Keys that are empty on `base` but filled on `source` — so empty list cells don't hide item-detail values. */
function fillMissingFrom(base, source) {
    const out = {}
    if (!source || typeof source !== 'object') return out
    for (const [key, val] of Object.entries(source)) {
        if (val === undefined || val === null || val === '') continue
        const cur = base?.[key]
        if (cur === undefined || cur === null || cur === '') out[key] = val
    }
    return out
}

function readTravelFrom(row) {
    return firstFilled(
        readTravelField(row, 'from'),
        row?.Boarding_from,
        row?.common_From,
        row?.Source,
        row?.Destination_From_International,
        row?.Boarding,
    )
}

function readTravelTo(row) {
    return firstFilled(
        readTravelField(row, 'to'),
        row?.Destination_to_1,
        row?.common_To,
        row?.Destination,
        row?.Destination_To_International,
        row?.Destination_1,
    )
}

function readTravelAmount(row) {
    return firstFilled(
        readTravelField(row, 'bookingAmount'),
        row?.FS_Booking_Amount,
        row?.FS_Total_Fare_1,
        row?.FS_Total_Fare,
        row?.Booking_Amount_1,
    )
}

function readTravelTypeRaw(row) {
    return firstFilled(
        readTravelField(row, 'travelType'),
        row?.Trip_Type,
        row?.OnewayRound_tripNot_applicable,
        row?.FS_Trip_Type,
        row?.travel_type,
        row?.tripType,
    )
}

function travelRowNeedsDetail(row) {
    const from = toText(readTravelFrom(row)).trim()
    const to = toText(readTravelTo(row)).trim()
    const amount = toNumber(readTravelAmount(row))
    const trip = normalizeTravelTypeKey(readTravelTypeRaw(row))
    return !from || !to || (!amount && !trip)
}

const CURRENT_STEP_COL_ID = {
    expense: '_current_step',
    advance: '_current_step',
    travel: '_current_step',
}

const EXCEPTION_FIELD_ID = {
    expense: 'Column__hqtAn5Ntn',
    advance: 'Exception_Case',
    travel: 'Exception',
}

function isYesLike(raw) {
    if (raw === true) return true
    if (raw === false || raw == null || raw === '') return false
    if (typeof raw === 'number') return raw === 1
    const s = String(raw).trim().toLowerCase()
    return s === 'yes' || s === 'true' || s === '1'
}

// Preference columns (role-mis-table style) for pending endpoints.
const PREFERENCE_COLUMNS = {
    expense: [
        // Expense fields (per provided columns list)
        { Id: 'Expense_ID', Model: 'Expense_Management_A03' },
        { Id: 'Expense_Purpose', Model: 'Expense_Management_A03' },
        { Id: 'Expense_Amount', Model: 'Expense_Management_A03' },
        { Id: 'Department', Model: 'Expense_Management_A03' },
        { Id: 'Expense_Date', Model: 'Expense_Management_A03' },
        { Id: 'Expense_Category', Model: 'Expense_Management_A03' },
        { Id: 'Expense_Type', Model: 'Expense_Management_A03' },
        { Id: 'Total_Reimbursable_Amount_single', Model: 'Expense_Management_A03' },
        { Id: 'Total_Claimable_Amount', Model: 'Expense_Management_A03' },
        { Id: 'Total_Amount', Model: 'Expense_Management_A03' },
        // System fields used by table logic / status / assignment
        { Id: '_created_by', Model: 'Expense_Management_A03' },
        { Id: '_created_at', Model: 'Expense_Management_A03' },
        { Id: '_current_step', Model: 'Expense_Management_A03' },
        { Id: '_current_assigned_to', Model: 'Expense_Management_A03' },
        { Id: '_status', Model: 'Expense_Management_A03' },
        // Process-specific status + SLA deadline (same FieldId as employee report Column_KD_a7365Yi)
        { Id: 'current_step_status', Model: 'Expense_Management_A03' },
        { Id: 'SLA_Deadline', Model: 'Expense_Management_A03' },
    ],
    advance: [
        // Travel Advance (per provided columns list)
        { Id: 'Advance_Payment_Category', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_Amount', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_Payment_Request_Reason', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Payment_Type', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'List_of_Travel_Requests_lookup', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_Payment_status', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_Request_ID', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Budget_Master_Lookup', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Approver_Comments', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Online_Transaction_ID', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Attacments', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Employee_Master_Lookup', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Employee_Email_Address', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'created_by_user_id', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'dept_master_lookup', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Department_1', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'dept_owner_email_address', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Dept_Owner', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Activity_Instance_ID', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Managers_email', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Date_1', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'current_step', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Currently_assigned_to', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Completed_at_date', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'InstanceId_Budget', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_amount_value', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Comments', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Available_amount_value', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Approved_manager_email', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Approved_manager', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Completed_at_month', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Actual_FY', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'FY_lookup', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Created_at_date', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Financial_year', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Current_FY', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Requested_Date', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Category', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'No_of_Travel_days', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_Purpose', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'This_is_Venwind_Travel_Advance_form', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Comments_1', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Comments_2', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Comments_3', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Payement_Type', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Payment_Status_1', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Transaction_ID', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_policy_lookup', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Employee_Master_lookup_1', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Designation', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Max_per_day', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'max_per_trip', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'adv_amt_as_per_no_of_days', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Final_amount', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'link_a_travel', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Exception_Case', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'advance_amount_in_number', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Advance_Eligibility', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: 'Instance_ID', Model: 'Advance_Payment_Request_Process_A01' },
        // System fields (explicitly included in provided schema)
        { Id: 'Name', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_created_by', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_modified_by', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_created_at', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_modified_at', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_deleted_at', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_deleted_by', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_flow_name', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_doc_version', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_current_step', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_current_assigned_to', Model: 'Advance_Payment_Request_Process_A01' },
        { Id: '_status', Model: 'Advance_Payment_Request_Process_A01' },
        // SLA (explicitly included in provided schema)
        { Id: 'SLA_Deadline', Model: 'Advance_Payment_Request_Process_A01' },
    ],
    travel: [
        // Travel Booking (per provided columns list)
        { Id: 'Travel_Request_ID', Model: 'Travel_Management_A02' },
        { Id: 'Purpose_of_Travel', Model: 'Travel_Management_A02' },
        { Id: 'From_Date', Model: 'Travel_Management_A02' },
        { Id: 'FS_Departure_Date', Model: 'Travel_Management_A02' },
        { Id: 'To_Date', Model: 'Travel_Management_A02' },
        { Id: 'DomesticInternational', Model: 'Travel_Management_A02' },
        { Id: 'Destination_From_International', Model: 'Travel_Management_A02' },
        { Id: 'Destination_To_International', Model: 'Travel_Management_A02' },
        { Id: 'OnewayRound_tripNot_applicable', Model: 'Travel_Management_A02' },
        { Id: 'Traveling_to_multiple_locations', Model: 'Travel_Management_A02' },
        { Id: 'Is_accommodation_required', Model: 'Travel_Management_A02' },
        { Id: 'Is_visa_required', Model: 'Travel_Management_A02' },
        { Id: 'Attachments_if_any', Model: 'Travel_Management_A02' },
        { Id: 'Cancel_Request', Model: 'Travel_Management_A02' },
        { Id: 'cancellation_Reason', Model: 'Travel_Management_A02' },
        { Id: 'Comments', Model: 'Travel_Management_A02' },
        { Id: 'Mode_of_Transport', Model: 'Travel_Management_A02' },
        { Id: 'created_by_user_id', Model: 'Travel_Management_A02' },
        { Id: 'Employee_Lookup', Model: 'Travel_Management_A02' },
        { Id: 'Created_By', Model: 'Travel_Management_A02' },
        { Id: 'Employee_Dept_Name', Model: 'Travel_Management_A02' },
        { Id: 'emp_email_address', Model: 'Travel_Management_A02' },
        { Id: 'dept_master_lookup', Model: 'Travel_Management_A02' },
        { Id: 'dept_owner_email', Model: 'Travel_Management_A02' },
        { Id: 'reporting_manager', Model: 'Travel_Management_A02' },
        { Id: 'Activity_Instance_ID', Model: 'Travel_Management_A02' },
        { Id: 'Current_Step', Model: 'Travel_Management_A02' },
        { Id: 'Manager_email', Model: 'Travel_Management_A02' },
        { Id: 'common_From', Model: 'Travel_Management_A02' },
        { Id: 'common_To', Model: 'Travel_Management_A02' },
        { Id: 'Cancel_Icon_clicked', Model: 'Travel_Management_A02' },
        { Id: 'Empty_text_field_to_display_image', Model: 'Travel_Management_A02' },
        { Id: 'Multi_city_From_Min_date__Domestic', Model: 'Travel_Management_A02' },
        { Id: 'Multi_city_To_max_date__Domestic', Model: 'Travel_Management_A02' },
        { Id: 'Multi_city_From_Min_date__International', Model: 'Travel_Management_A02' },
        { Id: 'Multi_city_To_Max_date__International', Model: 'Travel_Management_A02' },
        { Id: 'Common_from_date', Model: 'Travel_Management_A02' },
        { Id: 'Common_to_date', Model: 'Travel_Management_A02' },
        { Id: 'Currently_assigned_to', Model: 'Travel_Management_A02' },
        { Id: 'Is_this_a_modification_request', Model: 'Travel_Management_A02' },
        { Id: 'Select_the_request_which_you_want_to_modify', Model: 'Travel_Management_A02' },
        { Id: 'id_1', Model: 'Travel_Management_A02' },
        { Id: 'Complete_travel_automatically_on', Model: 'Travel_Management_A02' },
        { Id: 'Request_id_to_be_modified', Model: 'Travel_Management_A02' },
        { Id: 'id_to_be_modified', Model: 'Travel_Management_A02' },
        { Id: 'No_of_multicity_travels__domestic', Model: 'Travel_Management_A02' },
        { Id: 'No_of_multicity_travels__international', Model: 'Travel_Management_A02' },
        { Id: 'No_of_stoppings', Model: 'Travel_Management_A02' },
        { Id: 'Approved_manager_email', Model: 'Travel_Management_A02' },
        { Id: 'Approved_manager', Model: 'Travel_Management_A02' },
        { Id: 'Request_cancelled', Model: 'Travel_Management_A02' },
        { Id: 'Last_completed_step', Model: 'Travel_Management_A02' },
        { Id: 'Actual_FY', Model: 'Travel_Management_A02' },
        { Id: 'Activity_instance_id_to_be_modified', Model: 'Travel_Management_A02' },
        { Id: 'Requester_Email', Model: 'Travel_Management_A02' },
        { Id: 'Employee_Record', Model: 'Travel_Management_A02' },
        { Id: 'L1_Manger_ID', Model: 'Travel_Management_A02' },
        { Id: 'L1_Manager_Record', Model: 'Travel_Management_A02' },
        { Id: 'L2_Manger_ID', Model: 'Travel_Management_A02' },
        { Id: 'L2_Manager_Record', Model: 'Travel_Management_A02' },
        { Id: 'Boarding_from', Model: 'Travel_Management_A02' },
        { Id: 'Destination_to_1', Model: 'Travel_Management_A02' },
        { Id: 'FS_From_City', Model: 'Travel_Management_A02' },
        { Id: 'FS_To_City', Model: 'Travel_Management_A02' },
        { Id: 'FS_Booking_Amount_1', Model: 'Travel_Management_A02' },
        { Id: 'Travel_Type', Model: 'Travel_Management_A02' },
        { Id: 'Departure_Date', Model: 'Travel_Management_A02' },
        { Id: 'MC_Route_Summary', Model: 'Travel_Management_A02' },
        { Id: 'MC_Total_Booking_Amount', Model: 'Travel_Management_A02' },
        { Id: 'Travel_Request_ID_1', Model: 'Travel_Management_A02' },
        { Id: 'Employee_Details', Model: 'Travel_Management_A02' },
        { Id: 'Purpose', Model: 'Travel_Management_A02' },
        { Id: 'Type', Model: 'Travel_Management_A02' },
        { Id: 'Beneficiary', Model: 'Travel_Management_A02' },
        { Id: 'Trip_Type', Model: 'Travel_Management_A02' },
        { Id: 'Source', Model: 'Travel_Management_A02' },
        { Id: 'Destination', Model: 'Travel_Management_A02' },
        { Id: 'Travel_Dates', Model: 'Travel_Management_A02' },
        { Id: 'Booking_type', Model: 'Travel_Management_A02' },
        { Id: 'Mode', Model: 'Travel_Management_A02' },
        { Id: 'Exception', Model: 'Travel_Management_A02' },
        { Id: 'Exception_Approval', Model: 'Travel_Management_A02' },
        { Id: 'City', Model: 'Travel_Management_A02' },
        { Id: 'Checkin_Date', Model: 'Travel_Management_A02' },
        { Id: 'Checkout_Date', Model: 'Travel_Management_A02' },
        { Id: 'Go_with_Green_mobility', Model: 'Travel_Management_A02' },
        { Id: 'Pickup_Mode', Model: 'Travel_Management_A02' },
        { Id: 'Pickup_Location', Model: 'Travel_Management_A02' },
        { Id: 'Pickup_Time', Model: 'Travel_Management_A02' },
        { Id: 'Drop_Location', Model: 'Travel_Management_A02' },
        { Id: 'Drop_Time', Model: 'Travel_Management_A02' },
        { Id: 'Purpose_1', Model: 'Travel_Management_A02' },
        { Id: 'Amount', Model: 'Travel_Management_A02' },
        { Id: 'Payment_Mode', Model: 'Travel_Management_A02' },
        { Id: 'Settlement_Date', Model: 'Travel_Management_A02' },
        { Id: 'Upload_Booking_options', Model: 'Travel_Management_A02' },
        { Id: 'Cost_Impact', Model: 'Travel_Management_A02' },
        { Id: 'Value', Model: 'Travel_Management_A02' },
        // System fields (explicitly included in provided schema)
        { Id: 'Name', Model: 'Travel_Management_A02' },
        { Id: '_created_by', Model: 'Travel_Management_A02' },
        { Id: '_modified_by', Model: 'Travel_Management_A02' },
        { Id: '_created_at', Model: 'Travel_Management_A02' },
        { Id: '_modified_at', Model: 'Travel_Management_A02' },
        { Id: '_flow_name', Model: 'Travel_Management_A02' },
        { Id: '_doc_version', Model: 'Travel_Management_A02' },
        { Id: '_current_step', Model: 'Travel_Management_A02' },
        { Id: '_current_assigned_to', Model: 'Travel_Management_A02' },
        { Id: '_status', Model: 'Travel_Management_A02' },
        // SLA (explicitly included in provided schema)
        { Id: 'SLA_Deadline', Model: 'Travel_Management_A02' },
    ],
}

async function safeApi(url, options) {
    if (!url || url.includes('undefined') || url.includes('null')) return null
    try {
        return await kf.api(url, options)
    } catch (e) {
        console.warn('API failed:', url, e)
        return null
    }
}

async function postWorkflowStepPreference({ accountId, processId, viewId, columns }) {
    const prefUrl = `/common/2/${accountId}/preference/${processId}/WorkflowStep/${viewId}/?_application_id=${APP_ID}`
    return await safeApi(prefUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            AppId: processId,
            ConfigJson: { Columns: columns, Filter: {}, Sort: [] },
            ViewId: viewId,
            ViewType: 'WorkflowStep',
        }),
    })
}

// Participated mode removed (My Tasks only).

function normalizeStepsList(resp) {
    return Array.isArray(resp) ? resp : resp?.Data ?? resp?.data ?? []
}

// (Participated-only helper removed)

function isStepAllowedForRole(roleLower, stepName) {
    const roles = Array.isArray(roleLower) ? roleLower : [roleLower]
    const roleList = roles.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean)
    const stepLower = String(stepName || '').trim().toLowerCase()
    if (roleList.length === 0 || !stepLower) return true

    const rules = [
        { roleIncludes: ['l1 manager'], stepIncludes: ['l1 manager'] },
        { roleIncludes: ['l2 manager'], stepIncludes: ['l2 manager'] },
        { roleIncludes: ['travel desk'], stepIncludes: ['travel desk'] },
        { roleIncludes: ['finance', 'approver'], stepIncludes: ['finance', 'approver'] },
        { roleIncludes: ['finance', 'checker'], stepIncludes: ['finance', 'checker'] },
        { roleIncludes: ['treasury', 'executive'], stepIncludes: ['treasury', 'executive'] },
    ]
    const match = rules.find((r) => roleList.some((role) => r.roleIncludes.every((k) => role.includes(k))))
    if (!match) return true
    return match.stepIncludes.every((k) => stepLower.includes(k))
}

function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '').trim()
        const match = cleaned.match(/-?\d+(\.\d+)?/)
        if (!match) return 0
        const n = Number(match[0])
        return Number.isFinite(n) ? n : 0
    }
    return 0
}

function safeJson(v) {
    try {
        return JSON.stringify(v)
    } catch {
        return String(v)
    }
}

function toText(val) {
    if (val === null || val === undefined) return ''
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val)
    if (Array.isArray(val)) {
        if (!val.length) return ''
        const names = val.map((x) => x?.Name || x?.FileName || x?.name || x?.filename || safeJson(x)).filter(Boolean)
        return names.length ? names.join(', ') : `${val.length} items`
    }
    if (typeof val === 'object') return val?.Name || val?.name || val?.Email || val?.email || val?.Value || val?.value || val?.Text || val?.text || safeJson(val)
    return String(val)
}

function extractDateTimeRaw(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1e12) return value
        if (value > 1e9) return value * 1000
    }
    if (typeof value === 'string' || typeof value === 'number') return value
    if (typeof value === 'object') {
        const nested =
            value.Value ??
            value.value ??
            value.DisplayValue ??
            value.displayValue ??
            value.Name ??
            value.name ??
            value._isostring ??
            value._display_value ??
            value.UTC_ShortDateTime ??
            value.utcShortDateTime ??
            value.ShortDateTime ??
            value.shortDateTime
        if (nested != null && typeof nested !== 'object') return nested
        // Kissflow DateTime cells often use numeric OR string parts (_year/_month/_date).
        const y = Number(value._year ?? value.Year ?? value.year)
        if (Number.isFinite(y) && y > 0) {
            const mo = Number(value._month ?? value.Month ?? value.month ?? 1)
            const day = Number(value._date ?? value.Day ?? value.day ?? value._day ?? 1)
            const h = Number(value._hour ?? value.Hour ?? value.hour ?? 0)
            const mi = Number(value._minute ?? value.Minute ?? value.minute ?? 0)
            const s = Number(value._second ?? value.Second ?? value.second ?? 0)
            const monthIndex = Number.isFinite(mo) && mo > 0 ? mo - 1 : 0
            const d = new Date(
                y,
                monthIndex,
                Number.isFinite(day) && day > 0 ? day : 1,
                Number.isFinite(h) ? h : 0,
                Number.isFinite(mi) ? mi : 0,
                Number.isFinite(s) ? s : 0,
            )
            if (!Number.isNaN(d.getTime())) return d.toISOString()
        }
    }
    return null
}

let _deadlineDateTimeFormatter
function getDeadlineDisplayFormatter() {
    if (!_deadlineDateTimeFormatter) {
        _deadlineDateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
            timeZone: EXPENSE_DATETIME_DISPLAY_TZ,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
            hour: '2-digit',
        minute: '2-digit',
            second: '2-digit',
            hour12: true,
        })
    }
    return _deadlineDateTimeFormatter
}

function formatDeadlineCell(value) {
    const raw = extractDateTimeRaw(value)
    if (raw == null) return ''
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) {
        if (typeof raw === 'string' && raw.trim()) return raw.trim()
        return toText(value).trim()
    }
    let s = getDeadlineDisplayFormatter().format(d)
    s = s.replace(/\b([ap]m)\b/gi, (_, ap) => ap.toUpperCase())
    s = s.replace(/\s+(?:IST|GMT[+-][\d:]+|UTC)\b/gi, '').trim()
    return s
}

function dateRawToMs(raw) {
    if (raw === null || raw === undefined || raw === '') return null
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (raw > 1e12) return raw
        if (raw > 1e9) return raw * 1000
    }
    const extracted = extractDateTimeRaw(raw)
    const candidate = extracted !== null && extracted !== undefined ? extracted : raw
    if (candidate === null || candidate === undefined || candidate === '') return null
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        if (candidate > 1e12) return candidate
        if (candidate > 1e9) return candidate * 1000
    }
    const d = new Date(typeof candidate === 'object' ? toText(candidate) : candidate)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** Expense/Advance Requested Date; Travel Booking uses created-at as the request date. */
function readRequestedAtMs(row, tabKey) {
    if (tabKey === 'expense') {
        return (
            dateRawToMs(row?.[EXPENSE_PENDING_FIELD_IDS.requestDate]) ??
            dateRawToMs(row?.[EXPENSE_REPORT_FIELD_IDS.requestDate]) ??
            dateRawToMs(row?._created_at)
        )
    }
    if (tabKey === 'advance') {
        return (
            dateRawToMs(row?.[ADVANCE_PENDING_FIELD_IDS.requestedDate]) ??
            dateRawToMs(row?.[ADVANCE_REPORT_FIELD_IDS.requestedDate]) ??
            dateRawToMs(row?._created_at)
        )
    }
    return dateRawToMs(row?._created_at) ?? dateRawToMs(row?._modified_at)
}

function toDateText(value) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

/** Departure Date column: "04 Aug, 2026" for all travel trip types (same as employee). */
function formatDepartureDateDisplay(value) {
    if (value === null || value === undefined || value === '') return ''
    const raw = extractDateTimeRaw(value) ?? value
    const d = new Date(typeof raw === 'object' ? toText(raw) : raw)
    if (Number.isNaN(d.getTime())) {
        const s = String(raw || '').trim()
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (m) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            return `${m[3]} ${months[Number(m[2]) - 1] || m[2]}, ${m[1]}`
        }
        return s
    }
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.trim())) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const [y, mo, day] = raw.trim().slice(0, 10).split('-')
        return `${day} ${months[Number(mo) - 1] || mo}, ${y}`
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const day = String(d.getDate()).padStart(2, '0')
    return `${day} ${months[d.getMonth()]}, ${d.getFullYear()}`
}


function hasUsableDateTimeCell(value) {
    if (value === undefined || value === null || value === '') return false
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim() !== ''
    if (typeof value === 'object') return extractDateTimeRaw(value) != null
    return false
}

/** Expense field ids: prefer employee All_Items column ids, keep pending FieldId fallbacks. */
function resolveExpenseFieldIds(rawCols) {
    void rawCols
    return { ...EMPTY_EXPENSE_FIELD_IDS }
}

function extractCurrentStepText(row, colId) {
    const raw =
        colId && row?.[colId] !== undefined && row?.[colId] !== null && row?.[colId] !== ''
            ? row[colId]
            : row?.['Column_6KQUHRHKEZ'] ??
              row?.['Column_bzLJNkKQZO'] ??
              row?._current_step ??
              row?.Current_step ??
              row?.current_step
    if (raw === null || raw === undefined) return ''
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim()
    if (typeof raw === 'object') {
        const named = raw.Name ?? raw.name ?? raw.Value ?? raw.value ?? raw.Label ?? raw.label
        if (named != null && typeof named !== 'object') return String(named).trim()
    }
    return toText(raw).trim()
}

function extractSlaDeadlineRaw(row, slaColId, fallbackColIds = []) {
    const keys = [
        slaColId,
        ...fallbackColIds,
        'Column_KD_a7365Yi',
        'SLA_Deadline',
        'Deadline',
        'SLA',
    ].filter(Boolean)

    for (const key of keys) {
        const v = row?.[key]
        if (hasUsableDateTimeCell(v)) return v
    }

    if (row && typeof row === 'object') {
        for (const [key, v] of Object.entries(row)) {
            if (!/sla|deadline/i.test(key)) continue
            if (hasUsableDateTimeCell(v)) return v
        }
    }

    const ctx = row?._current_context
    if (Array.isArray(ctx) && ctx.length && ctx[0]?.ExpectedAt) return ctx[0].ExpectedAt
    return null
}

function normalizeExpenseTypeKey(name) {
    const t = String(name || '').trim().toLowerCase()
    if (!t) return 'other'
    if (t.includes('daily') || t.includes('allowance')) return 'allowance'
    if (t.includes('food')) return 'food'
    if (t.includes('local') || t.includes('conveyance')) return 'local'
    return 'other'
}

function formatINR(amount) {
    return `₹${Math.round(toNumber(amount)).toLocaleString('en-IN')}`
}

function MobileField({ label, children, stacked = false }) {
    if (stacked) {
        return (
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <span className="mb-1 block text-slate-500">{label}</span>
                <div className="min-w-0">{children}</div>
            </div>
        )
    }
    return (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <span className="shrink-0 text-slate-500">{label}</span>
            <div className="min-w-0 truncate text-right font-medium text-slate-800">{children}</div>
        </div>
    )
}

function MobileRecordCard({ title, subtitle, amount, onOpen, children, selected = false, selectSlot = null }) {
    return (
        <div className={`expense-record-card${selected ? ' is-selected' : ''}`}>
            {selectSlot ? <div className="expense-record-card-select">{selectSlot}</div> : null}
            <button type="button" className="expense-record-card-body" onClick={onOpen}>
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                    <div className="min-w-0 flex-1">
                        {title}
                        {subtitle}
                    </div>
                    {amount != null ? <span className="record-amount shrink-0 pt-0.5">{amount}</span> : null}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px]">{children}</div>
            </button>
        </div>
    )
}

function ExpenseMobileCard({ entry, accent, onOpen, selected, selectSlot }) {
    const tkey = normalizeExpenseTypeKey(entry.expenseType)
    const cfg = EXPENSE_TYPE_STYLE[tkey] || EXPENSE_TYPE_STYLE.other
    return (
        <MobileRecordCard
            selected={selected}
            selectSlot={selectSlot}
            onOpen={onOpen}
            amount={formatINR(entry.totalAmount)}
            title={
                <span className="record-id-badge inline-block max-w-full truncate" title={entry.expenseId}>
                    {entry.expenseId}
                </span>
            }
            subtitle={
                <div className="mt-2 flex min-w-0 items-center gap-2">
                    <div className="record-type-icon">
                        <i className={`${cfg.icon} text-white text-sm`} />
                    </div>
                    <p className="truncate text-sm font-semibold text-slate-800">{entry.expenseType || '—'}</p>
                </div>
            }
        >
            <MobileField label="Requestor">{entry.requestorText || '—'}</MobileField>
            <MobileField label="Requested">{entry.requestDateStr || '—'}</MobileField>
            <MobileField label="Current step" stacked>
                <CurrentStepBadges text={entry.currentStep} size="sm" accent={accent} />
            </MobileField>
            <MobileField label="SLA" stacked>
                <SlaCell deadlineAtMs={entry.deadlineAtMs} deadlineLabel={entry.deadlineText} size="sm" />
            </MobileField>
        </MobileRecordCard>
    )
}

function AdvanceMobileCard({ entry, accent, onOpen, selected, selectSlot }) {
    return (
        <MobileRecordCard
            selected={selected}
            selectSlot={selectSlot}
            onOpen={onOpen}
            amount={formatINR(entry.advanceAmount)}
            title={<p className="truncate text-sm font-semibold text-slate-800">{entry.requestorText || 'Advance request'}</p>}
            subtitle={<p className="mt-0.5 truncate text-[10px] text-slate-500">{entry.requestedDateStr || '—'}</p>}
        >
            <MobileField label="Link to travel">{entry.linkToTravelText || '—'}</MobileField>
            <MobileField label="Current step" stacked>
                <CurrentStepBadges text={entry.currentStep} size="sm" accent={accent} />
            </MobileField>
            <MobileField label="SLA" stacked>
                <SlaCell deadlineAtMs={entry.deadlineAtMs} deadlineLabel={entry.deadlineText} size="sm" />
            </MobileField>
        </MobileRecordCard>
    )
}

function TravelMobileCard({ entry, accent, onOpen, selected, selectSlot }) {
    const route = splitTravelRoute(entry)
    return (
        <MobileRecordCard
            selected={selected}
            selectSlot={selectSlot}
            onOpen={onOpen}
            amount={formatINR(entry.bookingAmount)}
            title={<p className="truncate text-sm font-semibold text-slate-800">{entry.requestorText || 'Travel booking'}</p>}
            subtitle={
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="travel-type-badge">{entry.tripTypeLabel}</span>
                    <span className="text-[10px] text-slate-500">{entry.departureDateStr || '—'}</span>
                </div>
            }
        >
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <span className="min-w-0 truncate font-semibold text-slate-800">{route.from}</span>
                <TripRouteIcon tripTypeKey={entry.travelTypeKey} label={entry.tripTypeLabel} />
                <span className="min-w-0 truncate text-right font-semibold text-slate-800">{route.to}</span>
            </div>
            <MobileField label="Current step" stacked>
                <CurrentStepBadges text={entry.currentStep} size="sm" accent={accent} />
            </MobileField>
            <MobileField label="SLA" stacked>
                <SlaCell deadlineAtMs={entry.deadlineAtMs} deadlineLabel={entry.deadlineText} size="sm" />
            </MobileField>
        </MobileRecordCard>
    )
}

function GenericMobileCard({ row, cols, onOpen, selected, selectSlot }) {
    const first = cols[0]
    const rest = cols.slice(1)
    return (
        <MobileRecordCard
            selected={selected}
            selectSlot={selectSlot}
            onOpen={onOpen}
            title={
                <p className="truncate text-sm font-semibold text-slate-800">
                    {first ? toText(row?.[first.Id]) || first.Name : 'Record'}
                </p>
            }
        >
            {rest.map((c) => (
                <MobileField key={c.Id} label={c.Name}>
                    {toText(row?.[c.Id]) || '—'}
                </MobileField>
            ))}
        </MobileRecordCard>
    )
}

/** Fetch All_Items_MK_A00 map by instance id — same report employee dashboard uses for Expense Type + SLA. */
async function fetchExpenseAllItemsReportMap(accountId) {
    const map = new Map()
    if (!accountId) return map
    const processId = 'Expense_Management_A03'
    const reportId = 'All_Items_MK_A00'
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `/process-report/2/${accountId}/${processId}/${reportId}?_application_id=${APP_ID}&page_number=${page}&page_size=${PAGE_SIZE}`
        const resp = await safeApi(url)
        const rows = Array.isArray(resp?.Data) ? resp.Data : Array.isArray(resp?.data) ? resp.data : []
        if (!rows.length) break
        for (const r of rows) {
            const id = String(r?._id || '').trim()
            if (id) map.set(id, r)
        }
        if (rows.length < PAGE_SIZE) break
    }
    return map
}

/** Copy employee-report Column_* values onto pending rows so Expense Type + SLA resolve. */
function enrichExpensePendingRowWithReport(pendingRow, reportRow) {
    if (!reportRow || typeof reportRow !== 'object') return pendingRow
    const next = { ...pendingRow }
    // Always take Expense Type + SLA from All_Items_MK_A00 (same as employee dashboard).
    if (reportRow[EXPENSE_REPORT_FIELD_IDS.expenseType] != null && reportRow[EXPENSE_REPORT_FIELD_IDS.expenseType] !== '') {
        next[EXPENSE_REPORT_FIELD_IDS.expenseType] = reportRow[EXPENSE_REPORT_FIELD_IDS.expenseType]
    }
    if (reportRow[EXPENSE_REPORT_FIELD_IDS.slaDeadline] != null && reportRow[EXPENSE_REPORT_FIELD_IDS.slaDeadline] !== '') {
        next[EXPENSE_REPORT_FIELD_IDS.slaDeadline] = reportRow[EXPENSE_REPORT_FIELD_IDS.slaDeadline]
    }
    const excKey = EXCEPTION_FIELD_ID.expense
    if (reportRow[excKey] != null && reportRow[excKey] !== '') {
        next[excKey] = reportRow[excKey]
    }
    // Fill other report columns when pending is missing them.
    for (const key of [
        EXPENSE_REPORT_FIELD_IDS.expenseId,
        EXPENSE_REPORT_FIELD_IDS.requestDate,
        EXPENSE_REPORT_FIELD_IDS.requestor,
        EXPENSE_REPORT_FIELD_IDS.totalAmount,
        EXPENSE_REPORT_FIELD_IDS.currentStep,
    ]) {
        const reportVal = reportRow[key]
        if (reportVal === undefined || reportVal === null || reportVal === '') continue
        const pendingVal = next[key]
        if (pendingVal === undefined || pendingVal === null || pendingVal === '') {
            next[key] = reportVal
        }
    }
    return next
}

function buildExpenseRowView(row, ids) {
    const expenseId =
        toText(row?.[ids.expenseId]).trim() ||
        toText(row?.[EXPENSE_PENDING_FIELD_IDS.expenseId]).trim() ||
        toText(row?._name || row?.Name) ||
        toText(row?._id).slice(-8) ||
        '—'

    const requestRaw =
        row?.[ids.requestDate] ??
        row?.[EXPENSE_PENDING_FIELD_IDS.requestDate] ??
        row?.['Column_gJidmn-kAv'] ??
        null
    const requestDateStr =
        (requestRaw !== undefined && requestRaw !== null && requestRaw !== ''
            ? toDateText(extractDateTimeRaw(requestRaw) ?? requestRaw)
            : '') || toDateText(row?._created_at)

    const windowStartAtMs =
        dateRawToMs(requestRaw) ?? dateRawToMs(row?._created_at) ?? dateRawToMs(row?._modified_at) ?? null

    const expenseTypeRaw = toText(
        row?.[EXPENSE_REPORT_FIELD_IDS.expenseType] ??
            row?.[ids.expenseType] ??
            row?.[EXPENSE_PENDING_FIELD_IDS.expenseType] ??
            row?.Expense_Category ??
            row?.Expense_Type_1,
    ).trim()
    const expenseType = expenseTypeRaw || '—'

    const requestorText = toText(
        row?.[ids.requestor] ?? row?.[EXPENSE_PENDING_FIELD_IDS.requestor] ?? row?.['Column_rCBEwniBuE'],
    ).trim()

    let totalAmount = toNumber(
        row?.[EXPENSE_REPORT_FIELD_IDS.totalAmount] ??
            row?.[ids.totalAmount] ??
            row?.[EXPENSE_PENDING_FIELD_IDS.totalAmount] ??
            row?.Total_Amount ??
            row?.['Column_UyJCJpXn5Y'] ??
            0,
    )

    const currentStep = extractCurrentStepText(
        row,
        ids.currentStep || EXPENSE_REPORT_FIELD_IDS.currentStep,
    )

    const slaRaw = extractSlaDeadlineRaw(row, EXPENSE_REPORT_FIELD_IDS.slaDeadline, [
        ids.slaDeadline,
        EXPENSE_PENDING_FIELD_IDS.slaDeadline,
        'SLA_Deadline',
        'Column_KD_a7365Yi',
    ])
    const deadlineAtMs = dateRawToMs(slaRaw)
    const deadlineText =
        slaRaw != null && hasUsableDateTimeCell(slaRaw) ? formatDeadlineCell(slaRaw) : ''

    const listSortMs =
        dateRawToMs(row?._modified_at) ?? dateRawToMs(row?._created_at) ?? windowStartAtMs ?? deadlineAtMs ?? 0

    return {
        expenseId,
        requestDateStr,
        requestorText,
        expenseType,
        totalAmount,
        currentStep,
        deadlineText,
        deadlineAtMs,
        windowStartAtMs,
        listSortMs,
    }
}

function formatLinkToTravel(value) {
    if (value === null || value === undefined || value === '') return '—'
    let v = value
    if (typeof v === 'string') {
        const s = v.trim()
        if (!s || s === '{}' || s === '—') return '—'
        try {
            v = JSON.parse(s)
        } catch {
            return s
        }
    }
    if (typeof v !== 'object' || Array.isArray(v)) return toText(v).trim() || '—'

    const from = toText(v.From ?? v.from).trim()
    const to = toText(v.To ?? v.to).trim()
    const fromDate = toText(v['From date'] ?? v.fromDate ?? v.FromDate).trim()
    const toDate = toText(v['To date'] ?? v.toDate ?? v.ToDate).trim()
    const purpose = toText(v['Travel Purpose'] ?? v.travelPurpose).trim()

    const summary = []
    if (from || to) summary.push(`${from || '—'} → ${to || '—'}`)
    if (fromDate || toDate) summary.push(`${fromDate || 'N/A'} to ${toDate || 'N/A'}`)
    if (purpose) summary.push(purpose)
    if (summary.length) return summary.join(' | ')

    const flat = toText(v).trim()
    return flat || '—'
}

/** Fetch ALL_ITEMS_WITH_TABLE_A00 map by instance id — same report employee uses for Link to Travel. */
async function fetchAdvanceAllItemsReportMap(accountId) {
    const map = new Map()
    if (!accountId) return map
    const processId = 'Advance_Payment_Request_Process_A01'
    const reportId = 'ALL_ITEMS_WITH_TABLE_A00'
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `/process-report/2/${accountId}/${processId}/${reportId}?_application_id=${APP_ID}&page_number=${page}&page_size=${PAGE_SIZE}`
        const resp = await safeApi(url)
        const rows = Array.isArray(resp?.Data) ? resp.Data : Array.isArray(resp?.data) ? resp.data : []
        if (!rows.length) break
        for (const r of rows) {
            const id = String(r?._id || '').trim()
            if (id) map.set(id, r)
        }
        if (rows.length < PAGE_SIZE) break
    }
    return map
}

/** Copy employee-report Column_* onto pending advance rows (esp. Link to Travel). */
function enrichAdvancePendingRowWithReport(pendingRow, reportRow) {
    if (!reportRow || typeof reportRow !== 'object') return pendingRow
    const next = { ...pendingRow }
    const linkKey = ADVANCE_REPORT_FIELD_IDS.linkToTravel
    if (reportRow[linkKey] != null && reportRow[linkKey] !== '') {
        next[linkKey] = reportRow[linkKey]
    }
    for (const key of [
        ADVANCE_REPORT_FIELD_IDS.requestId,
        ADVANCE_REPORT_FIELD_IDS.requestedDate,
        ADVANCE_REPORT_FIELD_IDS.requestor,
        ADVANCE_REPORT_FIELD_IDS.advanceAmount,
        ADVANCE_REPORT_FIELD_IDS.currentStep,
        ADVANCE_REPORT_FIELD_IDS.slaDeadline,
    ]) {
        const reportVal = reportRow[key]
        if (reportVal === undefined || reportVal === null || reportVal === '') continue
        const pendingVal = next[key]
        if (pendingVal === undefined || pendingVal === null || pendingVal === '') {
            next[key] = reportVal
        }
    }
    return next
}

/** Fetch Travel All_Items_A00 map — Trip Type / Departure_Date / MC fields. */
async function fetchTravelAllItemsReportMap(accountId) {
    const map = new Map()
    if (!accountId) return map
    const processId = 'Travel_Management_A02'
    const reportId = 'All_Items_A00'
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `/process-report/2/${accountId}/${processId}/${reportId}?_application_id=${APP_ID}&page_number=${page}&page_size=${PAGE_SIZE}`
        const resp = await safeApi(url)
        const rows = Array.isArray(resp?.Data) ? resp.Data : Array.isArray(resp?.data) ? resp.data : []
        if (!rows.length) break
        for (const r of rows) {
            const id = String(r?._id || '').trim()
            if (id) map.set(id, r)
        }
        if (rows.length < PAGE_SIZE) break
    }
    return map
}

/** GET single process item — fills fields preference/report still miss */
async function fetchTravelItemDetail(accountId, instanceId, activityInstanceId) {
    if (!accountId || !instanceId) return null
    const base = `/process/2/${accountId}/Travel_Management_A02/${instanceId}`
    if (activityInstanceId) {
        const withAct = await safeApi(`${base}/${activityInstanceId}?_application_id=${APP_ID}`)
        if (withAct && typeof withAct === 'object') return withAct
    }
    return safeApi(`${base}?_application_id=${APP_ID}`)
}

/** Copy travel report columns onto pending rows (Trip Type, Departure_Date, MC route/amount). */
function enrichTravelPendingRowWithReport(pendingRow, reportRow) {
    if (!reportRow || typeof reportRow !== 'object') return pendingRow
    const next = { ...pendingRow }
    const alwaysKeys = [
        TRAVEL_FIELD_IDS.travelType,
        TRAVEL_FIELD_IDS.departureDate,
        TRAVEL_FIELD_IDS.mcRouteSummary,
        TRAVEL_FIELD_IDS.mcBookingAmount,
    ]
    for (const key of alwaysKeys) {
        if (reportRow[key] != null && reportRow[key] !== '') {
            next[key] = reportRow[key]
        }
    }
    for (const key of [
        TRAVEL_FIELD_IDS.requestId,
        TRAVEL_FIELD_IDS.requestor,
        TRAVEL_FIELD_IDS.from,
        TRAVEL_FIELD_IDS.to,
        TRAVEL_FIELD_IDS.bookingAmount,
        TRAVEL_FIELD_IDS.currentStep,
        TRAVEL_FIELD_IDS.slaDeadline,
        TRAVEL_FIELD_IDS.departureDateLegacy,
    ]) {
        const reportVal = reportRow[key]
        if (reportVal === undefined || reportVal === null || reportVal === '') continue
        const pendingVal = next[key]
        if (pendingVal === undefined || pendingVal === null || pendingVal === '') {
            next[key] = reportVal
        }
    }
    return next
}

function buildAdvanceRowView(row) {
    const requestId =
        toText(row?.[ADVANCE_REPORT_FIELD_IDS.requestId]).trim() ||
        toText(row?.[ADVANCE_PENDING_FIELD_IDS.requestId]).trim() ||
        toText(row?._name || row?.Name).trim() ||
        '—'
    const requestedRaw =
        row?.[ADVANCE_REPORT_FIELD_IDS.requestedDate] ??
        row?.[ADVANCE_PENDING_FIELD_IDS.requestedDate] ??
        null
    const requestedDateStr =
        (requestedRaw !== undefined && requestedRaw !== null && requestedRaw !== ''
            ? toDateText(extractDateTimeRaw(requestedRaw) ?? requestedRaw)
            : '') || toDateText(row?._created_at)
    // Same column as employee: Column_ctQorHPmAU (with pending FieldId fallback)
    const linkToTravelText = formatLinkToTravel(
        row?.[ADVANCE_REPORT_FIELD_IDS.linkToTravel] ??
            row?.[ADVANCE_PENDING_FIELD_IDS.linkToTravel] ??
            row?.List_of_Travel_Requests_lookup,
    )
    const requestorText = toText(
        row?.[ADVANCE_REPORT_FIELD_IDS.requestor] ??
            row?.[ADVANCE_PENDING_FIELD_IDS.requestor],
    ).trim()
    const advanceAmount = toNumber(
        row?.[ADVANCE_REPORT_FIELD_IDS.advanceAmount] ??
            row?.[ADVANCE_PENDING_FIELD_IDS.advanceAmount] ??
            row?.Advance_Amount ??
            row?.['Column_t1eY-VJcss'],
    )
    const currentStep = extractCurrentStepText(
        row,
        ADVANCE_REPORT_FIELD_IDS.currentStep || ADVANCE_PENDING_FIELD_IDS.currentStep,
    )

    const slaRaw = extractSlaDeadlineRaw(row, ADVANCE_REPORT_FIELD_IDS.slaDeadline, [
        ADVANCE_PENDING_FIELD_IDS.slaDeadline,
        'SLA_Deadline',
        'Column_Wc-2EfDPkD',
    ])
    const deadlineAtMs = dateRawToMs(slaRaw)
    const deadlineText =
        slaRaw != null && hasUsableDateTimeCell(slaRaw) ? formatDeadlineCell(slaRaw) : ''
    const windowStartAtMs =
        dateRawToMs(requestedRaw) ?? dateRawToMs(row?._created_at) ?? dateRawToMs(row?._modified_at) ?? null
    const listSortMs =
        dateRawToMs(row?._modified_at) ?? dateRawToMs(row?._created_at) ?? windowStartAtMs ?? deadlineAtMs ?? 0

    return {
        requestId,
        requestedDateStr,
        requestorText,
        linkToTravelText,
        advanceAmount,
        currentStep,
        deadlineText,
        deadlineAtMs,
        windowStartAtMs,
        listSortMs,
    }
}

function buildTravelRowView(row) {
    const requestId =
        toText(readTravelField(row, 'requestId')).trim() || toText(row?._name || row?.Name).trim() || '—'

    const travelTypeKey = normalizeTravelTypeKey(readTravelTypeRaw(row))
    const isMultiCity = travelTypeKey === 'multiCity'
    const tripTypeLabel = travelTypeLabel(travelTypeKey)

    const departureRaw = readTravelDeparture(row)
    const departureDateStr = formatDepartureDateDisplay(departureRaw) || '—'

    const routeSummary = toText(
        readTravelField(row, 'mcRouteSummary') ?? row?.MC_Route_Summary ?? row?.mc_route_summary,
    ).trim()
    const fromText = isMultiCity
        ? routeSummary || toText(readTravelFrom(row)).trim() || '—'
        : toText(readTravelFrom(row)).trim() || '—'
    const toTextValue = isMultiCity ? '' : toText(readTravelTo(row)).trim() || '—'

    const bookingAmount = isMultiCity
        ? toNumber(
              firstFilled(
                  readTravelField(row, 'mcBookingAmount'),
                  row?.mc_total_booking_amount,
                  readTravelAmount(row),
              ),
          )
        : toNumber(readTravelAmount(row))

    const requestorText = toText(readTravelField(row, 'requestor')).trim()
    const currentStep = extractCurrentStepText(row, TRAVEL_FIELD_IDS.currentStep)

    const slaRaw = extractSlaDeadlineRaw(row, TRAVEL_FIELD_IDS.slaDeadline, [TRAVEL_PENDING_FIELD_IDS.slaDeadline])
    const deadlineAtMs = dateRawToMs(slaRaw)
    const deadlineText = slaRaw != null && slaRaw !== '' ? formatDeadlineCell(slaRaw) : ''
    const windowStartAtMs = dateRawToMs(departureRaw) ?? dateRawToMs(row?._created_at) ?? dateRawToMs(row?._modified_at) ?? null
    const listSortMs =
        dateRawToMs(row?._created_at) ??
        dateRawToMs(row?._modified_at) ??
        windowStartAtMs ??
        deadlineAtMs ??
        0

    return {
        requestId,
        travelTypeKey,
        tripTypeLabel,
        isMultiCity,
        departureDateStr,
        requestorText,
        fromText,
        toTextValue,
        routeSummary: routeSummary || fromText,
        bookingAmount,
        currentStep,
        deadlineText,
        deadlineAtMs,
        windowStartAtMs,
        listSortMs,
    }
}

/** Aligns with SlaCell / employee dashboard: about-to-end first, then breached. */
const SLA_ABOUT_TO_END_MS = 24 * 60 * 60 * 1000

/**
 * Pending list order (same as employee-dashboard-v2):
 * 1. SLA about to end (<24h left) — soonest deadline first
 * 2. Breached SLA — most recently breached first
 * 3. Safe SLA (≥24h left) — soonest deadline first
 * 4. No SLA
 * Tie-break: most recently created first.
 */
function comparePendingBySlaThenRecent(a, b) {
    const now = Date.now()
    const rankA = getSlaSortRank(a, now)
    const rankB = getSlaSortRank(b, now)

    if (rankA.bucket !== rankB.bucket) return rankA.bucket - rankB.bucket
    if (rankA.urgencyMs !== rankB.urgencyMs) return rankA.urgencyMs - rankB.urgencyMs
    return (b?.listSortMs || 0) - (a?.listSortMs || 0)
}

function classifySlaBucket(deadlineAtMs, now = Date.now()) {
    if (deadlineAtMs == null || !Number.isFinite(deadlineAtMs)) return 'none'
    if (now > deadlineAtMs) return 'breached'
    if (deadlineAtMs <= now + NEARING_SLA_MS) return 'nearing'
    return 'safe'
}

function rowMatchesInsight(entry, insightFilter, tabKey) {
    const bucket = insightFilter?.bucket
    if (!bucket || bucket === 'pending') return true
    if (bucket === 'exception') {
        const excId = EXCEPTION_FIELD_ID[tabKey]
        return !!(excId && isYesLike(entry?.row?.[excId] ?? entry?.[excId]))
    }
    return classifySlaBucket(entry?.deadlineAtMs) === bucket
}

function getSlaSortRank(entry, now) {
    const deadline = entry?.deadlineAtMs
    const created = entry?.listSortMs || 0

    if (deadline == null || !Number.isFinite(deadline)) {
        return { bucket: 3, urgencyMs: Number.POSITIVE_INFINITY, created }
    }

    if (now > deadline) {
        return { bucket: 1, urgencyMs: now - deadline, created }
    }

    const remaining = deadline - now
    if (remaining < SLA_ABOUT_TO_END_MS) {
        return { bucket: 0, urgencyMs: remaining, created }
    }

    return { bucket: 2, urgencyMs: remaining, created }
}

/** @deprecated Prefer comparePendingBySlaThenRecent — kept for any leftover callers. */
function compareRowsRecentFirst(a, b) {
    return comparePendingBySlaThenRecent(a, b)
}

function extractPopupIds(row) {
    const firstCtx = Array.isArray(row?._current_context) && row._current_context.length ? row._current_context[0] : null
    const instanceId =
        row?.Column_RzqotquBQV ||
        row?._id ||
        row?.InstanceId ||
        row?.instance_id ||
        ''
    const activityId =
        row?.Column_eFd2LUqnSP ||
        row?._activity_instance_id ||
        row?._context_activity_instance_id ||
        row?._activityInstanceId ||
        row?._activity_id ||
        row?._context_activity_id ||
        firstCtx?._context_activity_instance_id ||
        firstCtx?._context_activity_id ||
        ''

    return {
        instanceId: instanceId ? String(instanceId) : '',
        activityId: activityId ? String(activityId) : '',
    }
}

function isPendingStatus(text) {
    const s = String(text || '').toLowerCase()
    if (!s) return true
    if (s.includes('reject') || s.includes('cancel') || s.includes('complete') || s.includes('approve') || s.includes('booked') || s.includes('paid')) return false
    return s.includes('pending') || s.includes('progress') || s.includes('review') || s.includes('approval') || s.includes('desk')
}

function statusRawForTabRow(row, tabKey) {
    if (tabKey === 'expense') return row?.[EXPENSE_STATUS_COL_ID] ?? row?._status
    return row?._status
}

function parseAssignees(val) {
    if (!val) return []
    if (Array.isArray(val)) return val
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val)
            return Array.isArray(parsed) ? parsed : [parsed]
        } catch {
            return [{ Name: val }]
        }
    }
    if (typeof val === 'object') return [val]
    return []
}

function normalizeName(v) {
    return String(v || '').trim().toLowerCase()
}

function normalizeAssigneeLabel(v) {
    const s = normalizeName(v)
    if (!s) return ''
    return s
        .replace(/^role\s*:\s*/i, '')
        .replace(/\(role\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function nameMatchesAnyRole(assigneeNameLower, rolesLower) {
    const a = normalizeAssigneeLabel(assigneeNameLower)
    if (!a) return false
    const roles = (Array.isArray(rolesLower) ? rolesLower : [rolesLower]).map(normalizeName).filter(Boolean)
    if (!roles.length) return false
    return roles.some((rRaw) => {
        const r = normalizeAssigneeLabel(rRaw)
        return r && (r === a || r.includes(a) || a.includes(r))
    })
}

function getAssignedToValue(row) {
    const firstCtx = Array.isArray(row?._current_context) && row._current_context.length ? row._current_context[0] : null
    return (
        row?._current_assigned_to ??
        firstCtx?._current_assigned_to ??
        row?.currentlu_assigned_to ?? // legacy seen in mis-table
        row?.currently_assigned_to ??
        row?.Currently_assigned_to ??
        row?.Current_Assigned_To
    )
}

function isRowAssignedToMeOrMyRoles(row, rolesLower) {
    const assignees = parseAssignees(getAssignedToValue(row))
    if (!assignees.length) return true

    const userId = String(kf?.user?._id || kf?.user?.Id || kf?.user?.id || '').trim()
    const userName = normalizeName(kf?.user?.Name || kf?.user?.name || '')

    return assignees.some((a) => {
        const aId = String(a?._id || a?.Id || a?.id || '').trim()
        if (userId && aId && aId === userId) return true

        const aName = normalizeAssigneeLabel(
            a?.RoleName ||
                a?.roleName ||
                a?.Role ||
                a?.role ||
                a?.Name ||
                a?.name ||
                (typeof a === 'string' ? a : '')
        )
        if (!aName) return false

        // Kissflow sometimes does not mark role assignees with Type/kind.
        // Prefer matching by role-name vs current user's roles.
        if (nameMatchesAnyRole(aName, rolesLower)) return true

        // If API returns only names (no ids), still allow direct user-name matches.
        return userName && (aName === userName || aName.includes(userName) || userName.includes(aName))
    })
}

/** Tab badge count = sum of allowed pending steps for the role. */
async function countTabPendingForRole(accountId, tab, roleLower) {
    // Follow role-mis-table flow: pending step count endpoint without appId param
    const url = `/process/2/${accountId}/${tab.processId}/pending/activity/count`
    const resp = await safeApi(url)
    const steps = normalizeStepsList(resp)
    return steps
        .reduce((sum, s) => sum + (Number(s?.Count) || 0), 0)
}

function PendingApprovalsWidgetInner({
    onPopupClosed,
    onSummaryChange,
    insightFilter = null,
    onClearInsight,
    period: periodProp = null,
} = {}) {
    const accountId = useMemo(() => kf?.account?._id, [])
    const appRoles = Array.isArray(kf?.user?.AppRoles)
        ? kf.user.AppRoles
        : Array.isArray(kf?.user?.Roles)
          ? kf.user.Roles
          : Array.isArray(kf?.user?.roles)
            ? kf.user.roles
            : []
    const rolesLower = (Array.isArray(appRoles) ? appRoles : [])
        .map((r) =>
            typeof r === 'string'
                ? r
                : r && typeof r === 'object'
                  ? r.Name || r.name || ''
                  : ''
        )
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
    const [activeKey, setActiveKey] = useState('travel')
    const [counts, setCounts] = useState({ expense: 0, advance: 0, travel: 0 })
    /** False until first counts/activity scan finishes — keeps skeleton up (avoids empty flash). */
    const [countsReady, setCountsReady] = useState(false)
    const visibleTabs = useMemo(() => TABS.filter((t) => (counts?.[t.key] ?? 0) > 0), [counts])
    const activeTab = useMemo(() => visibleTabs.find((t) => t.key === activeKey) || visibleTabs[0] || null, [visibleTabs, activeKey])
    const activeTabKey = activeTab?.key || activeKey
    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState([])
    const [cols, setCols] = useState([])
    const [rawCols, setRawCols] = useState([])
    const [tabActivityIds, setTabActivityIds] = useState({ expense: '', advance: '', travel: '' })
    const [tabInstanceActivityMap, setTabInstanceActivityMap] = useState({ expense: {}, advance: {}, travel: {} })
    const [error, setError] = useState('')
    const [searchId, setSearchId] = useState('')
    const [periodLocal, setPeriodLocal] = useState(() => getEmptyPeriodState())
    const period = periodProp || periodLocal
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 8
    const fetchSeqRef = useRef(0)

    const showSkeleton = !countsReady || loading
    const showGlobalEmpty = countsReady && !loading && visibleTabs.length === 0

    const [now, setNow] = useState(Date.now())
    useEffect(() => {
        const i = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(i)
    }, [])

    useEffect(() => {
        if (!visibleTabs.length) return
        if (!activeTab || !visibleTabs.some((t) => t.key === activeKey)) {
            setActiveKey(visibleTabs[0].key)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleTabs.length, counts])

    useEffect(() => {
        if (!insightFilter?.token) return
        if (insightFilter.processKey) {
            setActiveKey(insightFilter.processKey)
        }
        setCurrentPage(1)
        setSearchId('')
    }, [insightFilter?.token, insightFilter?.processKey])

    const markPopupOpened = () => {
        try {
            window.__KF_DASH_POPUP_SEQ__ = Number(window.__KF_DASH_POPUP_SEQ__ || 0) + 1
            window.__KF_DASH_POPUP_OPENED_AT__ = Date.now()
        } catch {
            // ignore
        }
    }

    const scanTabPendingSummary = async (t, expenseReportMap) => {
        const nextId = { key: t.key, activityId: '', map: {}, pending: 0, nearingSla: 0, breachedSla: 0, exception: 0 }
        const tNow = Date.now()
        const url = `/process/2/${accountId}/${t.processId}/pending/activity/count`
        const resp = await safeApi(url)
        const list = normalizeStepsList(resp)
        const first = Array.isArray(list) ? list.find((x) => x?._id) : null
        nextId.activityId = first?._id ? String(first._id) : ''

        if (Array.isArray(list)) {
            await Promise.all(
                list.map(async (act) => {
                    const activityId = act?._id
                    if (!activityId) return

                    const prefCols = PREFERENCE_COLUMNS?.[t.key] || []
                    if (prefCols.length) {
                        await postWorkflowStepPreference({
                            accountId,
                            processId: t.processId,
                            viewId: activityId,
                            columns: prefCols,
                        })
                    }

                    for (let page = 1; page <= MAX_PAGES; page++) {
                        const pendingUrl = `/process/2/${accountId}/${t.processId}/pending/${activityId}?_application_id=${APP_ID}&page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=true&skip_aggregation=true`
                        const pendingResp = await safeApi(pendingUrl)
                        const pendingRows = pendingResp?.Data || pendingResp?.data || []
                        if (!Array.isArray(pendingRows) || !pendingRows.length) break

                        for (const r of pendingRows) {
                            const iId = r?._id ? String(r._id) : ''
                            const aId = r?._activity_instance_id ? String(r._activity_instance_id) : ''
                            if (iId && aId) nextId.map[iId] = aId

                            if (!isRowAssignedToMeOrMyRoles(r, rolesLower)) continue
                            nextId.pending += 1

                            const rowForSla =
                                t.key === 'expense' && iId && expenseReportMap?.get(iId)
                                    ? enrichExpensePendingRowWithReport(r, expenseReportMap.get(iId))
                                    : r

                            const excId = EXCEPTION_FIELD_ID[t.key]
                            if (excId && isYesLike(rowForSla?.[excId])) nextId.exception += 1
                            const slaRawForRow =
                                t.key === 'expense'
                                    ? extractSlaDeadlineRaw(rowForSla, EXPENSE_REPORT_FIELD_IDS.slaDeadline, [
                                          'SLA_Deadline',
                                      ])
                                    : extractSlaDeadlineRaw(r, 'SLA_Deadline')
                            const deadlineMs = dateRawToMs(slaRawForRow)
                            if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) continue
                            if (deadlineMs < tNow) nextId.breachedSla += 1
                            else if (deadlineMs <= tNow + NEARING_SLA_MS) nextId.nearingSla += 1
                        }

                        if (pendingRows.length < PAGE_SIZE) break
                    }
                }),
            )
        }

        // Activity-id fallback from myitems (popup open) — parallel pages already sequential; keep light.
        for (let page = 1; page <= MAX_PAGES; page++) {
            const myItemsUrl = `/process/2/${accountId}/${t.processId}/myitems?apply_preference=true&skip_aggregation=true&page_number=${page}&page_size=${PAGE_SIZE}`
            let myItemsResp
            try {
                myItemsResp = await kf.api(myItemsUrl)
            } catch {
                break
            }
            const myItemsRows = myItemsResp?.Data || myItemsResp?.data || []
            if (!Array.isArray(myItemsRows) || !myItemsRows.length) break
            for (const item of myItemsRows) {
                const iId = item?._id ? String(item._id) : ''
                const aId = item?._activity_instance_id ? String(item._activity_instance_id) : ''
                if (iId && aId && !nextId.map[iId]) nextId.map[iId] = aId
            }
            if (myItemsRows.length < PAGE_SIZE) break
        }

        return nextId
    }

    const fetchTabActivityIds = async () => {
        if (!accountId) return
        setLoading(true)
        setCountsReady(false)
        setError('')
        try {
            const expenseReportMap = await fetchExpenseAllItemsReportMap(accountId)
            const results = await Promise.all(TABS.map((t) => scanTabPendingSummary(t, expenseReportMap)))

            const next = { expense: '', advance: '', travel: '' }
            const maps = { expense: {}, advance: {}, travel: {} }
            const pending = { expense: 0, advance: 0, travel: 0 }
            const nearingSla = { expense: 0, advance: 0, travel: 0 }
            const breachedSla = { expense: 0, advance: 0, travel: 0 }
            const exception = { expense: 0, advance: 0, travel: 0 }

            for (const r of results) {
                next[r.key] = r.activityId
                maps[r.key] = r.map
                pending[r.key] = r.pending
                nearingSla[r.key] = r.nearingSla
                breachedSla[r.key] = r.breachedSla
                exception[r.key] = r.exception
            }

            setTabActivityIds(next)
            setTabInstanceActivityMap(maps)
            setCounts(pending)
            if (typeof onSummaryChange === 'function') {
                onSummaryChange({ pendingCounts: pending, nearingSla, breachedSla, exception })
            }

            const anyPending = TABS.some((t) => (pending[t.key] || 0) > 0)
            if (!anyPending) setLoading(false)
            // If tabs exist, keep skeleton until list fetch finishes.
        } catch (e) {
            console.warn('Pending activity id fetch failed:', e)
            setLoading(false)
        } finally {
            setCountsReady(true)
        }
    }

    const fetchMyTasksListForTab = async (tab) => {
        if (!accountId || !tab) return
        const seq = ++fetchSeqRef.current
        setLoading(true)
        setError('')
        try {
            const stepsUrl = `/process/2/${accountId}/${tab.processId}/pending/activity/count`
            const stepsResp = await safeApi(stepsUrl)
            const steps = normalizeStepsList(stepsResp)

            const prefCols = PREFERENCE_COLUMNS?.[tab.key] || []
            const allRows = []
            let visibleCols = []
            let allCols = []

            for (const step of steps) {
                const activityId = step?._id
                if (!activityId) continue

                if (prefCols.length) {
                    await postWorkflowStepPreference({ accountId, processId: tab.processId, viewId: activityId, columns: prefCols })
                }

                for (let page = 1; page <= MAX_PAGES; page++) {
                    const dataUrl = `/process/2/${accountId}/${tab.processId}/pending/${activityId}?apply_preference=true&page_number=${page}&page_size=${PAGE_SIZE}&skip_aggregation=true&_application_id=${APP_ID}`
                    const resp = await safeApi(dataUrl)
                    const pageRows = resp?.Data || resp?.data || []

                    if (!visibleCols.length) {
                        allCols = resp?.Columns || []
                        visibleCols = allCols.filter((c) => !HIDDEN_COLUMNS.includes(c.Id))
                    }

                    if (!Array.isArray(pageRows) || !pageRows.length) break
                    const filtered = pageRows.filter((row) => isRowAssignedToMeOrMyRoles(row, rolesLower))
                    allRows.push(...filtered)
                    if (pageRows.length < PAGE_SIZE) break
                }
            }

            if (seq !== fetchSeqRef.current) return

            setCols(visibleCols)
            setRawCols(allCols)

            if (tab.key === 'expense' && allRows.length) {
                const reportMap = await fetchExpenseAllItemsReportMap(accountId)
                if (seq !== fetchSeqRef.current) return
                setRows(
                    allRows.map((row) => {
                        const id = String(row?._id || '').trim()
                        return enrichExpensePendingRowWithReport(row, id ? reportMap.get(id) : null)
                    }),
                )
            } else if (tab.key === 'advance' && allRows.length) {
                const reportMap = await fetchAdvanceAllItemsReportMap(accountId)
                if (seq !== fetchSeqRef.current) return
                setRows(
                    allRows.map((row) => {
                        const id = String(row?._id || '').trim()
                        return enrichAdvancePendingRowWithReport(row, id ? reportMap.get(id) : null)
                    }),
                )
            } else if (tab.key === 'travel' && allRows.length) {
                const reportMap = await fetchTravelAllItemsReportMap(accountId)
                if (seq !== fetchSeqRef.current) return
                const enriched = allRows.map((row) => {
                    const id = String(row?._id || '').trim()
                    return enrichTravelPendingRowWithReport(row, id ? reportMap.get(id) : null)
                })

                // Cap per-item GETs so a large queue doesn't stall the table.
                const needDetail = enriched
                    .map((row, idx) => ({ row, idx }))
                    .filter(({ row }) => travelRowNeedsDetail(row))
                    .slice(0, 25)
                if (needDetail.length) {
                    await Promise.all(
                        needDetail.map(async ({ row, idx }) => {
                            const instanceId = String(row?._id || '').trim()
                            const activityId = String(
                                row?._activity_instance_id || row?._context_activity_instance_id || '',
                            ).trim()
                            const detail = await fetchTravelItemDetail(accountId, instanceId, activityId)
                            if (detail && typeof detail === 'object') {
                                enriched[idx] = enrichTravelPendingRowWithReport(
                                    { ...detail, ...row, ...fillMissingFrom(row, detail) },
                                    reportMap.get(instanceId),
                                )
                            }
                        }),
                    )
                    if (seq !== fetchSeqRef.current) return
                }
                setRows(enriched)
            } else {
                setRows(allRows)
            }
        } catch (e) {
            if (seq !== fetchSeqRef.current) return
            setError(e?.message || `Unable to fetch ${tab.label} items.`)
            setRows([])
            setCols([])
            setRawCols([])
        } finally {
            if (seq === fetchSeqRef.current) setLoading(false)
        }
    }

    useEffect(() => {
        if (!accountId) return
        fetchTabActivityIds()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId])

    useEffect(() => {
        // Wait until counts scan finishes — do NOT clear loading while activeTab is still null on boot.
        if (!accountId || !countsReady) return
        if (!activeTab) {
            setLoading(false)
            setError('')
            setRows([])
            return
        }
        fetchMyTasksListForTab(activeTab)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, countsReady, activeTab?.key])

    const resolveIdsFromListPayload = (row) => {
        const ids = extractPopupIds(row)
        if (ids.instanceId && ids.activityId) return ids

        const colsByPattern = (pattern) =>
            (rawCols || []).filter((c) => pattern.test(String(c?.Name || ''))).map((c) => c.Id)

        const instanceCandidates = [
            ...colsByPattern(/instance.*id|request.*id|item.*id|record.*id|^id$/i),
            'Column_RzqotquBQV',
        ]
        const activityCandidates = [
            ...colsByPattern(/activity.*instance.*id|activity.*id|task.*id|workflow.*id|work item.*id/i),
            'Column_eFd2LUqnSP',
        ]

        const getFirstValue = (candidateIds) => {
            for (const colId of candidateIds) {
                const value = row?.[colId]
                if (value !== null && value !== undefined && String(value).trim() !== '') {
                    return String(value)
                }
            }
            return ''
        }

        const resolvedInstanceId = ids.instanceId || getFirstValue(instanceCandidates)
        const mappedActivityId =
            resolvedInstanceId && tabInstanceActivityMap?.[activeTabKey]?.[resolvedInstanceId]
                ? String(tabInstanceActivityMap[activeTabKey][resolvedInstanceId])
                : ''

        return {
            instanceId: resolvedInstanceId,
            activityId: ids.activityId || getFirstValue(activityCandidates) || mappedActivityId,
        }
    }

    const getRowId = (row, idx) => row?._id || row?.Column_RzqotquBQV || `${activeTabKey || 'tab'}-${idx}`
    const filteredRows = useMemo(() => {
        const q = String(searchId || '').trim().toLowerCase()
        const base = !q ? rows : rows.filter((row, idx) => String(getRowId(row, idx)).toLowerCase().includes(q))

        // Only pending items in current step.
        const map = tabInstanceActivityMap?.[activeTabKey] || {}
        const assigned =
            !map || Object.keys(map).length === 0
                ? base
                : base.filter((row) => {
                      const { instanceId } = extractPopupIds(row)
                      return instanceId && Object.prototype.hasOwnProperty.call(map, instanceId)
                  })
        return assigned.filter((row) => requestedDateInPeriod(readRequestedAtMs(row, activeTabKey), period))
    }, [rows, searchId, activeTabKey, tabInstanceActivityMap, period])

    const filteredRowsWithBreach = filteredRows

    const expenseFieldIds = useMemo(() => resolveExpenseFieldIds(rawCols), [rawCols])

    const expenseViewRows = useMemo(() => {
        if (activeTabKey !== 'expense') return null
        const ids = expenseFieldIds || EMPTY_EXPENSE_FIELD_IDS
        const built = filteredRowsWithBreach.map((row) => {
            const view = buildExpenseRowView(row, ids)
            return { row, ...view }
        })
        built.sort(comparePendingBySlaThenRecent)
        if (!insightFilter?.bucket || insightFilter.bucket === 'pending') return built
        return built.filter((entry) => rowMatchesInsight(entry, insightFilter, 'expense'))
    }, [filteredRowsWithBreach, activeTabKey, expenseFieldIds, insightFilter?.bucket, insightFilter?.token])

    const advanceViewRows = useMemo(() => {
        if (activeTabKey !== 'advance') return null
        const built = filteredRowsWithBreach.map((row) => ({ row, ...buildAdvanceRowView(row) }))
        built.sort(comparePendingBySlaThenRecent)
        if (!insightFilter?.bucket || insightFilter.bucket === 'pending') return built
        return built.filter((entry) => rowMatchesInsight(entry, insightFilter, 'advance'))
    }, [filteredRowsWithBreach, activeTabKey, insightFilter?.bucket, insightFilter?.token])

    const travelViewRows = useMemo(() => {
        if (activeTabKey !== 'travel') return null
        const built = filteredRowsWithBreach.map((row) => ({ row, ...buildTravelRowView(row) }))
        built.sort(comparePendingBySlaThenRecent)
        if (!insightFilter?.bucket || insightFilter.bucket === 'pending') return built
        return built.filter((entry) => rowMatchesInsight(entry, insightFilter, 'travel'))
    }, [filteredRowsWithBreach, activeTabKey, insightFilter?.bucket, insightFilter?.token])

    const paginationLength =
        activeTabKey === 'expense' && expenseViewRows != null
            ? expenseViewRows.length
            : activeTabKey === 'advance' && advanceViewRows != null
              ? advanceViewRows.length
              : activeTabKey === 'travel' && travelViewRows != null
                ? travelViewRows.length
                : filteredRowsWithBreach.length
    const totalPages = Math.max(1, Math.ceil(paginationLength / pageSize))
    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        if (activeTabKey === 'expense' && expenseViewRows) {
            return expenseViewRows.slice(start, start + pageSize)
        }
        if (activeTabKey === 'advance' && advanceViewRows) {
            return advanceViewRows.slice(start, start + pageSize)
        }
        if (activeTabKey === 'travel' && travelViewRows) {
            return travelViewRows.slice(start, start + pageSize)
        }
        return filteredRowsWithBreach.slice(start, start + pageSize)
    }, [filteredRowsWithBreach, activeTabKey, expenseViewRows, advanceViewRows, travelViewRows, currentPage, pageSize])

    useEffect(() => {
        setCurrentPage(1)
        setSearchId('')
    }, [activeTab?.key])

    useEffect(() => {
        setCurrentPage(1)
    }, [period?.mode, period?.summaryLabel, period?.range?.from, period?.range?.to])

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages)
    }, [currentPage, totalPages])

    const handleRowClick = async (row) => {
        const { instanceId, activityId } = resolveIdsFromListPayload(row)
        if (!instanceId) {
            console.warn('Pending Approvals: missing popup ids', {
                tab: activeTabKey,
                instanceId,
                activityId,
                row,
            })
            kf?.client?.showInfo?.('Unable to open details for this record.')
            return
        }
        const activityInstanceId = activityId || ''
        const fallbackActivityId = tabActivityIds[activeTabKey] || ''
        const resolvedActivityId = activityInstanceId || fallbackActivityId
        if (!resolvedActivityId) {
            console.warn('Pending Approvals: missing activity instance id', {
                tab: activeTabKey,
                instanceId,
                row,
            })
            kf?.client?.showInfo?.('Unable to open this record: missing workflow activity context.')
            return
        }

        try {
            markPopupOpened()
            if (!activeTab?.popup) {
                kf?.client?.showInfo?.('Unable to open details: process context not available.')
                return
            }
            const p = kf.app.page.openPopup(activeTab.popup, {
                ActivityID: resolvedActivityId,
                InstanceId: instanceId,
                ActivityInstanceId: activityInstanceId || resolvedActivityId,
                ActivityId: resolvedActivityId,
                activityId: resolvedActivityId,
                // Compatibility aliases
                InstanceID: instanceId,
            instance_id: instanceId,
                activity_instance_id: activityInstanceId || resolvedActivityId,
                width: 960,
                height: 720,
                popupWidth: '960px',
                popupHeight: '720px',
            })
            if (p && typeof p.catch === 'function') {
                p.catch((e) => {
                    console.error('Pending Approvals popup open failed', e)
                    kf?.client?.showInfo?.('Unable to open details popup.')
                })
            }
            // Parent dashboard refreshes on focus/visibility regain.
            if (typeof onPopupClosed === 'function') setTimeout(() => onPopupClosed(), 1500)
        } catch (e) {
            console.error('Pending Approvals popup open failed', e)
            kf?.client?.showInfo?.('Unable to open details popup.')
        }
    }

    const tableAccent = activeTab?.color || '#1E88E5'

    return (
        <div
            className={`records-panel overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_12px_30px_rgba(76,98,168,0.12)] sm:rounded-2xl lg:rounded-3xl${insightFilter?.pulse ? ' is-insight-pulse' : ''}${insightFilter?.bucket ? ' is-insight-filtered' : ''}`}
            style={{ '--records-accent': tableAccent }}
        >
            <div className="records-header flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-white to-[#EEF4FF] px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="records-title-icon flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white sm:h-12 sm:w-12">
                            <img src={customPendingRequestsIcon} alt="" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-[15px] font-semibold text-slate-900 sm:text-base">Pending Requests</h3>
                            <p className="text-[11px] text-slate-500 sm:text-xs">
                                {insightFilter?.label
                                    ? `Showing ${insightFilter.label}`
                                    : 'Team tasks waiting for your action · all processes'}
                            </p>
                        </div>
                        {insightFilter?.label ? (
                            <button
                                type="button"
                                className="records-insight-clear"
                                onClick={() => onClearInsight?.()}
                            >
                                Clear filter
                            </button>
                        ) : null}
                    </div>
                </div>

                {visibleTabs.length > 0 ? (
                    <div className="w-full overflow-x-auto hide-scrollbar">
                        <div className="records-process-tabs inline-flex w-full min-w-max items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/95 p-1 shadow-sm sm:rounded-xl">
                            {visibleTabs.map((tab) => {
                                const isActive = activeKey === tab.key
                                return (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => setActiveKey(tab.key)}
                                        className={`records-process-tab btn-press ${isActive ? 'is-active' : ''}`}
                                        style={{ '--tab-color': tab.color, '--tab-glow': tab.glow }}
                                    >
                                        <span className="records-process-icon" aria-hidden="true">
                                            <span className="records-process-glow" />
                                            <span className="records-process-shine" />
                                            <img src={tab.icon} alt="" />
                                        </span>
                                        <span className="sm:hidden">{tab.short}</span>
                                        <span className="hidden sm:inline">{tab.label}</span>
                                        <span className="ml-1 opacity-80">({counts[tab.key] ?? 0})</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="p-3 sm:p-4 lg:p-5">
            <div className="mb-3">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm focus-within:border-[#2879b6] focus-within:ring-2 focus-within:ring-[#2879b6]/20 sm:rounded-xl sm:py-2">
                    <i className="ri-search-line text-base text-slate-400 sm:text-sm" />
                    <input
                        value={searchId}
                        onChange={(e) => {
                            setSearchId(e.target.value)
                            setCurrentPage(1)
                        }}
                        placeholder="Search by ID..."
                        className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none sm:text-xs"
                    />
                </div>
            </div>

            {showSkeleton ? (
                <div
                    className="rounded-xl overflow-hidden animate-pulse"
                    style={{
                        border: '1px solid rgba(226, 232, 240, 0.9)',
                        maxHeight: 5 * 52 + 44,
                    }}
                >
                    <div
                        style={{
                            height: 44,
                            borderBottom: '1px solid #EAECF0',
                            background: '#FCFCFD',
                            display: 'grid',
                            gridTemplateColumns:
                                activeKey === 'expense' || activeKey === 'advance' || activeKey === 'travel'
                                    ? 'minmax(100px,1fr) minmax(88px,0.8fr) minmax(96px,0.9fr) minmax(120px,1.05fr) 0.7fr minmax(100px,1fr) minmax(100px,1fr) minmax(120px,1.05fr)'
                                    : '1.2fr 1fr 1fr 1fr',
                            gap: 10,
                            padding: '10px 12px',
                        }}
                    >
                        {Array.from({ length: activeKey === 'expense' ? 8 : activeKey === 'advance' ? 6 : activeKey === 'travel' ? 9 : 4 }, (_, i) => (
                            <div key={`sk-h-${i}`} style={{ height: 12, borderRadius: 6, background: '#E5E7EB' }} />
                        ))}
                    </div>

                    <div style={{ background: '#FFFFFF' }}>
                        {[0, 1, 2, 3, 4].map((r) => (
                            <div
                                key={`sk-r-${r}`}
                                style={{
                                    height: 52,
                                    borderBottom: r === 4 ? 'none' : '1px solid #F2F4F7',
                                    display: 'grid',
                                    gridTemplateColumns:
                                        activeKey === 'expense' || activeKey === 'advance' || activeKey === 'travel'
                                            ? 'minmax(100px,1fr) minmax(88px,0.8fr) minmax(96px,0.9fr) minmax(120px,1.05fr) 0.7fr minmax(100px,1fr) minmax(100px,1fr) minmax(120px,1.05fr)'
                                            : '1.2fr 1fr 1fr 1fr',
                                    gap: 10,
                                    padding: '10px 12px',
                                    alignItems: 'center',
                                }}
                            >
                                {Array.from({ length: activeKey === 'expense' ? 8 : activeKey === 'advance' ? 6 : activeKey === 'travel' ? 9 : 4 }, (__, c) => (
                                    <div
                                        key={`sk-c-${r}-${c}`}
                                        style={{
                                            height: 10,
                                            borderRadius: 999,
                                            background: c === 0 ? '#E5E7EB' : '#EDF1F5',
                                            width: c === 0 ? '85%' : c === 6 || c === 3 ? '60%' : '75%',
                                        }}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            ) : error ? (
                <div className="text-xs p-3 rounded-lg" style={{ color: '#B42318', background: '#FFFBFA', border: '1px solid #FDA29B' }}>
                    {error}
                </div>
            ) : showGlobalEmpty ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/80 bg-white shadow-sm sm:h-14 sm:w-14">
                        <i className="ri-inbox-2-line text-xl text-slate-400 sm:text-2xl" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800">No pending tasks</p>
                    <p className="mt-1 text-xs text-slate-500">You don’t have any pending items assigned to you in Expense, Advance, or Booking.</p>
                    <div className="mt-2 text-[10px] text-slate-400">You’re all caught up.</div>
                </div>
            ) : filteredRowsWithBreach.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                    <p className="text-sm font-semibold text-slate-800">No matching pending records</p>
                    <p className="mt-1 text-xs text-slate-500">Try a different ID, or clear the search or date filter.</p>
                </div>
            ) : activeKey === 'expense' ? (
                <>
                <div
                    className="records-desktop-table rounded-xl overflow-x-auto overflow-y-auto"
                    style={{
                        border: '1px solid rgba(226, 232, 240, 0.9)',
                        maxHeight: 5 * 52 + 44,
                    }}
                >
                    <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 1020 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #EAECF0' }}>
                                {[
                                    { label: 'Expense ID', align: 'left' },
                                    { label: 'Request Date', align: 'left' },
                                    { label: 'Requestor', align: 'left' },
                                    { label: 'Expense Type', align: 'left' },
                                    { label: 'Total Amount', align: 'right' },
                                    { label: 'Current step', align: 'left' },
                                    { label: 'SLA', align: 'left' },
                                ].map((h) => (
                                    <th
                                        key={h.label}
                                        className="text-[10px] sm:text-xs font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap px-3 py-2.5"
                                        style={{
                                            textAlign: h.align,
                                            background: 'rgba(248, 250, 252, 0.95)',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                        }}
                                    >
                                        {h.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.map((entry, idx) => {
                                const tkey = normalizeExpenseTypeKey(entry.expenseType)
                                const cfg = EXPENSE_TYPE_STYLE[tkey] || EXPENSE_TYPE_STYLE.other
                                return (
                                    <tr
                                        key={getRowId(entry.row, idx)}
                                        onClick={() => handleRowClick(entry.row)}
                                        className="records-data-row cursor-pointer"
                                    >
                                        <td className="px-3 py-2.5 align-middle" style={{ fontSize: 12, color: '#101828' }}>
                                            <span
                                                className="record-id-badge inline-block max-w-[140px] truncate align-middle"
                                                title={entry.expenseId}
                                            >
                                                {entry.expenseId}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 align-middle text-[11px] sm:text-xs text-gray-500 whitespace-nowrap">
                                            {entry.requestDateStr || '—'}
                                        </td>
                                        <td className="px-3 py-2.5 align-middle max-w-[140px]">
                                            <span className="text-[11px] sm:text-xs text-gray-700 truncate block" title={entry.requestorText || ''}>
                                                {entry.requestorText || '—'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 align-middle">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="record-type-icon">
                                                    <i className={`${cfg.icon} text-white text-sm`} />
                                                </div>
                                                <span className="record-type-label truncate min-w-0">
                                                    {entry.expenseType}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 align-middle text-right">
                                            <span className="record-amount">{formatINR(entry.totalAmount)}</span>
                                        </td>
                                        <td className="px-3 py-2.5 align-top max-w-[200px]">
                                            <CurrentStepBadges text={entry.currentStep} size="sm" accent={tableAccent} />
                                        </td>
                                        <td className="px-3 py-2.5 align-top">
                                            <SlaCell deadlineAtMs={entry.deadlineAtMs} deadlineLabel={entry.deadlineText} size="sm" />
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="records-mobile-cards space-y-2.5">
                    {paginatedRows.map((entry, idx) => (
                        <ExpenseMobileCard
                            key={getRowId(entry.row, idx)}
                            entry={entry}
                            accent={tableAccent}
                            onOpen={() => handleRowClick(entry.row)}
                        />
                    ))}
                </div>
                </>
            ) : activeKey === 'advance' ? (
                <>
                <div
                    className="records-desktop-table rounded-xl overflow-x-auto overflow-y-auto"
                    style={{
                        border: '1px solid rgba(226, 232, 240, 0.9)',
                        maxHeight: 5 * 52 + 44,
                    }}
                >
                    <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 980 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #EAECF0' }}>
                                {[
                                    // { label: 'Request ID', align: 'left' },
                                    { label: 'Requested Date', align: 'left' },
                                    { label: 'Requestor', align: 'left' },
                                    { label: 'Link To Travel', align: 'left' },
                                    { label: 'Advance Amount', align: 'right' },
                                    { label: 'Current step', align: 'left' },
                                    { label: 'SLA', align: 'left' },
                                ].map((h) => (
                                    <th
                                        key={h.label}
                                        className="text-[10px] sm:text-xs font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap px-3 py-2.5"
                                        style={{
                                            textAlign: h.align,
                                            background: 'rgba(248, 250, 252, 0.95)',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                        }}
                                    >
                                        {h.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.map((entry, idx) => (
                                <tr
                                    key={getRowId(entry.row, idx)}
                                    onClick={() => handleRowClick(entry.row)}
                                    className="records-data-row cursor-pointer"
                                >
                                    {/*
                                    <td className="px-3 py-2.5 align-middle" style={{ fontSize: 12, color: '#101828' }}>
                                        <span
                                            className="record-id-badge inline-block max-w-[160px] truncate align-middle"
                                            title={entry.requestId}
                                        >
                                            {entry.requestId}
                                        </span>
                                    </td>
                                    */}
                                    <td className="px-3 py-2.5 align-middle text-[11px] sm:text-xs text-gray-500 whitespace-nowrap">
                                        {entry.requestedDateStr || '—'}
                                    </td>
                                    <td className="px-3 py-2.5 align-middle max-w-[140px]">
                                        <span className="text-[11px] sm:text-xs text-gray-700 truncate block" title={entry.requestorText || ''}>
                                            {entry.requestorText || '—'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 align-middle max-w-[340px]">
                                        <span className="text-[11px] sm:text-xs text-gray-700 truncate block" title={entry.linkToTravelText}>
                                            {entry.linkToTravelText}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 align-middle text-right">
                                        <span className="record-amount">{formatINR(entry.advanceAmount)}</span>
                                    </td>
                                    <td className="px-3 py-2.5 align-top max-w-[220px]">
                                        <CurrentStepBadges text={entry.currentStep} size="sm" accent={tableAccent} />
                                    </td>
                                    <td className="px-3 py-2.5 align-top">
                                        <SlaCell deadlineAtMs={entry.deadlineAtMs} deadlineLabel={entry.deadlineText} size="sm" />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="records-mobile-cards space-y-2.5">
                    {paginatedRows.map((entry, idx) => (
                        <AdvanceMobileCard
                            key={getRowId(entry.row, idx)}
                            entry={entry}
                            accent={tableAccent}
                            onOpen={() => handleRowClick(entry.row)}
                        />
                    ))}
                </div>
                </>
            ) : activeKey === 'travel' ? (
                <>
                <div
                    className="records-desktop-table rounded-xl overflow-x-auto overflow-y-auto"
                    style={{
                        border: '1px solid rgba(226, 232, 240, 0.9)',
                        maxHeight: 5 * 52 + 44,
                    }}
                >
                    <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 1080 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #EAECF0' }}>
                                {[
                                    // { label: 'Request ID', align: 'left' },
                                    { label: 'Requestor', align: 'left' },
                                    { label: 'Trip Type', align: 'left' },
                                    { label: 'Departure Date', align: 'left' },
                                    { label: 'Source (From)', align: 'left' },
                                    { label: '', align: 'center', key: 'route-icon' },
                                    { label: 'Destination (To)', align: 'left' },
                                    { label: 'Booking Amount', align: 'right' },
                                    { label: 'Current step', align: 'left' },
                                    { label: 'SLA', align: 'left' },
                                ].map((h) => (
                                    <th
                                        key={h.key || h.label}
                                        className="text-[10px] sm:text-xs font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap px-3 py-2.5"
                                        style={{
                                            textAlign: h.align,
                                            background: 'rgba(248, 250, 252, 0.95)',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                        }}
                                    >
                                        {h.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.map((entry, idx) => (
                                <tr
                                    key={getRowId(entry.row, idx)}
                                    onClick={() => handleRowClick(entry.row)}
                                    className="records-data-row cursor-pointer"
                                >
                                    {/*
                                    <td className="px-3 py-2.5 align-middle" style={{ fontSize: 12, color: '#101828' }}>
                                        <span
                                            className="record-id-badge inline-block max-w-[160px] truncate align-middle"
                                            title={entry.requestId}
                                        >
                                            {entry.requestId}
                                        </span>
                                    </td>
                                    */}
                                    <td className="px-3 py-2.5 align-middle max-w-[140px]">
                                        <span className="text-[11px] sm:text-xs text-gray-700 truncate block" title={entry.requestorText || ''}>
                                            {entry.requestorText || '—'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                                        <span className="travel-type-badge">
                                            {entry.tripTypeLabel}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 align-middle text-[11px] sm:text-xs text-gray-500 whitespace-nowrap">
                                        {entry.departureDateStr || '—'}
                                    </td>
                                    {(() => {
                                        const route = splitTravelRoute(entry)
                                        return (
                                            <>
                                                <td className="px-3 py-2.5 align-middle">
                                                    <span className="text-[11px] sm:text-xs font-semibold text-gray-700" title={entry.routeSummary || route.from}>
                                                        {route.from}
                                                    </span>
                                                </td>
                                                <td className="px-1 py-2.5 align-middle text-center">
                                                    <TripRouteIcon tripTypeKey={entry.travelTypeKey} label={entry.tripTypeLabel} />
                                                </td>
                                                <td className="px-3 py-2.5 align-middle">
                                                    <span className="text-[11px] sm:text-xs font-semibold text-gray-700" title={entry.routeSummary || route.to}>
                                                        {route.to}
                                                    </span>
                                                </td>
                                            </>
                                        )
                                    })()}
                                    <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                                        <span className="record-amount">
                                            {formatINR(entry.bookingAmount)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 align-top max-w-[220px]">
                                        <CurrentStepBadges text={entry.currentStep} size="sm" accent={tableAccent} />
                                    </td>
                                    <td className="px-3 py-2.5 align-top">
                                        <SlaCell deadlineAtMs={entry.deadlineAtMs} deadlineLabel={entry.deadlineText} size="sm" />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="records-mobile-cards space-y-2.5">
                    {paginatedRows.map((entry, idx) => (
                        <TravelMobileCard
                            key={getRowId(entry.row, idx)}
                            entry={entry}
                            accent={tableAccent}
                            onOpen={() => handleRowClick(entry.row)}
                        />
                    ))}
                </div>
                </>
            ) : (
                <>
                <div
                    className="records-desktop-table rounded-xl overflow-x-auto overflow-y-auto"
                    style={{
                        border: '1px solid rgba(226, 232, 240, 0.9)',
                        maxHeight: 5 * 52 + 44,
                    }}
                >
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                        <thead>
                            <tr>
                                {cols.map((c) => (
                                    <th
                                        key={c.Id}
                                        className="text-[10px] sm:text-xs font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap px-3 py-2.5"
                                        style={{
                                            textAlign: 'left',
                                            background: 'rgba(248, 250, 252, 0.95)',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                        }}
                                    >
                                        {c.Name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.map((row, idx) => (
                                <tr
                                    key={getRowId(row, idx)}
                                    onClick={() => handleRowClick(row)}
                                    className="records-data-row cursor-pointer"
                                >
                                    {cols.map((c) => (
                                        <td
                                            key={c.Id}
                                            className="px-3 py-2.5 align-middle"
                                            style={{
                                                fontSize: 12,
                                                color: '#101828',
                                                maxWidth: 240,
                                            }}
                                        >
                                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {toText(row?.[c.Id]) || <span style={{ color: '#98A2B3' }}>—</span>}
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="records-mobile-cards space-y-2.5">
                    {paginatedRows.map((row, idx) => (
                        <GenericMobileCard
                            key={getRowId(row, idx)}
                            row={row}
                            cols={cols}
                            onOpen={() => handleRowClick(row)}
                        />
                    ))}
                </div>
                </>
            )}
            {!showSkeleton && !error && filteredRows.length > 0 && (
                <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <p className="text-[11px] sm:text-xs text-slate-500">
                        Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, paginationLength)} of {paginationLength}
                    </p>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="btn-press flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40"
                        >
                            <i className="ri-arrow-left-s-line" />
                        </button>
                        <span className="px-2 text-[11px] sm:text-xs text-slate-600">
                            {currentPage}/{totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="btn-press flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40"
                        >
                            <i className="ri-arrow-right-s-line" />
                        </button>
                    </div>
                </div>
            )}
            </div>
        </div>
    )
}

export default function PendingApprovalsWidget(props) {
    return (
        <WidgetErrorBoundary>
            <PendingApprovalsWidgetInner {...props} />
        </WidgetErrorBoundary>
    )
}

