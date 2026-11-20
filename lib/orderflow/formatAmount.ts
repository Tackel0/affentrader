/** Keep up to twelve significant digits in orderflow readouts. */
export const formatOrderflowAmount = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 12 }).format;
