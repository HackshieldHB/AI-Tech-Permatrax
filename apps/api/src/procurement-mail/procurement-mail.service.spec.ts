import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { ProcurementMailService } from './procurement-mail.service';

jest.mock('nodemailer');

describe('ProcurementMailService', () => {
  let service: ProcurementMailService;
  const sendMail = jest.fn();
  const createTransportMock = nodemailer.createTransport as unknown as jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'mid-1', accepted: ['buyer@test.com'] });
    createTransportMock.mockReturnValue({ sendMail });

    const config = {
      get: jest.fn((key: string) => {
        const m: Record<string, string | number> = {
          SMTP_HOST: 'smtp.test',
          SMTP_PORT: 587,
          SMTP_USER: 'usr',
          SMTP_PASS: 'pw',
          PROCUREMENT_FROM_EMAIL: 'proc@test.com',
        };
        return m[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcurementMailService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(ProcurementMailService);
  });

  it('sendEmail valid params → success', async () => {
    const r = await service.sendEmail({
      to: 'buyer@test.com',
      subject: 'PO 1',
      text: 'Halo',
    });
    expect(r.messageId).toBe('mid-1');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@test.com',
        text: 'Halo',
        subject: 'PO 1',
      }),
    );
  });

  it('sendEmail includes attachment when provided', async () => {
    await service.sendEmail({
      to: 'a@b.com',
      subject: 'X',
      text: 'Y',
      attachments: [{ filename: 'f.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' }],
    });
    expect(sendMail.mock.calls[0][0].attachments).toHaveLength(1);
  });

  it('invalid recipient → 400', async () => {
    await expect(service.sendEmail({ to: 'bad', subject: 's', text: 't' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('SMTP failure → 500', async () => {
    sendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      service.sendEmail({ to: 'ok@test.com', subject: 's', text: 't' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('missing PROCUREMENT_FROM_EMAIL → 400 BadRequestException', async () => {
    const configNoFrom = {
      get: jest.fn((key: string) => {
        const m: Record<string, string | number> = {
          SMTP_HOST: 'smtp.test',
          SMTP_PORT: 587,
          SMTP_USER: '',
          SMTP_PASS: 'pw',
        };
        return m[key];
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ProcurementMailService,
        { provide: ConfigService, useValue: configNoFrom },
      ],
    }).compile();
    const svc = mod.get(ProcurementMailService);

    // Also clear env vars to ensure no fallback
    const origFrom = process.env.PROCUREMENT_FROM_EMAIL;
    const origSmtpFrom = process.env.SMTP_FROM;
    const origSmtpUser = process.env.SMTP_USER;
    delete process.env.PROCUREMENT_FROM_EMAIL;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;

    try {
      await expect(
        svc.sendEmail({ to: 'ok@test.com', subject: 's', text: 't' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      // Restore env
      if (origFrom !== undefined) process.env.PROCUREMENT_FROM_EMAIL = origFrom;
      if (origSmtpFrom !== undefined) process.env.SMTP_FROM = origSmtpFrom;
      if (origSmtpUser !== undefined) process.env.SMTP_USER = origSmtpUser;
    }
  });
});
