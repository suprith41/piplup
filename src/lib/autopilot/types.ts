export type QueueItem = {
  id: string;
  name: string;
  amount: string;
  amountPaise: number;
  decline: string;
  klass: string;
  rail: string;
  bank: string;
  course: string;
  live: boolean;
  linkUrl?: string;
  inbound?: string;
  promiseToPayDay?: number;
  claimedPaid?: boolean;
  parsedIntent?: string;
};

export type IngressEvent = {
  type: "ingress";
  at: string;
  caseId: string;
  name: string;
  amount: string;
  decline: string;
  rail: string;
  bank: string;
  course: string;
  source: string;
  live: boolean;
};

export type DeskEvent = {
  at: string;
  caseId: string;
  name: string;
  amount: string;
  amountPaise: number;
  decline: string;
  rail: string;
  bank: string;
  klass: string;
  course: string;
  clock: string;
  mutation: string;
  /** Mandate debits this decision spends, out of the 1 original + 3 retries budget. */
  npciSlotsUsed: number;
  npciSlotsLeftAfter: number;
  cooldownSeconds?: number;
  action: string;
  recovered: boolean;
  stopped: boolean;
  reason: string;
  live: boolean;
  inbound?: string;
  linkUrl?: string;
  emailed?: boolean;
  emailError?: string;
  promiseToPayDay?: number;
  claimedPaid?: boolean;
  scheduledDay?: number;
  scheduledHourIST?: number;
  parsedIntent?: string;
};
