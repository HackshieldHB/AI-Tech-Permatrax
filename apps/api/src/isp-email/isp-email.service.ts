import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'; // FIX: Nest exceptions + logger
import * as nodemailer from 'nodemailer'; // FIX: SMTP transport
import { PrismaService } from '../prisma/prisma.service'; // FIX: DB
import { MailQueueService } from '../mail/mail-queue.service'; // Sprint 2: antrian SMTP

@Injectable()
export class IspEmailService {
  private readonly logger = new Logger(IspEmailService.name); // FIX: structured logs

  constructor(
    private readonly prisma: PrismaService, // FIX: prisma
    private readonly mailQueue: MailQueueService, // Sprint 2
  ) {}

  listConfigs() {
    return this.prisma.ispEmailConfig.findMany({ orderBy: { ispName: 'asc' } }); // FIX: list configs
  }

  getConfig(ispName: string) {
    return this.prisma.ispEmailConfig.findUnique({ where: { ispName } }); // FIX: one config
  }

  upsertConfig(
    ispName: string,
    dto: { emailTo: string[]; emailCc?: string[]; emailBcc?: string[]; smtpNotes?: string },
    userId: string,
  ) {
    return this.prisma.ispEmailConfig.upsert({
      where: { ispName }, // FIX
      create: {
        ispName, // FIX
        emailTo: dto.emailTo, // FIX
        emailCc: dto.emailCc ?? [], // FIX
        emailBcc: dto.emailBcc ?? [], // FIX
        smtpNotes: dto.smtpNotes, // FIX
        updatedBy: userId, // FIX
      },
      update: {
        emailTo: dto.emailTo, // FIX
        emailCc: dto.emailCc ?? [], // FIX
        emailBcc: dto.emailBcc ?? [], // FIX
        smtpNotes: dto.smtpNotes, // FIX
        updatedBy: userId, // FIX
      },
    }); // FIX: upsert
  }

  /** FIX: build nodemailer transport from env */
  private createTransporter(): nodemailer.Transporter | null {
    const host = process.env.SMTP_HOST; // FIX: host
    const port = parseInt(process.env.SMTP_PORT || '587', 10); // FIX: port
    const user = process.env.SMTP_USER; // FIX: user
    const pass = process.env.SMTP_PASS; // FIX: pass
    if (!host || !user || !pass) return null; // FIX: not configured
    return nodemailer.createTransport({
      host, // FIX
      port, // FIX
      secure: port === 465, // FIX: SSL for 465
      auth: { user, pass }, // FIX
    }); // FIX: transport
  }

  /** FIX: send permit document summary to ISP inboxes from settings */
  async sendDocumentsToIsp(
    clusterId: string,
    userId: string,
    options?: {
      subject?: string; // FIX
      message?: string; // FIX
      docUrls?: string[]; // FIX
    },
  ) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId }, // FIX
      include: {
        visitRequest: { include: { cleanList: true } }, // FIX: RW context
        bakAgreement: true, // FIX: optional context
        bakp: true, // FIX
      },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan'); // FIX: 404

    const ispName = cluster.ispCustomer; // FIX: ISP key
    if (!ispName) throw new BadRequestException('ISP tidak ditemukan'); // FIX: bad data

    const ispConfig = await this.prisma.ispEmailConfig.findUnique({ where: { ispName } }); // FIX: recipients

    if (!ispConfig || ispConfig.emailTo.length === 0) {
      return {
        success: false, // FIX
        message:
          `Email config untuk ISP "${ispName}" belum diatur. ` + 'Silakan atur di Settings → ISP Email Config', // FIX: hint
        ispName, // FIX
        recipients: [] as string[], // FIX
      }; // FIX: early exit
    }

    const transporter = this.createTransporter(); // FIX: mailer
    if (!transporter) {
      this.logger.warn(`SMTP belum dikonfigurasi. Email ke ISP ${ispName} tidak terkirim.`); // FIX: ops warning
      return {
        success: false, // FIX
        message:
          'SMTP belum dikonfigurasi di server. ' +
          'Silakan set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS di .env', // FIX: hint
        ispName, // FIX
        recipients: ispConfig.emailTo, // FIX
      }; // FIX
    }

    const rwName = cluster.rwName || cluster.visitRequest?.cleanList?.rwCode || clusterId; // FIX: label
    const subject =
      options?.subject || `[PermaTrax] Dokumen perizinan cluster ${cluster.clusterCode} — ${rwName}`; // FIX: subject

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #00D4B4;">PermaTrax — dokumen perizinan</h2>
      <p>Yth. Tim ${ispName},</p>
      <p>
        ${
          options?.message ||
          'Bersama email ini kami sampaikan ringkasan dokumen perizinan untuk cluster berikut:'
        }
      </p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr style="background: #f5f5f5;">
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Cluster</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${cluster.clusterCode}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>RW</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${rwName}</td>
        </tr>
        <tr style="background: #f5f5f5;">
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>ISP</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${ispName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Fase</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${cluster.currentPhase}</td>
        </tr>
      </table>
      ${
        (options?.docUrls || []).length > 0
          ? `
        <p><strong>Tautan dokumen:</strong></p>
        <ul>
          ${(options.docUrls || [])
            .map((url, i) => `<li><a href="${url}">Dokumen ${i + 1}</a></li>`)
            .join('')}
        </ul>
      `
          : ''
      }
      <p style="color: #666; font-size: 12px; margin-top: 24px;">
        Email ini dikirim otomatis oleh sistem PermaTrax.<br />
        Jangan membalas email ini langsung.
      </p>
    </div>
  `; // FIX: body

    const fromAddr = process.env.SMTP_FROM || `"PermaTrax" <noreply@permatrax.com>`; // FIX: from

    await this.mailQueue.enqueue({
      mailOptions: {
        from: fromAddr,
        to: ispConfig.emailTo.join(', '),
        cc: ispConfig.emailCc?.length ? ispConfig.emailCc.join(', ') : undefined,
        bcc: ispConfig.emailBcc?.length ? ispConfig.emailBcc.join(', ') : undefined,
        subject,
        html,
      },
      permitEmailAudit: {
        clusterId,
        userId,
        toEmail: ispConfig.emailTo.join(','),
        subject,
        ispName,
        docUrls: options?.docUrls ?? [],
      },
    });

    this.logger.log(`Email ke ISP ${ispName} dimasukkan ke antrian pengiriman`);

    return {
      success: true,
      message: `Email sedang dikirim ke ${ispConfig.emailTo.join(', ')} (antrian).`,
      messageId: 'queued',
      recipients: ispConfig.emailTo,
      ispName,
      queued: true as const,
    };
  }

  async sendSipPackage(
    permitClusterId: string,
    dto: { emailTo: string[]; emailCc?: string[]; subject: string; message: string },
    userId: string,
  ) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId }, // FIX
      include: {
        baOpen: true, // FIX
        sip: true, // FIX
        surveyData: { include: { evidenceFiles: true } }, // FIX
      },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan'); // FIX

    const docUrls = [
      cluster.baOpen?.pdfUrl, // FIX
      cluster.sip?.pdfUrl, // FIX
      cluster.sip?.boundaryKmzUrl, // FIX
      ...(cluster.surveyData?.evidenceFiles?.map((e) => e.fileUrl) ?? []), // FIX
    ].filter((u): u is string => !!u); // FIX

    const transporter = this.createTransporter(); // FIX
    if (!transporter) {
      await this.prisma.permitEmailLog.create({
        data: {
          permitClusterId, // FIX
          toEmail: dto.emailTo.join(','), // FIX
          subject: dto.subject, // FIX
          bodySummary: `${dto.message} | SMTP not configured (logged only)`, // FIX
          sentByUserId: userId, // FIX
          documentsAttached: {
            baOpen: cluster.baOpen?.pdfUrl ?? null, // FIX
            sip: cluster.sip?.pdfUrl ?? null, // FIX
            evidencePhotos: cluster.surveyData?.evidenceFiles?.map((e) => e.fileUrl) ?? [], // FIX
          } as object, // FIX
        },
      }); // FIX: audit without send
      return { success: false, message: 'SMTP belum dikonfigurasi — hanya tercatat di log' }; // FIX
    }

    const html = `
      <div style="font-family: Arial, sans-serif;">
        <p>${dto.message.replace(/\n/g, '<br/>')}</p>
        <p><strong>Lampiran / tautan:</strong></p>
        <ul>${docUrls.map((u) => `<li><a href="${u}">${u}</a></li>`).join('')}</ul>
      </div>
    `; // FIX: HTML body

    await this.mailQueue.enqueue({
      mailOptions: {
        from: process.env.SMTP_FROM || `"PermaTrax" <noreply@permatrax.com>`,
        to: dto.emailTo.join(', '),
        cc: dto.emailCc?.length ? dto.emailCc.join(', ') : undefined,
        subject: dto.subject,
        html,
      },
      permitEmailAudit: {
        clusterId: permitClusterId,
        userId,
        toEmail: dto.emailTo.join(','),
        subject: dto.subject,
        logBodySummary: dto.message,
        ispName: cluster.ispCustomer,
        docUrls: [],
        sipAudit: {
          baOpenPdf: cluster.baOpen?.pdfUrl ?? null,
          sipPdf: cluster.sip?.pdfUrl ?? null,
          evidencePhotos: cluster.surveyData?.evidenceFiles?.map((e) => e.fileUrl) ?? [],
        },
      },
    });

    return { success: true, message: 'Email sedang dikirim (antrian).', queued: true as const };
  }
}
