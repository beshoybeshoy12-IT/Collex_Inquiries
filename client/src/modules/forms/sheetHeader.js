/**
 * The facts printed above an inquiry sheet: who is being verified, and the
 * address the bank sent. They come from the case, not from the form, so the
 * investigator copies nothing by hand and the office types nothing twice.
 *
 * With no case (a blank sheet printed from the forms screen) the same labels
 * print over empty lines to be filled in by hand.
 *
 * @param {(key: string) => string} t
 * @param {any} [investigation]
 * @returns {{label: string, value?: string}[]}
 */
export function sheetHeader(t, investigation) {
  const customer = investigation?.customer;
  const phones = [customer?.mobile, customer?.altMobile, customer?.homePhone]
    .filter(Boolean)
    .join(' / ');

  return [
    { label: t('inquirySheet.customerName'), value: customer?.fullName },
    { label: t('inquirySheet.caseNumber'), value: investigation?.caseNumber },
    { label: t('inquirySheet.phone'), value: phones },
    { label: t('inquirySheet.applicationNumber'), value: investigation?.applicationNumber },
    { label: t('inquirySheet.bankAddress'), value: investigation?.addressLine },
    { label: t('inquirySheet.investigator'), value: investigation?.investigator?.fullName },
    // The client's own columns from its file ("Loan amount", "Branch"), as
    // they were when the case was imported.
    ...(investigation?.additionalData?.clientFields ?? []).map((field) => ({
      label: field.label,
      value: field.value,
    })),
  ];
}
