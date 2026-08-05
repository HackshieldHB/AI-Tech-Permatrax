/** Seed corpus for PermaTrax local RAG — all Q&A scoped to the app. */

export type SeedArticle = {
  slug: string;
  title: string;
  module: string;
  category: string;
  rolesAllowed: string[];
  sourceUri: string;
  chunks: Array<{ content: string; keywords: string }>;
};

export const PERMATRAX_KNOWLEDGE_SEED: SeedArticle[] = [
  {
    slug: 'overview-permatrax',
    title: 'Apa itu PermaTrax',
    module: 'platform',
    category: 'faq',
    rolesAllowed: [],
    sourceUri: '/guide',
    chunks: [
      {
        content:
          'PermaTrax adalah platform manajemen perizinan dan pra-konstruksi jaringan fiber (FTTH, FTTB, FTTT). Alur utama: survei lapangan → perizinan cluster → desain HLD/LLD → sosialisasi → kompensasi → dokumen legal → pelepasan konstruksi. Dilengkapi stok, procurement, cash operation, dan finance dashboard.',
        keywords:
          'permatrax permatrack apa itu aplikasi overview fiber ftth fttb fttt platform perizinan',
      },
    ],
  },
  {
    slug: 'pipeline-phases',
    title: 'Pipeline Perizinan — Tahapan',
    module: 'permit-cluster',
    category: 'sop',
    rolesAllowed: [],
    sourceUri: '/permit-clusters',
    chunks: [
      {
        content:
          'Tahapan pipeline Permit Cluster: CLUSTER_INTAKE → VISIT_REQUEST → BA_OPEN → SITE_VISIT → SURVEY_INPUT → ROUTE_SURVEY → BA_SURVEY → SIP_REQUEST → HLD_SUBMISSION → LLD_SUBMISSION → PR_BR_ISSUANCE → CONTRACT_MANAGEMENT → SKOM_BUDGET → MANAGEMENT_APPROVAL → FUND_DISBURSEMENT → BAK_GENERATION → BAKP_COMPILATION → CLAIM_SUBMISSION → INVOICE_PACKAGE → PERMIT_DONE. Status cluster: IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED.',
        keywords:
          'pipeline stage tahap phase cluster permit alur workflow next stage berikutnya',
      },
    ],
  },
  {
    slug: 'visit-request-guide',
    title: 'Cara membuat Visit Request',
    module: 'visit-request',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/clean-list',
    chunks: [
      {
        content:
          'Cara membuat Visit Request: 1) Buka menu Clean List. 2) Pilih RW/area kandidat. 3) Buat request kunjungan (Visit Request). 4) Isi kontak RT/RW/pengelola dan jadwal bila perlu. 5) Submit untuk review PM. Status mencakup DRAFT, PM_REVIEW_VISIT, APPROVED_PENDING_DATA, hingga APPROVED atau REJECTED. Surveyor biasanya memulai dari Clean List.',
        keywords:
          'visit request kunjungan cara buat membuat clean list surveyor rw',
      },
    ],
  },
  {
    slug: 'ba-open-bak-bakp',
    title: 'BA Open, BAK, dan BAKP',
    module: 'legal',
    category: 'glossary',
    rolesAllowed: [],
    sourceUri: '/permit-clusters',
    chunks: [
      {
        content:
          'BA Open: berita acara pembukaan / dokumen kunjungan awal. BAK: berita acara kesepakatan/kompensasi dengan stakeholder; PM Senior approve BAK di atas Rp 100.000. BAKP: paket dokumen terkompilasi (participants + bukti); Admin validasi BAKP, Finance dapat upload bukti transfer. Jangan menukar istilah BA Open, BA Survey, BAK, dan BAKP.',
        keywords: 'ba open bak bakp glossary berita acara kompensasi validasi',
      },
    ],
  },
  {
    slug: 'apd-hld-lld',
    title: 'APD, ABD, HLD, LLD, SIP',
    module: 'design',
    category: 'glossary',
    rolesAllowed: [],
    sourceUri: '/map',
    chunks: [
      {
        content:
          'APD: desain/route GIS untuk cluster; DRM (Design Review Meeting) di-approve PM Senior. ABD: tindak lanjut setelah APD (submit/approve ISP). SIP: tahap permintaan SIP di pipeline. HLD/LLD: High/Low Level Design — Designer upload, lalu review PM → Admin → ISP. PM membuat APD di peta GIS untuk cluster yang ditetapkan.',
        keywords: 'apd abd hld lld sip drm desain gis route designer pm senior',
      },
    ],
  },
  {
    slug: 'approval-matrix',
    title: 'Approval Matrix ringkas',
    module: 'platform',
    category: 'business-rules',
    rolesAllowed: [],
    sourceUri: '/guide',
    chunks: [
      {
        content:
          'Ringkasan approval: PM Senior approve DRM dan BAK di atas Rp 100.000. Admin validasi dokumen BAKP dan approve pipeline final. Finance proses Purchase Request dan upload bukti transfer BAKP. GM mengatur ISP customer, user, feature flag, dan monitor seluruh pipeline. Operasional Manager / Marketing Head terlibat di rantai approval Cash Operation / realisasi sesuai alur.',
        keywords:
          'approval approver limit bak drm pm senior finance admin gm siapa approve',
      },
    ],
  },
  {
    slug: 'role-guide-surveyor',
    title: 'Panduan Surveyor',
    module: 'guide',
    category: 'role-guide',
    rolesAllowed: ['SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'],
    sourceUri: '/guide',
    chunks: [
      {
        content:
          'Surveyor dapat: cek clean list dan buat request kunjungan; input data lapangan dan foto bukti; lakukan sosialisasi dan negosiasi kompensasi; upload tanda tangan RT/RW. Mulai dari menu Clean List.',
        keywords: 'surveyor panduan role guide clean list sosialisasi',
      },
    ],
  },
  {
    slug: 'role-guide-pm',
    title: 'Panduan PM',
    module: 'guide',
    category: 'role-guide',
    rolesAllowed: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR'],
    sourceUri: '/guide',
    chunks: [
      {
        content:
          'PM dapat: buat APD di peta GIS untuk cluster yang ditetapkan; submit ABD ke ISP; monitor progress permit cluster; buat order barang. PM Senior: approve DRM, approve BAK di atas Rp 100.000, monitor seluruh pipeline, akses dashboard analytics.',
        keywords: 'pm project manager panduan apd abd order drm',
      },
    ],
  },
  {
    slug: 'role-guide-finance-stock',
    title: 'Panduan Finance & Admin Stok',
    module: 'guide',
    category: 'role-guide',
    rolesAllowed: ['FINANCE', 'ADMIN_STOCK', 'PURCHASING', 'ADMIN'],
    sourceUri: '/guide',
    chunks: [
      {
        content:
          'Finance: proses permintaan pembelian dari PM, upload bukti transfer BAKP, monitor procurement — mulai dari inbox Purchase Request. Admin Stok: kelola stok (tambah/edit/sesuaikan), terima barang masuk, input surat jalan. Admin: validasi BAKP, approve pipeline final, kirim dokumen ke ISP via email.',
        keywords: 'finance stock admin stok purchase request surat jalan bakp',
      },
    ],
  },
  {
    slug: 'cash-operation-guide',
    title: 'Cash Operation',
    module: 'cash-operation',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/cash-operation',
    chunks: [
      {
        content:
          'Cash Operation dipakai untuk permintaan dana operasional / cash advance. User membuat request dengan deskripsi, amount, dan lampiran. Status: DRAFT → SUBMITTED → IN_REVIEW → APPROVED → DISBURSED (atau REJECTED). Ada alur realisasi setelah pencairan. Cek menu Cash Operation / Approval Dana sesuai role.',
        keywords:
          'cash operation cash op dana approval realisasi advance cara buat',
      },
    ],
  },
  {
    slug: 'purchase-request-stock',
    title: 'Purchase Request & Stok',
    module: 'procurement',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/purchase-requests',
    chunks: [
      {
        content:
          'Purchase Request (PR) dibuat saat stok tidak mencukupi atau butuh pembelian. Status PR: PENDING, IN_REVIEW, APPROVED, ORDERED, RECEIVED, REJECTED, CANCELLED. Order Barang dan Surat Jalan terkait alur pengadaan/pengeluaran barang.',
        keywords:
          'purchase request pr order surat jalan procurement cara buat pembelian',
      },
    ],
  },
  {
    slug: 'howto-add-stock',
    title: 'Cara menambah stok barang',
    module: 'stock',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/stock',
    chunks: [
      {
        content:
          'Cara add / tambah stock di PermaTrax: 1) Buka Sidebar → Inventaris → Stok Barang (path /stock). 2) Klik tombol Tambah Barang. 3) Isi kode, nama, kategori, qty, dan min stock. 4) Simpan. Untuk penyesuaian qty kemudian, gunakan aksi sesuaikan/edit di daftar stok. Jangan bingung dengan Purchase Request — PR dipakai untuk pengajuan pembelian, bukan untuk menambah master stok langsung.',
        keywords:
          'cara add stock tambah stok tambah barang inventaris stock item how to gimana',
      },
    ],
  },
  {
    slug: 'nav-document-list',
    title: 'Letak menu Daftar Dokumen',
    module: 'document',
    category: 'navigation',
    rolesAllowed: [],
    sourceUri: '/document-list',
    chunks: [
      {
        content:
          'Daftar Dokumen ada di Sidebar kiri → menu Dokumen → Daftar Dokumen. Path langsung: /document-list. Dari sini kamu bisa lihat dan kelola daftar dokumen proyek.',
        keywords:
          'daftar dokumen dimana di mana letak menu dokumen document list sidebar path',
      },
    ],
  },
  {
    slug: 'howto-budget-perizinan',
    title: 'Cara mengajukan budget perizinan / implementasi',
    module: 'finance-project',
    category: 'sop',
    rolesAllowed: [],
    sourceUri: '/finance-projects',
    chunks: [
      {
        content:
          'Cara ajuin / ajukan budget perizinan implementasi: 1) Pastikan Permit Cluster sudah di tahap yang butuh anggaran (mis. SKOM_BUDGET / Management Approval). 2) Buka Finance Projects atau detail cluster terkait. 3) Isi / ajukan anggaran perizinan (komponen budget perizinan / lain-lain) sesuai kebutuhan site/segment. 4) Submit untuk rantai approval (PM Senior / Management sesuai matrix). 5) Setelah disetujui, lanjut Fund Disbursement / Cash Operation bila perlu pencairan. Bukan sekadar definisi Finance Project — ini alur pengajuan anggaran operasional perizinan.',
        keywords:
          'ajuin ajukan budget perizinan implementasi cara gimana workflow sop skom anggaran',
      },
    ],
  },
  {
    slug: 'howto-cash-pengajuan',
    title: 'Cara mengajukan dana Cash Operation',
    module: 'cash-operation',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/cash-operation',
    chunks: [
      {
        content:
          'Cara ajuin dana Cash Operation: 1) Sidebar → Operasional → Cash Operation. 2) Buat request baru, isi deskripsi, amount, lampiran. 3) Submit. 4) Tunggu approval sesuai role. 5) Setelah APPROVED / DISBURSED, lengkapi realisasi bila diminta. Path: /cash-operation.',
        keywords:
          'cara ajuin ajukan dana cash operation cash op pengajuan advance',
      },
    ],
  },
  {
    slug: 'fttt-overview',
    title: 'Proyek FTTT',
    module: 'fttt',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/fttt-projects',
    chunks: [
      {
        content:
          'FTTT Project mengelola proyek fiber to the tower/area terkait dengan milestone, fund request, dokumen DRM, jaminan, span log, recon, closing, dan Daily Activity. Akses menu FTTT Projects dan Daily Activity sesuai role PM_FTTT / SURVEYOR_FTTT.',
        keywords: 'fttt project daily activity milestone fund',
      },
    ],
  },
  {
    slug: 'finance-project-guide',
    title: 'Finance Project',
    module: 'finance-project',
    category: 'user-guide',
    rolesAllowed: [],
    sourceUri: '/finance-projects',
    chunks: [
      {
        content:
          'Finance Project menyimpan anggaran proyek (totalBudget, material, jasa, perizinan/lain-lain). Status umum: ACTIVE, CLOSED, ARCHIVED. Untuk mengetahui total budget semua Finance Project aktif, tanyakan ke asisten AI atau buka menu Finance Projects. AI dapat menghitung agregat totalBudget dan spent dari database.',
        keywords:
          'finance project proyek finance total budget berapa jumlah nilai aggregate',
      },
    ],
  },
  {
    slug: 'off-topic-policy',
    title: 'Kebijakan scope chatbot',
    module: 'platform',
    category: 'policy',
    rolesAllowed: [],
    sourceUri: '/guide',
    chunks: [
      {
        content:
          'Asisten AI PermaTrax hanya menjawab pertanyaan tentang aplikasi PermaTrax: cara pakai modul, pipeline, approval, status data di sistem, stok, cash, FTTT. Jika informasi tidak ada di knowledge atau database, AI wajib bilang data tidak tersedia. AI tidak boleh mengarang.',
        keywords: 'policy scope off topic tidak tersedia hallucination',
      },
    ],
  },
];
