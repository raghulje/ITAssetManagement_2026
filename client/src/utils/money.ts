/** Format amounts in Indian Rupees for Refex ITAM UI */
export function formatINR(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n)
}
