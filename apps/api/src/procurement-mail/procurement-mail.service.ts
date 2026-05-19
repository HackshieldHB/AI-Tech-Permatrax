import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  Optional,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailQueueService } from '../mail/mail-queue.service';

export interface SendEmailParams {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  /** Optional correlation for support / ops logs (e.g. supplier invoice id). */
  observability?: { invoiceId?: string; orderId?: string; event?: string };
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  messageId: string;
  acceptedRecipients: string[];
}

@Injectable()
export class ProcurementMailService {
  private readonly logger = new Logger(ProcurementMailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(MailQueueService) private readonly mailQueue?: MailQueueService,
  ) {}

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const port = this.config.get<number>('SMTP_PORT') ?? parseInt(process.env.SMTP_PORT || '587', 10);

    if (!host || !user || !pass) {
      throw new BadRequestException({
        message: 'Email config missing',
        missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
      });
    }

    const secure = port === 465 || process.env.SMTP_SECURE === 'true';
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    return this.transporter;
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    if (!params.to?.includes('@')) {
      throw new BadRequestException('Email penerima tidak valid');
    }

    const obs = params.observability;
    this.logger.log(
      JSON.stringify({
        event: obs?.event ?? 'procurement_send_email',
        phase: 'start',
        invoiceId: obs?.invoiceId,
        orderId: obs?.orderId,
        recipient: params.to,
        at: new Date().toISOString(),
      }),
    );

    const fromAddress =
      this.config.get<string>('PROCUREMENT_FROM_EMAIL') ||
      this.config.get<string>('SMTP_FROM') ||
      this.config.get<string>('SMTP_USER') ||
      process.env.PROCUREMENT_FROM_EMAIL ||
      process.env.SMTP_FROM ||
      process.env.SMTP_USER;

    if (!fromAddress) {
      throw new BadRequestException({
        message: 'Email config missing',
        missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
      });
    }

    this.logger.debug(`sendEmail fromAddress resolved: ${fromAddress}`);

    if (this.mailQueue) {
      const attachments = params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        encoding: 'base64' as const,
        contentType: a.contentType,
      }));
      await this.mailQueue.enqueue({
        mailOptions: {
          from: fromAddress,
          to: params.to,
          cc: params.cc,
          subject: params.subject,
          text: params.text,
          attachments,
        },
      });
      this.logger.log(
        JSON.stringify({
          event: obs?.event ?? 'procurement_send_email',
          phase: 'queued',
          invoiceId: obs?.invoiceId,
          orderId: obs?.orderId,
          recipient: params.to,
          at: new Date().toISOString(),
        }),
      );
      return { messageId: 'queued', acceptedRecipients: [params.to] };
    }

    return this.sendEmailImmediate(params, fromAddress);
  }

  /** Pengiriman sinkron (unit test / fallback tanpa MailQueueService). */
  private async sendEmailImmediate(
    params: SendEmailParams,
    fromAddress: string,
  ): Promise<SendEmailResult> {
    try {
      const transport = this.getTransporter();
      const info = await transport.sendMail({
        from: fromAddress,
        to: params.to,
        cc: params.cc,
        subject: params.subject,
        text: params.text,
        attachments: params.attachments,
      });

      this.logger.log(`Email terkirim ke ${params.to}, messageId: ${info.messageId}`);
      const obs = params.observability;
      this.logger.log(
        JSON.stringify({
          event: obs?.event ?? 'procurement_send_email',
          phase: 'success',
          invoiceId: obs?.invoiceId,
          orderId: obs?.orderId,
          recipient: params.to,
          messageId: info.messageId,
          at: new Date().toISOString(),
        }),
      );
      const accepted = info.accepted;
      const acceptedRecipients = Array.isArray(accepted)
        ? (accepted as string[])
        : typeof accepted === 'string'
          ? [accepted]
          : [];

      return {
        messageId: info.messageId || '',
        acceptedRecipients,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Gagal kirim email ke ${params.to}: ${msg}`, stack);
      this.logger.error(
        JSON.stringify({
          event: params.observability?.event ?? 'procurement_send_email',
          phase: 'failure',
          invoiceId: params.observability?.invoiceId,
          orderId: params.observability?.orderId,
          recipient: params.to,
          error: msg,
          at: new Date().toISOString(),
        }),
      );
      throw new InternalServerErrorException(`Gagal mengirim email: ${msg}`);
    }
  }
}
