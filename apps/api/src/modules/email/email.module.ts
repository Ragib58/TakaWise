import { Global, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from './email.types';

class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Used outside production when SMTP_URL is unset: logs metadata, never content. */
class SuppressedEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      `Email suppressed (no SMTP_URL): "${message.subject.replace(/\d{6}/g, '******')}"`,
    );
    return Promise.resolve();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender =>
        config.SMTP_URL
          ? new SmtpEmailSender(config.SMTP_URL, config.EMAIL_FROM)
          : new SuppressedEmailSender(),
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
