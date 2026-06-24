import { Injectable, NotFoundException } from '@nestjs/common'; // FIX: service entry
import { FiberType, Prisma } from '@prisma/client'; // FIX: Prisma types + fiber enum
import { PrismaService } from '../prisma/prisma.service'; // FIX: DB access
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto'; // FIX: legacy list pagination
import { DocumentListFilterDtoType } from './document-list.dto'; // FIX: list DTO
import { IspEmailService } from '../isp-email/isp-email.service'; // FIX: real SMTP send

/** FIX: one row in a phase document list */
export type DocumentListDocRow = {
  key: string; // FIX: stable id
  label: string; // FIX: display
  url: string | null; // FIX: primary URL
  type: 'pdf' | 'image' | 'file' | 'json'; // FIX: UI icon
  status: 'AVAILABLE' | 'PENDING' | 'MISSING'; // FIX: availability
  approvals?: { admin?: string; pm?: string }; // FIX: claim / BAK agreement
  isArray?: boolean; // FIX: multi-asset
  urls?: string[]; // FIX: all URLs when isArray
};

/** FIX: phase bucket */
export type DocumentListPhaseRow = {
  phase: string; // FIX: machine id
  phaseNum: number; // FIX: sort / badge
  label: string; // FIX: human label
  documents: DocumentListDocRow[]; // FIX: docs in phase
};

/** FIX: API payload for one cluster */
export type DocumentListClusterPayload = {
  cluster: {
    id: string; // FIX
    clusterCode: string; // FIX
    ispCustomer: string; // FIX
    fiberType: string; // FIX
    currentPhase: string; // FIX
    status: string; // FIX
    rwName: string | null; // FIX
    kelurahan: string | null; // FIX
    kecamatan: string | null; // FIX
    kotaKabupaten: string | null; // FIX
    latitude: number | null; // FIX
    longitude: number | null; // FIX
  };
  phases: DocumentListPhaseRow[]; // FIX
  summary: {
    totalDocs: number; // FIX
    available: number; // FIX
    pending: number; // FIX
    missing: number; // FIX
    approved: number; // FIX
    completionPercent: number; // FIX
  };
};

/** One row in the grouped Daftar Dokumen list (shared by FTTH permit clusters and FTTT projects). */
export type DocListClusterRow = {
  id: string;
  clusterCode: string;
  fiberType: string;
  currentPhase: string;
  status: string;
  rwName: string | null;
  kelurahan: string | null;
  kecamatan: string | null;
  kotaKabupaten: string | null;
  docCount: number;
  approvedDocs: number;
  bakpStatus: string | null;
  claimStatus: string | null;
};

/** One ISP/operator group in the grouped list. */
export type DocListGroup = {
  ispName: string;
  clusters: DocListClusterRow[];
  docCount: number;
};

@Injectable()
export class DocumentListService {
  constructor(
    private readonly prisma: PrismaService, // FIX: prisma
    private readonly ispEmailService: IspEmailService, // FIX: email delivery
  ) {}

  /** FIX: flatten document URLs for email attachments list */
  collectDocumentUrls(payload: DocumentListClusterPayload): string[] {
    const out: string[] = []; // FIX: accum
    for (const p of payload.phases) {
      for (const d of p.documents) {
        if (d.url) out.push(d.url); // FIX: primary
        if (d.urls?.length) out.push(...d.urls); // FIX: gallery
      }
    }
    return [...new Set(out.filter(Boolean))]; // FIX: dedupe
  }

  /** FIX: parse BAK agreement KTP JSON → string[] */
  private parseKtpUrls(raw: unknown): string[] {
    if (raw == null) return []; // FIX: empty
    if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string'); // FIX: array
    return []; // FIX: fallback
  }

  /** FIX: comprehensive per-cluster document list */
  async getDocumentListForCluster(clusterId: string): Promise<DocumentListClusterPayload> {
    // FTTT projects live in a separate model tree — serve them from the dedicated builder.
    const ftttPayload = await this.tryGetFtttDocumentList(clusterId);
    if (ftttPayload) return ftttPayload;

    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId }, // FIX: by id
      include: {
        visitRequest: { include: { cleanList: true } }, // FIX: RW / ISP data
        baOpen: true, // FIX: BA open PDF
        surveyData: { include: { evidenceFiles: true } }, // FIX: survey + evidence files
        surveyorDocPackage: true, // FIX: surveyor checklist record
        socialization: true, // FIX: sosialisasi PDFs + photos
        sip: true, // FIX: SIP PDF + KMZ
        hld: true, // FIX: HLD files
        lld: true, // FIX: LLD files
        bak: true, // FIX: compensation BAK PDF
        bakAgreement: true, // FIX: phase 16 BAK form
        bakp: { include: { participants: true } }, // FIX: BAKP + participants
        claimPackage: true, // FIX: claim docs
        scom: true, // FIX: SCOM MoM / PKS
        compensation: true, // FIX: compensation record (metadata)
        prBrWorkflow: true, // FIX: PR/BR/PO files
        skomBudget: true, // FIX: SKOM budget files
        invoicePackage: true, // FIX: invoice PDF + evidence
        apd: { include: { abd: true } }, // FIX: ABD main file
      },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan'); // FIX: 404

    const phases: DocumentListPhaseRow[] = []; // FIX: output phases

    // ── PHASE 1–3: BA Open ──────────────────────── // FIX: BA_OPEN
    phases.push({
      phase: 'BA_OPEN', // FIX: id
      phaseNum: 3, // FIX: order
      label: 'BA Open', // FIX: label
      documents: [
        {
          key: 'baOpenPdf', // FIX: key
          label: 'Dokumen BA Open (PDF)', // FIX: label
          url: cluster.baOpen?.pdfUrl ?? null, // FIX: url
          type: 'pdf', // FIX: type
          status: cluster.baOpen?.pdfUrl ? 'AVAILABLE' : 'PENDING', // FIX: status
        },
      ],
    });

    // ── PHASE 4: Site Visit / Survey ────────────── // FIX: SITE_VISIT
    const surveyDocs: DocumentListDocRow[] = []; // FIX: bucket
    if (cluster.surveyData) {
      const sd = cluster.surveyData; // FIX: alias
      surveyDocs.push({
        key: 'surveyFormPdf', // FIX: key
        label: 'Form Survey / BA Survey (PDF)', // FIX: label (schema: baSurveyPdfUrl)
        url: sd.baSurveyPdfUrl ?? null, // FIX: url
        type: 'pdf', // FIX: type
        status: sd.baSurveyPdfUrl ? 'AVAILABLE' : 'PENDING', // FIX: status
      });
      const evidenceUrls = [
        ...(sd.evidenceFiles?.map((e) => e.fileUrl) ?? []), // FIX: relational files
        ...(sd.evidencePhotos ?? []), // FIX: legacy array
      ].filter(Boolean); // FIX: trim
      if (evidenceUrls.length > 0) {
        surveyDocs.push({
          key: 'surveyPhotos', // FIX: key
          label: `Foto Survey (${evidenceUrls.length} foto)`, // FIX: label
          url: evidenceUrls[0] ?? null, // FIX: first
          type: 'image', // FIX: type
          status: 'AVAILABLE', // FIX: status
          isArray: true, // FIX: multi
          urls: evidenceUrls, // FIX: all
        });
      }
    }
    if (cluster.surveyorDocPackage) {
      const sdp = cluster.surveyorDocPackage; // FIX: alias
      surveyDocs.push({
        key: 'surveyorDocPackageStatus', // FIX: key
        label: `Paket dokumen surveyor — status ${sdp.status}`, // FIX: label (no file URLs on model)
        url: null, // FIX: no single file
        type: 'json', // FIX: metadata row
        status: sdp.status === 'ADMIN_APPROVED' ? 'AVAILABLE' : 'PENDING', // FIX: gate
      });
    }
    if (surveyDocs.length > 0) {
      phases.push({
        phase: 'SITE_VISIT', // FIX: id
        phaseNum: 4, // FIX: order
        label: 'Survey & Input', // FIX: label
        documents: surveyDocs, // FIX: docs
      });
    }

    // ── APD / ABD (routing) ─────────────────────── // FIX: optional design phase
    if (cluster.apd?.abd?.fileUrl) {
      phases.push({
        phase: 'ROUTE_DESIGN_ABD', // FIX: id
        phaseNum: 5, // FIX: approximate order
        label: 'ABD (Analisis Bank Data)', // FIX: label
        documents: [
          {
            key: 'abdFile', // FIX: key
            label: 'File ABD', // FIX: label
            url: cluster.apd.abd.fileUrl, // FIX: url
            type: 'file', // FIX: type
            status: 'AVAILABLE', // FIX: status
          },
        ],
      });
    }

    // ── PHASE 5–7: BA Survey / Sosialisasi ───────── // FIX: BA_SURVEY
    if (cluster.socialization) {
      const soc = cluster.socialization; // FIX: alias
      const socDocs: DocumentListDocRow[] = [
        {
          key: 'baSurveyPdf', // FIX: key
          label: 'BA Survey (PDF)', // FIX: label
          url: soc.baSurveyPdfUrl ?? null, // FIX: url
          type: 'pdf', // FIX: type
          status: soc.baSurveyPdfUrl ? 'AVAILABLE' : 'PENDING', // FIX: status
        },
        {
          key: 'momPdf', // FIX: key
          label: 'MoM Sosialisasi (PDF)', // FIX: label
          url: soc.momPdfUrl ?? null, // FIX: url
          type: 'pdf', // FIX: type
          status: soc.momPdfUrl ? 'AVAILABLE' : 'PENDING', // FIX: status
        },
      ];
      const ev = soc.evidencePhotos ?? []; // FIX: evidence array
      if (ev.length > 0) {
        socDocs.push({
          key: 'socializationPhotos', // FIX: key
          label: `Foto sosialisasi (${ev.length})`, // FIX: label
          url: ev[0] ?? null, // FIX: first
          type: 'image', // FIX: type
          status: 'AVAILABLE', // FIX: status
          isArray: true, // FIX: multi
          urls: ev, // FIX: all
        });
      }
      phases.push({
        phase: 'BA_SURVEY', // FIX: id
        phaseNum: 7, // FIX: order
        label: 'BA Survey & Sosialisasi', // FIX: label
        documents: socDocs, // FIX: docs
      });
    }

    // ── SCOM ───────────────────────────────────── // FIX: SCOM
    if (cluster.scom && (cluster.scom.momPdfUrl || cluster.scom.pksSignedUrl)) {
      const sc = cluster.scom; // FIX: alias
      phases.push({
        phase: 'SCOM', // FIX: id
        phaseNum: 7, // FIX: same band as socialization
        label: 'SCOM', // FIX: label
        documents: [
          ...(sc.momPdfUrl
            ? [
                {
                  key: 'scomMom', // FIX: key
                  label: 'MoM SCOM (PDF)', // FIX: label
                  url: sc.momPdfUrl, // FIX: url
                  type: 'pdf' as const, // FIX: type
                  status: 'AVAILABLE' as const, // FIX: status
                },
              ]
            : []),
          ...(sc.pksSignedUrl
            ? [
                {
                  key: 'scomPks', // FIX: key
                  label: 'PKS ditandatangani', // FIX: label
                  url: sc.pksSignedUrl, // FIX: url
                  type: 'pdf' as const, // FIX: type
                  status: 'AVAILABLE' as const, // FIX: status
                },
              ]
            : []),
        ],
      });
    }

    // ── PHASE 8: SIP ────────────────────────────── // FIX: SIP_REQUEST
    if (cluster.sip) {
      const sip = cluster.sip; // FIX: alias
      const sipDocs: DocumentListDocRow[] = [
        {
          key: 'sipDocument', // FIX: key
          label: 'Dokumen SIP (PDF)', // FIX: label
          url: sip.pdfUrl ?? null, // FIX: url
          type: 'pdf', // FIX: type
          status: sip.pdfUrl ? 'AVAILABLE' : 'PENDING', // FIX: status
        },
      ];
      if (sip.boundaryKmzUrl) {
        sipDocs.push({
          key: 'sipBoundaryKmz', // FIX: key
          label: 'Batas area (KMZ)', // FIX: label
          url: sip.boundaryKmzUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      phases.push({
        phase: 'SIP_REQUEST', // FIX: id
        phaseNum: 8, // FIX: order
        label: 'SIP (Surat Izin Pemasangan)', // FIX: label
        documents: sipDocs, // FIX: docs
      });
    }

    // ── PHASE 9: HLD ────────────────────────────── // FIX: HLD_SUBMISSION
    if (cluster.hld) {
      const hld = cluster.hld; // FIX: alias
      const hldDocs: DocumentListDocRow[] = []; // FIX: bucket
      if (hld.kmzFileUrl) {
        hldDocs.push({
          key: 'hldKmz', // FIX: key
          label: 'File KMZ (HLD)', // FIX: label
          url: hld.kmzFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (hld.boqFileUrl) {
        hldDocs.push({
          key: 'hldBoq', // FIX: key
          label: 'File BOQ (HLD)', // FIX: label
          url: hld.boqFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      for (let i = 0; i < (hld.additionalFiles ?? []).length; i++) {
        const u = hld.additionalFiles[i]; // FIX: url
        if (u) {
          hldDocs.push({
            key: `hldAdditional_${i}`, // FIX: key
            label: `Lampiran HLD ${i + 1}`, // FIX: label
            url: u, // FIX: url
            type: 'file', // FIX: type
            status: 'AVAILABLE', // FIX: status
          });
        }
      }
      if (hldDocs.length > 0) {
        phases.push({
          phase: 'HLD_SUBMISSION', // FIX: id
          phaseNum: 9, // FIX: order
          label: 'HLD (High Level Design)', // FIX: label
          documents: hldDocs, // FIX: docs
        });
      }
    }

    // ── PHASE 10: LLD ───────────────────────────── // FIX: LLD_SUBMISSION
    if (cluster.lld) {
      const lld = cluster.lld; // FIX: alias
      const lldDocs: DocumentListDocRow[] = []; // FIX: bucket
      if (lld.apdFileUrl) {
        lldDocs.push({
          key: 'lldApd', // FIX: key
          label: 'File APD (LLD)', // FIX: label
          url: lld.apdFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (lld.schematicFileUrl) {
        lldDocs.push({
          key: 'lldSchematic', // FIX: key
          label: 'Skematik jaringan', // FIX: label
          url: lld.schematicFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (lld.coreConnectionUrl) {
        lldDocs.push({
          key: 'lldCore', // FIX: key
          label: 'Core connection', // FIX: label
          url: lld.coreConnectionUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      for (let i = 0; i < (lld.additionalFiles ?? []).length; i++) {
        const u = lld.additionalFiles[i]; // FIX: url
        if (u) {
          lldDocs.push({
            key: `lldAdditional_${i}`, // FIX: key
            label: `Lampiran LLD ${i + 1}`, // FIX: label
            url: u, // FIX: url
            type: 'file', // FIX: type
            status: 'AVAILABLE', // FIX: status
          });
        }
      }
      if (lldDocs.length > 0) {
        phases.push({
          phase: 'LLD_SUBMISSION', // FIX: id
          phaseNum: 10, // FIX: order
          label: 'LLD (Low Level Design)', // FIX: label
          documents: lldDocs, // FIX: docs
        });
      }
    }

    // ── PR / BR / PO workflow ───────────────────── // FIX: PR_BR_ISSUANCE band
    if (cluster.prBrWorkflow) {
      const w = cluster.prBrWorkflow; // FIX: alias
      const wDocs: DocumentListDocRow[] = []; // FIX: bucket
      if (w.prFileUrl) {
        wDocs.push({
          key: 'prFile', // FIX: key
          label: 'File PR', // FIX: label
          url: w.prFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (w.brFileUrl) {
        wDocs.push({
          key: 'brFile', // FIX: key
          label: 'File BR', // FIX: label
          url: w.brFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (w.poFileUrl) {
        wDocs.push({
          key: 'poFile', // FIX: key
          label: 'File PO', // FIX: label
          url: w.poFileUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (wDocs.length > 0) {
        phases.push({
          phase: 'PR_BR_WORKFLOW', // FIX: id
          phaseNum: 11, // FIX: order
          label: 'PR / BR / PO', // FIX: label
          documents: wDocs, // FIX: docs
        });
      }
    }

    // ── SKOM Budget ─────────────────────────────── // FIX: SKOM_BUDGET
    if (cluster.skomBudget) {
      const sk = cluster.skomBudget; // FIX: alias
      const skDocs: DocumentListDocRow[] = []; // FIX: bucket
      const pairs: { key: string; label: string; url: string | null | undefined }[] = [
        { key: 'budgetFile', label: 'File anggaran', url: sk.budgetFileUrl }, // FIX: map
        { key: 'rabFile', label: 'File RAB', url: sk.rabFileUrl }, // FIX: map
        { key: 'timelineFile', label: 'File timeline', url: sk.timelineFileUrl }, // FIX: map
        { key: 'kurvaSFile', label: 'Kurva-S', url: sk.kurvaSFileUrl }, // FIX: map
      ];
      for (const p of pairs) {
        if (p.url) {
          skDocs.push({
            key: p.key, // FIX: key
            label: p.label, // FIX: label
            url: p.url, // FIX: url
            type: 'file', // FIX: type
            status: 'AVAILABLE', // FIX: status
          });
        }
      }
      if (skDocs.length > 0) {
        phases.push({
          phase: 'SKOM_BUDGET', // FIX: id
          phaseNum: 12, // FIX: order
          label: 'SKOM & Budget', // FIX: label
          documents: skDocs, // FIX: docs
        });
      }
    }

    // ── Compensation BAK (financial) ───────────── // FIX: BAK compensation
    if (cluster.bak?.pdfUrl) {
      phases.push({
        phase: 'BAK_COMPENSATION', // FIX: id
        phaseNum: 15, // FIX: order
        label: 'BAK (Kompensasi)', // FIX: label
        documents: [
          {
            key: 'compensationBakPdf', // FIX: key
            label: 'BAK kompensasi (PDF)', // FIX: label
            url: cluster.bak.pdfUrl, // FIX: url
            type: 'pdf', // FIX: type
            status: 'AVAILABLE', // FIX: status
          },
        ],
      });
    }

    // ── PHASE 16: BAK Agreement (surveyor form) ── // FIX: BAK_GENERATION
    if (cluster.bakAgreement) {
      const bak = cluster.bakAgreement; // FIX: alias
      const bakDocs: DocumentListDocRow[] = []; // FIX: bucket
      if (bak.pdfUrl) {
        bakDocs.push({
          key: 'bakFormPdf', // FIX: key
          label: 'BAK Form (PDF)', // FIX: label
          url: bak.pdfUrl, // FIX: url
          type: 'pdf', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (bak.signedPdfUrl) {
        const st = bak.status; // FIX: status enum
        bakDocs.push({
          key: 'bakSignedPdf', // FIX: key
          label: 'BAK Bertanda Tangan (PDF)', // FIX: label
          url: bak.signedPdfUrl, // FIX: url
          type: 'pdf', // FIX: type
          status: st === 'APPROVED' ? 'AVAILABLE' : 'PENDING', // FIX: gate
          approvals: {
            admin:
              st === 'APPROVED' // FIX: admin line
                ? 'APPROVED'
                : st === 'ADMIN_REJECTED'
                  ? 'REJECTED'
                  : 'PENDING', // FIX: default
            pm:
              st === 'APPROVED' // FIX: pm line
                ? 'APPROVED'
                : st === 'PM_REJECTED'
                  ? 'REJECTED'
                  : st === 'PM_REVIEW' || st === 'ADMIN_REVIEW'
                    ? 'PENDING'
                    : 'PENDING', // FIX: default
          },
        });
      }
      const ktps = this.parseKtpUrls(bak.ktpPhotoUrls); // FIX: KTP list
      if (ktps.length > 0) {
        bakDocs.push({
          key: 'ktpPhotos', // FIX: key
          label: `Foto KTP peserta (${ktps.length} foto)`, // FIX: label
          url: ktps[0] ?? null, // FIX: first
          type: 'image', // FIX: type
          status: 'AVAILABLE', // FIX: status
          isArray: true, // FIX: multi
          urls: ktps, // FIX: all
        });
      }
      if (bak.stempelPhotoUrl) {
        bakDocs.push({
          key: 'stempelPhoto', // FIX: key
          label: 'Foto stempel', // FIX: label
          url: bak.stempelPhotoUrl, // FIX: url
          type: 'image', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (bakDocs.length > 0) {
        phases.push({
          phase: 'BAK_GENERATION', // FIX: id
          phaseNum: 16, // FIX: order
          label: 'BAK (Berita Acara Kesepakatan)', // FIX: label
          documents: bakDocs, // FIX: docs
        });
      }
    }

    // ── PHASE 17: BAKP ─────────────────────────── // FIX: BAKP_COMPILATION
    if (cluster.bakp) {
      const bakp = cluster.bakp; // FIX: alias
      const bakpDocs: DocumentListDocRow[] = []; // FIX: bucket
      if (bakp.bundlePdfUrl) {
        bakpDocs.push({
          key: 'bakpBundle', // FIX: key
          label: 'BAKP Bundle (PDF)', // FIX: label
          url: bakp.bundlePdfUrl, // FIX: url
          type: 'pdf', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      const docMap = bakp.docBakpUrls as Record<string, string> | null; // FIX: json map
      if (docMap && typeof docMap === 'object') {
        const docLabels: Record<string, string> = {
          docBAOpen: 'BA Open', // FIX: label map
          docBASurvey: 'BA Survey', // FIX
          docBASosialisasi: 'BA Sosialisasi', // FIX
          docBAK: 'BAK', // FIX
          docSip: 'SIP', // FIX
          docKtpRtRw: 'KTP RT/RW', // FIX
          docRtRwSk: 'SK RT/RW', // FIX
          docPks: 'PKS', // FIX
          docReceipt: 'Kwitansi', // FIX
          docTransferProof: 'Bukti transfer', // FIX
          docPaymentPhoto: 'Foto evidence payment', // FIX
        };
        for (const [key, url] of Object.entries(docMap)) {
          if (url) {
            bakpDocs.push({
              key: `bakp_${key}`, // FIX: key
              label: docLabels[key] || key, // FIX: label
              url, // FIX: url
              type: url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image' : 'pdf', // FIX: infer
              status: 'AVAILABLE', // FIX: status
            });
          }
        }
      }
      if (bakp.stempelUrl) {
        bakpDocs.push({
          key: 'bakpStempel', // FIX: key
          label: 'Stempel BAKP', // FIX: label
          url: bakp.stempelUrl, // FIX: url
          type: 'image', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      for (const part of bakp.participants ?? []) {
        if (part.ktpPhotoUrl) {
          bakpDocs.push({
            key: `bakpParticipantKtp_${part.id}`, // FIX: key
            label: `KTP — ${part.name}`, // FIX: label
            url: part.ktpPhotoUrl, // FIX: url
            type: 'image', // FIX: type
            status: 'AVAILABLE', // FIX: status
          });
        }
      }
      if (bakpDocs.length > 0) {
        phases.push({
          phase: 'BAKP_COMPILATION', // FIX: id
          phaseNum: 17, // FIX: order
          label: 'BAKP (Kompilasi dokumen)', // FIX: label
          documents: bakpDocs, // FIX: docs
        });
      }
    }

    // ── PHASE 18: Claim ────────────────────────── // FIX: CLAIM
    if (cluster.claimPackage) {
      const claim = cluster.claimPackage; // FIX: alias
      const approvals = (claim.docApprovals as Record<string, { adminStatus?: string; pmStatus?: string }>) || {}; // FIX: approvals map

      const streamADocs = [
        { key: 'docMom', label: 'MOM' }, // FIX: keys
        { key: 'docBaOpen', label: 'BA Open' }, // FIX
        { key: 'docBaAcara', label: 'BA Acara' }, // FIX
        { key: 'docBaTtdRt', label: 'BA TTD RT' }, // FIX
        { key: 'docFcBukuTabungan', label: 'FC Buku Tabungan' }, // FIX
        { key: 'docSip', label: 'SIP' }, // FIX
        { key: 'docKtpRtRw', label: 'KTP RT/RW' }, // FIX
        { key: 'docPks', label: 'PKS' }, // FIX
        { key: 'docKwitansi', label: 'Kwitansi' }, // FIX
        { key: 'docEvidancePayment', label: 'Evidence payment' }, // FIX
        { key: 'docBuktiTrf', label: 'Bukti transfer' }, // FIX
        { key: 'docSkInternal', label: 'SK Internal ILT' }, // FIX
        { key: 'docPoSpk', label: 'PO/SPK' }, // FIX
      ];
      const streamBDocs = [
        { key: 'docBaOpenLengkap', label: 'BA Open lengkap (3 pihak)' }, // FIX: B keys
        { key: 'docKwitansiGov', label: 'Kwitansi (Gov)' }, // FIX
        { key: 'docFotoEvidance', label: 'Foto evidence' }, // FIX
        { key: 'docEvidancePaymentGov', label: 'Evidence payment (Gov)' }, // FIX
        { key: 'docSkInternalGov', label: 'SK Internal ILT (Gov)' }, // FIX
        { key: 'docPoSpkGov', label: 'PO/SPK (Gov)' }, // FIX
      ];

      const claimRec = claim as unknown as Record<string, unknown>; // FIX: safe index
      const claimADocs = streamADocs
        .filter((d) => claimRec[d.key])
        .map((d) => ({
          key: d.key, // FIX: key
          label: d.label, // FIX: label
          url: String(claimRec[d.key] ?? ''), // FIX: url
          type: 'pdf' as const, // FIX: type
          status: 'AVAILABLE' as const, // FIX: status
          approvals: {
            admin: approvals[d.key]?.adminStatus || 'PENDING', // FIX: admin
            pm: approvals[d.key]?.pmStatus || 'PENDING', // FIX: pm
          },
        }));

      if (claimADocs.length > 0) {
        phases.push({
          phase: 'CLAIM_A', // FIX: id
          phaseNum: 18, // FIX: order
          label: 'Klaim — dokumen kompensasi', // FIX: label
          documents: claimADocs, // FIX: docs
        });
      }

      const claimBDocs = streamBDocs
        .filter((d) => claimRec[d.key])
        .map((d) => ({
          key: d.key, // FIX: key
          label: d.label, // FIX: label
          url: String(claimRec[d.key] ?? ''), // FIX: url
          type: 'pdf' as const, // FIX: type
          status: 'AVAILABLE' as const, // FIX: status
          approvals: {
            admin: approvals[d.key]?.adminStatus || 'PENDING', // FIX: admin
            pm: approvals[d.key]?.pmStatus || 'PENDING', // FIX: pm
          },
        }));

      if (claimBDocs.length > 0) {
        phases.push({
          phase: 'CLAIM_B', // FIX: id
          phaseNum: 18, // FIX: order
          label: 'Klaim — dokumen koordinasi government', // FIX: label
          documents: claimBDocs, // FIX: docs
        });
      }

      const extraUrls = [...(claim.ispDocumentUrls ?? []), ...(claim.govDocumentUrls ?? [])]; // FIX: bundled URLs
      if (extraUrls.length > 0) {
        phases.push({
          phase: 'CLAIM_EXTRA', // FIX: id
          phaseNum: 18, // FIX: order
          label: 'Klaim — lampiran ISP/Gov', // FIX: label
          documents: extraUrls.map((url, i) => ({
            key: `claimExtra_${i}`, // FIX: key
            label: `Lampiran ${i + 1}`, // FIX: label
            url, // FIX: url
            type: url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image' : 'pdf', // FIX: infer
            status: 'AVAILABLE' as const, // FIX: status
          })),
        });
      }
      if (claim.compiledPackageUrl) {
        phases.push({
          phase: 'CLAIM_PACKAGE', // FIX: id
          phaseNum: 18, // FIX: order
          label: 'Klaim — paket terkompilasi', // FIX: label
          documents: [
            {
              key: 'compiledPackage', // FIX: key
              label: 'Paket PDF terkompilasi', // FIX: label
              url: claim.compiledPackageUrl, // FIX: url
              type: 'pdf', // FIX: type
              status: 'AVAILABLE', // FIX: status
            },
          ],
        });
      }
    }

    // ── Invoice ─────────────────────────────────── // FIX: INVOICE_PACKAGE
    if (cluster.invoicePackage) {
      const inv = cluster.invoicePackage; // FIX: alias
      const invDocs: DocumentListDocRow[] = []; // FIX: bucket
      if (inv.invoicePdfUrl) {
        invDocs.push({
          key: 'invoicePdf', // FIX: key
          label: 'Invoice (PDF)', // FIX: label
          url: inv.invoicePdfUrl, // FIX: url
          type: 'pdf', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      if (inv.paymentEvidenceUrl) {
        invDocs.push({
          key: 'paymentEvidence', // FIX: key
          label: 'Bukti pembayaran', // FIX: label
          url: inv.paymentEvidenceUrl, // FIX: url
          type: 'file', // FIX: type
          status: 'AVAILABLE', // FIX: status
        });
      }
      for (let i = 0; i < (inv.supportingDocs ?? []).length; i++) {
        const u = inv.supportingDocs[i]; // FIX: url
        if (u) {
          invDocs.push({
            key: `invoiceSupporting_${i}`, // FIX: key
            label: `Dokumen pendukung ${i + 1}`, // FIX: label
            url: u, // FIX: url
            type: 'file', // FIX: type
            status: 'AVAILABLE', // FIX: status
          });
        }
      }
      if (invDocs.length > 0) {
        phases.push({
          phase: 'INVOICE_PACKAGE', // FIX: id
          phaseNum: 19, // FIX: order
          label: 'Invoice', // FIX: label
          documents: invDocs, // FIX: docs
        });
      }
    }

    const cl = cluster.visitRequest?.cleanList; // FIX: clean list ref
    const payload: DocumentListClusterPayload = {
      cluster: {
        id: cluster.id, // FIX
        clusterCode: cluster.clusterCode, // FIX
        ispCustomer: cluster.ispCustomer, // FIX
        fiberType: cluster.fiberType, // FIX
        currentPhase: cluster.currentPhase, // FIX
        status: cluster.status, // FIX
        rwName: cluster.rwName || cl?.rwCode || null, // FIX: RW label
        kelurahan: cl?.kelurahan ?? null, // FIX
        kecamatan: cl?.kecamatan ?? null, // FIX
        kotaKabupaten: cl?.kotaKabupaten ?? null, // FIX
        latitude: cluster.latitude ?? null, // FIX
        longitude: cluster.longitude ?? null, // FIX
      },
      phases, // FIX: phases
      summary: {
        totalDocs: 0, // FIX: filled below
        available: 0, // FIX
        pending: 0, // FIX
        missing: 0, // FIX
        approved: 0, // FIX
        completionPercent: 0, // FIX
      },
    };

    const allDocs = phases.flatMap((p) => p.documents); // FIX: flat list
    payload.summary.totalDocs = allDocs.length; // FIX: count
    payload.summary.available = allDocs.filter((d) => d.status === 'AVAILABLE').length; // FIX
    payload.summary.pending = allDocs.filter((d) => d.status === 'PENDING').length; // FIX
    payload.summary.missing = allDocs.filter((d) => d.status === 'MISSING').length; // FIX
    payload.summary.approved = allDocs.filter(
      (d) => d.approvals?.admin === 'APPROVED' && d.approvals?.pm === 'APPROVED', // FIX: dual ok
    ).length;
    payload.summary.completionPercent =
      payload.summary.totalDocs > 0
        ? Math.round((payload.summary.available / payload.summary.totalDocs) * 100) // FIX: %
        : 0;

    return payload; // FIX: return
  }

  /** FIX: legacy paginated list (optional BAKP filter removed — all clusters) */
  async getAllCompletedClusters(
    filters: DocumentListFilterDtoType,
  ): Promise<PaginatedResponse<unknown>> {
    const { fiberType, ispCustomer, dateFrom, dateTo, search, page, limit, sortBy, sortOrder, bakpIspApproved } = filters; // FIX: unpack
    const skip = (page - 1) * limit; // FIX: offset
    const where: Prisma.PermitClusterWhereInput = {}; // FIX: all clusters (not only BAKP approved)
    if (fiberType) where.fiberType = fiberType; // FIX: filter
    if (ispCustomer?.trim()) {
      where.ispCustomer = { contains: ispCustomer.trim(), mode: 'insensitive' }; // FIX: ISP
    }
    if (search?.trim()) {
      const q = search.trim(); // FIX: query
      where.OR = [
        { clusterCode: { contains: q, mode: 'insensitive' } }, // FIX
        { ispCustomer: { contains: q, mode: 'insensitive' } }, // FIX
        { rwName: { contains: q, mode: 'insensitive' } }, // FIX
        {
          visitRequest: {
            cleanList: {
              OR: [
                { kelurahan: { contains: q, mode: 'insensitive' } }, // FIX
                { kecamatan: { contains: q, mode: 'insensitive' } }, // FIX
                { kotaKabupaten: { contains: q, mode: 'insensitive' } }, // FIX
                { rwCode: { contains: q, mode: 'insensitive' } }, // FIX
              ],
            },
          },
        },
      ];
    }
    if (dateFrom || dateTo) {
      where.readyForConstructionAt = {}; // FIX: date range
      if (dateFrom) where.readyForConstructionAt.gte = new Date(dateFrom); // FIX
      if (dateTo) where.readyForConstructionAt.lte = new Date(dateTo); // FIX
    }
    if (bakpIspApproved) {
      where.bakp = { is: { status: 'DONE', ispDecision: 'ACCEPTED' } };
    }

    const orderField =
      sortBy && ['readyForConstructionAt', 'clusterCode', 'updatedAt'].includes(sortBy) ? sortBy : 'updatedAt'; // FIX: default sort
    const orderBy = { [orderField]: sortOrder } as Prisma.PermitClusterOrderByWithRelationInput; // FIX

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.permitCluster.findMany({
        where, // FIX
        skip, // FIX
        take: limit, // FIX
        orderBy, // FIX
        include: {
          apd: {
            select: {
              abd: { select: { fileUrl: true } }, // FIX
            },
          },
          baOpen: { select: { documentNumber: true, pdfUrl: true } }, // FIX
          visitRequest: {
            select: {
              cleanList: { select: { kelurahan: true, kecamatan: true } }, // FIX
            },
          },
          socialization: {
            select: { baSurveyPdfUrl: true, momPdfUrl: true, baSurveyNumber: true, momNumber: true }, // FIX
          },
          bak: { select: { documentNumber: true, pdfUrl: true } }, // FIX
          scom: { select: { momPdfUrl: true, momNumber: true } }, // FIX
          bakp: { select: { documentNumber: true, bundlePdfUrl: true, finalMergedPdfUrl: true, status: true, validatedAt: true, ispDecisionAt: true } }, // FIX
        },
      }),
      this.prisma.permitCluster.count({ where }), // FIX
    ]);

    return paginate(rows, total, page, limit); // FIX
  }

  /** FIX: group clusters by ISP for document hub */
  async getGroupedByIsp(params: {
    search?: string; // FIX
    fiberType?: string; // FIX
    ispFilter?: string; // FIX
    bakpIspApproved?: boolean; // FIX
    page?: number; // FIX
    limit?: number; // FIX
  }) {
    const { search, fiberType, ispFilter, bakpIspApproved, page = 1, limit = 50 } = params; // FIX: defaults

    const where: Prisma.PermitClusterWhereInput = {}; // FIX: base
    if (fiberType && (Object.values(FiberType) as string[]).includes(fiberType)) {
      where.fiberType = fiberType as FiberType; // FIX: validated fiber enum
    }
    if (ispFilter?.trim()) {
      where.ispCustomer = { contains: ispFilter.trim(), mode: 'insensitive' }; // FIX: ISP contains
    }
    if (search?.trim()) {
      const q = search.trim(); // FIX: q
      where.OR = [
        { clusterCode: { contains: q, mode: 'insensitive' } }, // FIX
        { ispCustomer: { contains: q, mode: 'insensitive' } }, // FIX
        { rwName: { contains: q, mode: 'insensitive' } }, // FIX
        {
          visitRequest: {
            cleanList: {
              OR: [
                { kelurahan: { contains: q, mode: 'insensitive' } }, // FIX
                { kecamatan: { contains: q, mode: 'insensitive' } }, // FIX
                { kotaKabupaten: { contains: q, mode: 'insensitive' } }, // FIX
                { rwCode: { contains: q, mode: 'insensitive' } }, // FIX
              ],
            },
          },
        },
      ];
    }
    if (bakpIspApproved) {
      where.bakp = { is: { status: 'DONE', ispDecision: 'ACCEPTED' } };
    }

    const clusters = await this.prisma.permitCluster.findMany({
      where, // FIX
      include: {
        visitRequest: { include: { cleanList: true } }, // FIX
        bakAgreement: { select: { status: true, pdfUrl: true, signedPdfUrl: true } }, // FIX
        bakp: { select: { status: true, bundlePdfUrl: true, finalMergedPdfUrl: true, ispDecisionAt: true } }, // FIX
        claimPackage: { select: { status: true, docApprovals: true } }, // FIX
        hld: { select: { id: true } }, // FIX
        lld: { select: { id: true } }, // FIX
        sip: { select: { id: true } }, // FIX
        socialization: { select: { baSurveyPdfUrl: true } }, // FIX
        surveyData: { select: { id: true } }, // FIX
      },
      orderBy: [{ ispCustomer: 'asc' }, { clusterCode: 'asc' }], // FIX
      skip: (page - 1) * limit, // FIX
      take: limit, // FIX
    });

    const total = await this.prisma.permitCluster.count({ where }); // FIX: total

    const grouped: Record<string, DocListGroup> = {}; // FIX: map (shared FTTH/FTTT row type)

    for (const c of clusters) {
      const isp = c.ispCustomer || 'Unknown'; // FIX: key
      if (!grouped[isp]) grouped[isp] = { ispName: isp, clusters: [], docCount: 0 }; // FIX: init

      let docCount = 0; // FIX: heuristic count
      if (c.bakAgreement?.pdfUrl) docCount++; // FIX
      if (c.bakAgreement?.signedPdfUrl) docCount++; // FIX
      if (c.bakp?.bundlePdfUrl) docCount++; // FIX
      if (c.hld) docCount++; // FIX
      if (c.lld) docCount++; // FIX
      if (c.sip) docCount++; // FIX
      if (c.socialization?.baSurveyPdfUrl) docCount++; // FIX
      if (c.surveyData) docCount++; // FIX

      const claimApprovals = (c.claimPackage?.docApprovals as Record<string, { adminStatus?: string; pmStatus?: string }>) || {}; // FIX
      const approvedDocs = Object.values(claimApprovals).filter(
        (a) => a?.adminStatus === 'APPROVED' && a?.pmStatus === 'APPROVED', // FIX
      ).length; // FIX

      const cl = c.visitRequest?.cleanList; // FIX
      grouped[isp].clusters.push({
        id: c.id, // FIX
        clusterCode: c.clusterCode, // FIX
        fiberType: c.fiberType, // FIX
        currentPhase: c.currentPhase, // FIX
        status: c.status, // FIX
        rwName: c.rwName || cl?.rwCode || null, // FIX
        kelurahan: cl?.kelurahan ?? null, // FIX
        kecamatan: cl?.kecamatan ?? null, // FIX
        kotaKabupaten: cl?.kotaKabupaten ?? null, // FIX
        docCount, // FIX
        approvedDocs, // FIX
        bakpStatus: c.bakp?.status ?? null, // FIX
        claimStatus: c.claimPackage?.status ?? null, // FIX
      });
      grouped[isp].docCount += docCount; // FIX
    }

    // Merge FTTT projects (separate model tree) so Daftar Dokumen is a single,
    // centralized repository for both FTTH (permit clusters) and FTTT lifecycles.
    const ftttCount = await this.appendFtttGroups(grouped, { search, fiberType });
    const grandTotal = total + ftttCount;

    return {
      groups: Object.values(grouped), // FIX
      total: grandTotal, // FIX: FTTH + FTTT
      page, // FIX
      limit, // FIX
      totalPages: Math.ceil(grandTotal / limit) || 0, // FIX
    };
  }

  // ─── FTTT integration ───────────────────────────────────────────────────────
  // FTTT projects are NOT permit clusters; their documents live in dedicated tables.
  // These helpers surface FTTT documents in the same Daftar Dokumen list + detail UI.

  private ftttCompanyLabel(c: string | null | undefined): string {
    switch (c) {
      case 'TELKOM_INFRA': return 'Telkom Infra';
      case 'IFORTE': return 'iForte';
      case 'PST': return 'PST';
      default: return c || 'FTTT';
    }
  }

  private ftttDocType(url: string | null | undefined): 'pdf' | 'image' | 'file' {
    if (!url) return 'file';
    const u = url.toLowerCase().split('?')[0];
    if (u.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(u)) return 'image';
    return 'file';
  }

  /** Normalize FTTT approval enum to the badge values the detail UI understands. */
  private ftttApproval(status: string | null | undefined): 'APPROVED' | 'REJECTED' | 'PENDING' {
    return status === 'APPROVED' ? 'APPROVED' : status === 'REJECTED' ? 'REJECTED' : 'PENDING';
  }

  /** Append every FTTT project (grouped by operator) to the shared Daftar Dokumen list. */
  private async appendFtttGroups(
    grouped: Record<string, DocListGroup>,
    params: { search?: string; fiberType?: string },
  ): Promise<number> {
    // Respect the fiber-type filter: FTTT rows only when filter is empty or FTTT.
    if (params.fiberType && params.fiberType !== 'FTTT') return 0;

    const where: Prisma.FtttProjectWhereInput = {};
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { projectName: { contains: q, mode: 'insensitive' } },
        {
          cleanList: {
            is: {
              OR: [
                { kelurahan: { contains: q, mode: 'insensitive' } },
                { kecamatan: { contains: q, mode: 'insensitive' } },
                { kotaKabupaten: { contains: q, mode: 'insensitive' } },
                { rwCode: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const projects = await this.prisma.ftttProject.findMany({
      where,
      include: {
        cleanList: true,
        surveyUploads: { select: { fileUrl: true } },
        drmDocuments: { select: { fileUrl: true } },
        sanggahs: { select: { fileUrl: true } },
        jaminans: { select: { fileUrl: true } },
        documents: { select: { fileUrl: true, formContent: true, approvalStatus: true } },
        implementationLogs: { select: { fileUrl: true } },
        reconDocs: { select: { fileUrl: true, formContent: true, approvalStatus: true } },
        closingLogs: { select: { fileUrl: true, formContent: true, approvalStatus: true } },
      },
      orderBy: [{ ftttCompany: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });

    for (const p of projects) {
      const groupKey = `${this.ftttCompanyLabel(p.ftttCompany)} (FTTT)`;
      if (!grouped[groupKey]) grouped[groupKey] = { ispName: groupKey, clusters: [], docCount: 0 };

      let docCount = p.triggerDocUrl ? 1 : 0;
      docCount += p.surveyUploads.filter((d) => d.fileUrl).length;
      docCount += p.drmDocuments.filter((d) => d.fileUrl).length;
      docCount += p.sanggahs.filter((d) => d.fileUrl).length;
      docCount += p.jaminans.filter((d) => d.fileUrl).length;
      docCount += p.documents.filter((d) => d.fileUrl || d.formContent).length;
      docCount += p.implementationLogs.filter((d) => d.fileUrl).length;
      docCount += p.reconDocs.filter((d) => d.fileUrl || d.formContent).length;
      docCount += p.closingLogs.filter((d) => d.fileUrl || d.formContent).length;

      const approvedDocs = [...p.documents, ...p.reconDocs, ...p.closingLogs].filter(
        (d) => d.approvalStatus === 'APPROVED',
      ).length;

      const cl = p.cleanList;
      grouped[groupKey].clusters.push({
        id: p.id,
        clusterCode: p.projectName || `FTTT-${p.id.slice(-6)}`,
        fiberType: 'FTTT',
        currentPhase: p.currentPhase,
        status: p.status,
        rwName: cl?.rwCode ?? null,
        kelurahan: cl?.kelurahan ?? null,
        kecamatan: cl?.kecamatan ?? null,
        kotaKabupaten: cl?.kotaKabupaten ?? null,
        docCount,
        approvedDocs,
        bakpStatus: null,
        claimStatus: null,
      });
      grouped[groupKey].docCount += docCount;
    }

    return projects.length;
  }

  /** Build the document-list detail payload for an FTTT project (null if id is not an FTTT project). */
  private async tryGetFtttDocumentList(projectId: string): Promise<DocumentListClusterPayload | null> {
    const p = await this.prisma.ftttProject.findUnique({
      where: { id: projectId },
      include: {
        cleanList: true,
        surveyUploads: { orderBy: { createdAt: 'asc' } },
        drmDocuments: { orderBy: { uploadedAt: 'asc' } },
        sanggahs: { orderBy: { attemptNumber: 'asc' } },
        jaminans: { orderBy: { createdAt: 'asc' } },
        documents: { orderBy: { createdAt: 'asc' } },
        implementationLogs: { orderBy: { createdAt: 'asc' } },
        reconDocs: { orderBy: { createdAt: 'asc' } },
        closingLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p) return null;

    const mk = (
      key: string,
      label: string,
      url: string | null | undefined,
      opts?: { approval?: string | null; generated?: boolean },
    ): DocumentListDocRow => {
      const available = Boolean(url) || Boolean(opts?.generated);
      return {
        key,
        label,
        url: url ?? null,
        type: opts?.generated && !url ? 'json' : this.ftttDocType(url),
        status: available ? 'AVAILABLE' : 'PENDING',
        ...(opts?.approval
          ? { approvals: { admin: this.ftttApproval(opts.approval), pm: this.ftttApproval(opts.approval) } }
          : {}),
      };
    };

    const phases: DocumentListPhaseRow[] = [];

    phases.push({
      phase: 'INITIATION', phaseNum: 1, label: 'Inisiasi',
      documents: [mk('trigger', `Dokumen Pemicu (${p.triggerDocType.replace(/_/g, ' ')})`, p.triggerDocUrl)],
    });

    if (p.surveyUploads.length) {
      phases.push({
        phase: 'SURVEY', phaseNum: 2, label: 'Survey',
        documents: p.surveyUploads.map((s, i) =>
          mk(`survey-${i}`, s.caption || s.fileType || `Survey ${i + 1}`, s.fileUrl)),
      });
    }

    const prep: DocumentListDocRow[] = [
      ...p.drmDocuments.map((d, i) => mk(`drm-${i}`, `${d.docType.replace(/_/g, ' ')} v${d.version}`, d.fileUrl)),
      ...p.sanggahs.map((s, i) => mk(`sanggah-${i}`, `Sanggah #${s.attemptNumber} (${s.status})`, s.fileUrl)),
      ...p.jaminans.map((j, i) => mk(`jaminan-${i}`, j.jaminanType.replace(/_/g, ' '), j.fileUrl)),
    ];
    if (prep.length) phases.push({ phase: 'PREPARATION', phaseNum: 3, label: 'Persiapan', documents: prep });

    if (p.implementationLogs.length) {
      phases.push({
        phase: 'IMPLEMENTATION', phaseNum: 4, label: 'Implementasi',
        documents: p.implementationLogs.map((l, i) =>
          mk(`impl-${i}`, l.caption || l.logType.replace(/_/g, ' '), l.fileUrl)),
      });
    }

    if (p.documents.length) {
      phases.push({
        phase: 'DOCUMENTATION', phaseNum: 5, label: 'Dokumentasi & Acceptance',
        documents: p.documents.map((d, i) =>
          mk(`doc-${i}`, d.docType.replace(/_/g, ' '), d.fileUrl, { approval: d.approvalStatus, generated: Boolean(d.formContent) })),
      });
    }

    if (p.reconDocs.length) {
      phases.push({
        phase: 'RECONCILIATION', phaseNum: 6, label: 'Rekonsiliasi & Billing',
        documents: p.reconDocs.map((d, i) =>
          mk(`recon-${i}`, d.docKey.replace(/_/g, ' '), d.fileUrl, { approval: d.approvalStatus, generated: Boolean(d.formContent) })),
      });
    }

    if (p.closingLogs.length) {
      phases.push({
        phase: 'CLOSING', phaseNum: 7, label: 'Project Closing',
        documents: p.closingLogs.map((d, i) =>
          mk(`closing-${i}`, d.caption || d.logType.replace(/_/g, ' '), d.fileUrl, { approval: d.approvalStatus, generated: Boolean(d.formContent) })),
      });
    }

    const allDocs = phases.flatMap((ph) => ph.documents);
    const available = allDocs.filter((d) => d.status === 'AVAILABLE').length;
    const pending = allDocs.filter((d) => d.status === 'PENDING').length;
    const approved = allDocs.filter((d) => d.approvals?.pm === 'APPROVED').length;
    const totalDocs = allDocs.length;
    const cl = p.cleanList;

    return {
      cluster: {
        id: p.id,
        clusterCode: p.projectName || `FTTT-${p.id.slice(-6)}`,
        ispCustomer: this.ftttCompanyLabel(p.ftttCompany),
        fiberType: 'FTTT',
        currentPhase: p.currentPhase,
        status: p.status,
        rwName: cl?.rwCode ?? null,
        kelurahan: cl?.kelurahan ?? null,
        kecamatan: cl?.kecamatan ?? null,
        kotaKabupaten: cl?.kotaKabupaten ?? null,
        latitude: null,
        longitude: null,
      },
      phases,
      summary: {
        totalDocs,
        available,
        pending,
        missing: 0,
        approved,
        completionPercent: totalDocs ? Math.round((available / totalDocs) * 100) : 0,
      },
    };
  }

  /** FIX: send bundle to ISP via SMTP + audit log */
  async generateEmailToIsp(
    permitClusterId: string,
    sentByUserId: string,
    options?: { message?: string; subject?: string },
  ) {
    const payload = await this.getDocumentListForCluster(permitClusterId); // FIX: fresh list
    const docUrls = this.collectDocumentUrls(payload); // FIX: link list
    return this.ispEmailService.sendDocumentsToIsp(permitClusterId, sentByUserId, {
      subject: options?.subject, // FIX
      message: options?.message, // FIX
      docUrls, // FIX
    });
  }
}
