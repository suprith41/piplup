export type QueueItem = {
  id: string;
  name: string;
  amount: string;
  amountPaise: number;
  decline: string;
  klass: string;
  rail: string;
  course: string;
  live: boolean;
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
  klass: string;
  course: string;
  clock: string;
  mutation: string;
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
  parsedIntent?: string;
};
