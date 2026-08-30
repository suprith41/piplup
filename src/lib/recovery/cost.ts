/**
 * Chasing money is not free. Vendors quote gross recovery and never net it
 * against what the chase cost. Indicative Indian channel prices, in paise.
 *
 * Nothing here decides what to send. The ladder in ./ladder.ts lays out the
 * steps, and both policies are priced off the steps they actually run.
 */
export const CHANNEL_COST_PAISE = {
  silent: 0,
  email: 5,
  sms: 20,
  whatsapp: 35,
  preDebitNotice: 20,
} as const;
