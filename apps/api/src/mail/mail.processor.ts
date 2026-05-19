import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_QUEUE } from './mail.constants';
import type { MailJobData } from './mail-job.types';

@Processor(MAIL_QUEUE)
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporter) return this.transporter;
    const host = this.config.get<string>('SMTP_HOST') ?? process.env.SMTP_HOST;
    const user = this.config.get<string>('SMTP_USER') ?? process.env.SMTP_USER;
    const pass = this.config.get<string>('SMTP_PASS') ?? process.env.SMTP_PASS;
    const port =
      this.config.get<number>('SMTP_PORT') ?? parseInt(process.env.SMTP_PORT || '587', 10);
    if (!host || !user || !pass) return null;
    const secure = port === 465 || process.env.SMTP_SECURE === 'true';
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    return this.transporter;
  }

  @Process('deliver')
  async handleDeliver(job: Job<MailJobData>): Promise<void> {
    const { mailOptions, permitEmailAudit } = job.data;
    const transport = this.getTransporter();
    if (!transport) {
      this.logger.warn(`Mail job ${job.id}: SMTP tidak dikonfigurasi — job dilewati`);
      if (permitEmailAudit) {
        await this.prisma.permitEmailLog.create({
          data: {
            permitClusterId: permitEmailAudit.clusterId,
            toEmail: permitEmailAudit.toEmail,
            subject: permitEmailAudit.subject,
            bodySummary: 'SMTP tidak dikonfigurasi (antrian mail)',
            sentByUserId: permitEmailAudit.userId,
            documentsAttached: { success: false, ispName: permitEmailAudit.ispName } as object,
          },
        });
      }
      return;
    }

    try {
      const info = await transport.sendMail(mailOptions);
      this.logger.log(`Mail job ${job.id} terkirim messageId=${info.messageId ?? ''}`);
      if (permitEmailAudit) {
        const docs = permitEmailAudit.sipAudit
          ? {
              baOpen: permitEmailAudit.sipAudit.baOpenPdf,
              sip: permitEmailAudit.sipAudit.sipPdf,
              evidencePhotos: permitEmailAudit.sipAudit.evidencePhotos,
              messageId: info.messageId,
            }
          : {
              success: true,
              messageId: info.messageId,
              docUrls: permitEmailAudit.docUrls,
              ispName: permitEmailAudit.ispName,
            };
        await this.prisma.permitEmailLog.create({
          data: {
            permitClusterId: permitEmailAudit.clusterId,
            toEmail: permitEmailAudit.toEmail,
            subject: permitEmailAudit.subject,
            bodySummary: permitEmailAudit.sipAudit
              ? (permitEmailAudit.logBodySummary ?? permitEmailAudit.subject)
              : `OK messageId=${info.messageId ?? ''}`,
            sentByUserId: permitEmailAudit.userId,
            documentsAttached: docs as object,
          },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mail job ${job.id} gagal: ${msg}`);
      if (permitEmailAudit) {
        await this.prisma.permitEmailLog.create({
          data: {
            permitClusterId: permitEmailAudit.clusterId,
            toEmail: permitEmailAudit.toEmail,
            subject: permitEmailAudit.subject,
            bodySummary: `FAILED: ${msg}`,
            sentByUserId: permitEmailAudit.userId,
            documentsAttached: { success: false, error: msg, ispName: permitEmailAudit.ispName } as object,
          },
        });
      }
      throw err;
    }
  }
}
