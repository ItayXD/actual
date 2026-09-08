export const AMAZON_TRANSACTIONS_URL =
  'https://www.amazon.com/cpe/yourpayments/transactions';

// Amazon charges land under a lot of different descriptors — "Amazon.com*RT4G9",
// "AMZN Mktp US*1A2B3", "AMZNMktplace", "Amazon Prime", "Amazon Fresh",
// "Amazon Web Services" — but they all start a word with "amazon" or "amzn",
// and every one of them shows up on the Amazon transactions page.
const AMAZON_PAYEE_REGEX = /\b(?:amazon|amzn)/i;

/**
 * True if any of the given names looks like an Amazon payee. Pass both the
 * payee name and the imported payee: renaming rules often replace one and not
 * the other.
 */
export function isAmazonPayee(
  ...names: Array<string | null | undefined>
): boolean {
  return names.some(name => !!name && AMAZON_PAYEE_REGEX.test(name));
}

export function openAmazonTransactions() {
  window.Actual?.openURLInBrowser(AMAZON_TRANSACTIONS_URL);
}
