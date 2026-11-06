export type DesktopPaymentStatus = 'waiting' | 'review' | 'signed' | 'submitted' | 'included' | 'finalized' | 'failed' | 'cancelled' | 'unknown';
export interface DesktopPayment {
  id: string; expectedFrom: string; dest: string; amount: string;
  status: DesktopPaymentStatus; createdAt: number; updatedAt: number; hash?: string; error?: string;
}
export type DesktopPaymentState = { state: 'empty' } | { state: 'blocked'; reason: string } | { state: 'payment'; payment: DesktopPayment };
export interface PaymentRequestInput { dest: string; amount: string }
export type IncomingPaymentStatus = 'review' | 'cancelled' | 'signed' | 'submitted' | 'included' | 'finalized' | 'failed' | 'error' | 'unknown';
export interface PaymentStatusMessage { t: 'payment_status'; id: string; status: IncomingPaymentStatus; hash?: string; error?: string }

