import { type PaymentEvent, paymentEventSchema } from '@takawise/contracts';
import { type SignatureCheck, verifySignature } from '../../../domain/saas/signatures';

/**
 * Payment provider adapter (ADR-025). TakaWise never sees card or wallet
 * credentials: checkout happens on the provider's hosted page, and the
 * provider tells us the outcome through a signed webhook.
 *
 * Only `fake` exists today. A real Bangladeshi gateway needs merchant approval
 * and its own adapter (map its callback to `PaymentEvent`, verify its
 * signature scheme); nothing here pretends to be one.
 */
export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract readonly enabled: boolean;

  abstract createCheckout(args: {
    checkoutId: string;
    planCode: string;
    amount: string;
    currency: string;
  }): Promise<{ url: string }>;

  abstract verify(rawBody: Buffer, signatureHeader: string | undefined): SignatureCheck;

  /** Parse a verified body into the provider-neutral event, or null if unreadable. */
  parse(rawBody: Buffer): PaymentEvent | null {
    try {
      const parsed = paymentEventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

export class NoPaymentProvider extends PaymentProvider {
  readonly name = 'none';
  readonly enabled = false;

  createCheckout(): Promise<{ url: string }> {
    return Promise.reject(new Error('No payment provider configured'));
  }

  verify(): SignatureCheck {
    return 'mismatch';
  }
}

/**
 * Offline stand-in for development and tests. Its "hosted page" is the app's
 * own billing page, where a development-only button asks the API to emit a
 * correctly signed `checkout.completed` webhook — the same path a real
 * provider's callback takes.
 */
export class FakePaymentProvider extends PaymentProvider {
  readonly name = 'fake';
  readonly enabled = true;

  constructor(
    private readonly secret: string,
    private readonly appBaseUrl: string,
  ) {
    super();
  }

  createCheckout(args: { checkoutId: string }): Promise<{ url: string }> {
    return Promise.resolve({
      url: `${this.appBaseUrl}/app/billing?checkout=${encodeURIComponent(args.checkoutId)}`,
    });
  }

  verify(rawBody: Buffer, header: string | undefined): SignatureCheck {
    return verifySignature({
      secret: this.secret,
      rawBody,
      header,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  }
}
