import type { SendMailOptions } from 'nodemailer';

/** Audit row for ISP permit email log (success or failure). */
export type PermitEmailAuditPayload = {
  clusterId: string;
  userId: string;
  toEmail: string;
  subject: string;
  /** Ringkasan untuk baris log (mis. isi pesan SIP). */
  logBodySummary?: string;
  ispName: string;
  docUrls: string[];
  /** When set, documentsAttached on success includes these SIP/BA fields */
  sipAudit?: {
    baOpenPdf: string | null;
    sipPdf: string | null;
    evidencePhotos: string[];
  };
};

export type MailJobData = {
  mailOptions: SendMailOptions;
  permitEmailAudit?: PermitEmailAuditPayload;
};
