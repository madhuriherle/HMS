/**
 * Centralized money formatting for HMS MMA.
 *
 * ALL user-visible amounts use the rupee sign, Indian digit grouping and two decimals:
 * ₹1,234.00, ₹10,00,000.50
 */
const FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (value) => {
  const n = Number(value);
  return `₹${FORMAT.format(Number.isFinite(n) ? n : 0)}`;
};

export default formatMoney;
