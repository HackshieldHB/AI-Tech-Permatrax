/**
 * Knowledge QA: premise validation, multi-target composition, referents.
 * Facts are taken from existing seed knowledge — do not invent relationships.
 */

import { normalizeId } from './ai-text';
import type { ConversationSessionState } from './ai-session';

function isCausalUnsupported(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(otomatis).*(bisa dibuat|bisa dibuat kan|langsung)/.test(m) ||
    /(kalau|jika|apabila).*(selesai|sudah).*(berarti|otomatis)/.test(m) ||
    /(\bsip\b).*(otomatis|langsung).*(hld|lld|bakp)/.test(m)
  );
}

function isDefinitionOnlyQuery(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(apa itu|pengertian|definisi|jelaskan|apa bedanya|perbedaan)\b/.test(m) ||
    /\bitu apa\b/.test(m) ||
    /(digunakan untuk apa|buat apa)\b/.test(m)
  );
}

export type KnowledgeObject =
  | 'bakp'
  | 'hld_lld'
  | 'permit_cluster'
  | 'pu'
  | 'sip'
  | 'ba_docs';

export type KnowledgeRelation =
  | 'validator'
  | 'uploader'
  | 'definition'
  | 'implementation_ref'
  | 'revisable'
  | 'pic'
  | 'process'
  | 'scope'
  | 'comparison';

export type KnowledgeTarget =
  | 'permit_process'
  | 'pic_pu'
  | 'bakp_upload'
  | 'bakp_validate'
  | 'hld_lld'
  | 'permit_cluster_scope';

export type KnowledgeQaHit = {
  answer: string;
  knowledgeObject: KnowledgeObject | null;
  previousKnowledgeObject: KnowledgeObject | null;
  knowledgeRelation: KnowledgeRelation | null;
};

const FACT = {
  permitClusterNotFttt:
    'Tidak. Permit Cluster digunakan khusus untuk proses perizinan Project Type FTTH.',
  bakpSplit:
    'Tidak. Admin bertanggung jawab mengunggah/melengkapi BAKP, sedangkan validasi BAKP dilakukan oleh PM.',
  bakpValidate: 'Validasi BAKP dilakukan oleh PM.',
  bakpUpload: 'Admin.',
  bakpUploadFull: 'Admin bertanggung jawab mengunggah/melengkapi BAKP.',
  bakpBoth:
    'Admin bertanggung jawab mengunggah/melengkapi dokumen BAKP, sedangkan validasi BAKP dilakukan oleh PM.',
  bakpHold:
    'Berdasarkan knowledge PermaTrax yang tersedia, validasi BAKP dilakukan oleh PM. Admin bertanggung jawab mengunggah/melengkapi BAKP.',
  hldLldReversed:
    'Tidak. HLD (APD) merupakan rancangan awal yang masih menjadi dasar review dan revisi, sedangkan LLD (ABD) merupakan design final/blueprint yang digunakan sebagai acuan implementasi.',
  lldImpl:
    'LLD (ABD), karena merupakan blueprint/design final yang digunakan sebagai acuan implementasi.',
  hldRevise:
    'Ya. HLD (APD) merupakan rancangan awal yang masih menjadi dasar review dan revisi.',
  picPu:
    'Untuk proses perizinan PU pada Project Type FTTH, PIC/role yang bertanggung jawab adalah PM Project.',
  permitProcess:
    'Untuk melihat proses perizinan pembangunan jaringan FTTH dari awal sampai selesai, proses yang digunakan adalah Permit Cluster.',
  t35:
    'Untuk Project Type FTTH, proses perizinannya dikelola melalui Permit Cluster. PIC perizinan PU adalah PM Project, dan validasi BAKP dilakukan oleh PM.',
};

function asObj(v: string | null | undefined): KnowledgeObject | null {
  if (
    v === 'bakp' ||
    v === 'hld_lld' ||
    v === 'permit_cluster' ||
    v === 'pu' ||
    v === 'sip' ||
    v === 'ba_docs'
  ) {
    return v;
  }
  return null;
}

function hasBudgetLanguage(m: string): boolean {
  return /(budget|anggaran|\bdana\b|biaya|nominal|ajukan|ajuin|pengajuan|membayar|bayar|pencairan|skom|cash\s*op|finance project|fund disbursement)/.test(
    m,
  );
}

/** T26: false premise that Permit Cluster also applies to FTTT. */
export function isPermitClusterFtttScopePremise(text: string): boolean {
  const m = normalizeId(text);
  if (isCausalUnsupported(text)) return false;
  if (hasBudgetLanguage(m) && /(ajukan|pengajuan|membayar|cara|langkah|skom)/.test(m)) {
    return false;
  }
  if (!/permit\s*-?\s*cluster/.test(m) || !/\bfttt\b/.test(m)) return false;
  return /(juga|\bdipakai\b|\buntuk\b|\bkan\b|\bya\b|berarti|bukan)/.test(m);
}

export function isPermitProcessIdentificationQuery(text: string): boolean {
  const m = normalizeId(text);
  if (hasBudgetLanguage(m)) return false;
  if (!/(permit\s*cluster|\bizin\b|perizinan|pipeline)/.test(m)) return false;
  return (
    /(lihat proses|proses apa|harus (lihat|pakai|pake)|pakai apa|pake apa|proses yang digunakan|dari awal sampai selesai)/.test(
      m,
    ) || /(proses izin|proses perizinan).*(apa|pakai|pake|lihat)/.test(m)
  );
}

export function isKnowledgeRuleChallenge(text: string): boolean {
  const m = normalizeId(text);
  if (isCausalUnsupported(text)) return false;
  const challenge =
    /^(tapi|namun|padahal)\b/.test(m) ||
    /(setahuku|setahu saya|berarti|juga kan|kan\??$)/.test(m);
  if (!challenge) return false;
  return /(bakp|hld|lld|apd|abd|permit\s*cluster|\badmin\b|validasi|upload|unggah)/.test(
    m,
  );
}

export function detectKnowledgeTargets(text: string): KnowledgeTarget[] {
  const m = normalizeId(text);
  const out: KnowledgeTarget[] = [];
  const wantsProcess =
    isPermitProcessIdentificationQuery(text) ||
    (/(proses izin|proses perizinan|proses (yang )?(dipakai|digunakan))/.test(m) &&
      !hasBudgetLanguage(m));
  if (wantsProcess) out.push('permit_process');
  if (
    /(pic|penanggung jawab).*(pu|perizinan)|perizinan\s*pu.*(pic|siapa)|pic perizinan/.test(
      m,
    )
  ) {
    out.push('pic_pu');
  }
  const bakp = /bakp/.test(m);
  if (bakp && /(upload|unggah|melengkapi|mengunggah)/.test(m)) {
    out.push('bakp_upload');
  }
  if (bakp && /validasi/.test(m)) out.push('bakp_validate');
  if (/(apa bedanya|perbedaan).*(hld|lld)|(hld).*(lld)/.test(m)) {
    out.push('hld_lld');
  }
  if (/permit\s*cluster/.test(m) && /(fttt|ftth|dipakai|khusus)/.test(m)) {
    out.push('permit_cluster_scope');
  }
  return [...new Set(out)];
}

export function detectKnowledgeObject(
  text: string,
  session?: ConversationSessionState | null,
): KnowledgeObject | null {
  const m = normalizeId(text);
  if (/bakp/.test(m)) return 'bakp';
  if (/(hld|lld|apd|abd)/.test(m)) return 'hld_lld';
  if (/permit\s*cluster/.test(m)) return 'permit_cluster';
  if (/\bsip\b/.test(m) && !/(hld|lld|bakp)/.test(m)) return 'sip';
  if (/(ba open|\bbak\b)/.test(m) && !/bakp/.test(m)) return 'ba_docs';
  if (
    /(perizinan\s*pu|pic.*\bpu\b|\bpu\b.*pic|perizinan pu)/.test(m) ||
    (/\bpu\b/.test(m) && /(pic|perizinan|izin)/.test(m))
  ) {
    return 'pu';
  }
  if (session?.knowledgeObject) return asObj(session.knowledgeObject);
  return null;
}

function isReferentFollowUp(text: string): boolean {
  const m = normalizeId(text);
  return /(yang dipakai|yang mana|yang satunya|yang upload|yang unggah|yang validasi|yang tadi|tadi|yang sebelumnya)/.test(
    m,
  );
}

export function inferKnowledgeSession(
  text: string,
  session: ConversationSessionState,
): Pick<
  ConversationSessionState,
  'knowledgeObject' | 'previousKnowledgeObject' | 'knowledgeRelation'
> {
  const nextObj = detectKnowledgeObject(text, null);
  const prev = session.knowledgeObject;
  if (nextObj && nextObj !== prev) {
    return {
      knowledgeObject: nextObj,
      previousKnowledgeObject: prev,
      knowledgeRelation: session.knowledgeRelation,
    };
  }
  if (nextObj) {
    return {
      knowledgeObject: nextObj,
      previousKnowledgeObject: asObj(session.previousKnowledgeObject),
      knowledgeRelation: session.knowledgeRelation,
    };
  }
  return {
    knowledgeObject: session.knowledgeObject,
    previousKnowledgeObject: asObj(session.previousKnowledgeObject),
    knowledgeRelation: session.knowledgeRelation,
  };
}

export function isKnowledgeQaCandidate(
  text: string,
  session?: ConversationSessionState | null,
  lastAssistant?: string | null,
): boolean {
  if (isCausalUnsupported(text)) return false;
  if (isPermitClusterFtttScopePremise(text)) return true;
  const targets = detectKnowledgeTargets(text);
  if (targets.length > 1) return true;
  if (isPermitProcessIdentificationQuery(text)) return true;
  if (isKnowledgeRuleChallenge(text)) return true;
  if (isKnownPremise(text)) return true;
  if (isReferentFollowUp(text) && (session?.knowledgeObject || /bakp|hld|lld|apd|abd/.test(normalizeId(text)))) {
    return true;
  }
  if (
    session?.knowledgeObject &&
    /^(tapi|namun|padahal)\b/.test(normalizeId(text)) &&
    /(admin|pm|hld|lld)/.test(normalizeId(text))
  ) {
    return true;
  }
  if (
    /validasi bakp/.test(normalizeId(lastAssistant || '')) &&
    /^tapi\b/.test(normalizeId(text)) &&
    /admin/.test(normalizeId(text))
  ) {
    return true;
  }
  return false;
}

function isKnownPremise(text: string): boolean {
  const m = normalizeId(text);
  if (isCausalUnsupported(text)) return false;
  if (isPermitClusterFtttScopePremise(text)) return true;
  if (
    /admin/.test(m) &&
    /bakp/.test(m) &&
    /(upload|unggah)/.test(m) &&
    /validasi/.test(m)
  ) {
    return true;
  }
  if (
    /lld/.test(m) &&
    /hld/.test(m) &&
    /(rancangan awal|implementasi)/.test(m) &&
    /(berarti|kan|ya)/.test(m)
  ) {
    return true;
  }
  return false;
}

function reversedHldLld(text: string): boolean {
  const m = normalizeId(text);
  const lldAsInitial = /lld/.test(m) && /(rancangan awal|initial|desain awal)/.test(m);
  const hldAsImpl = /hld/.test(m) && /(implementasi|acuan implementasi|blueprint)/.test(m);
  return lldAsInitial && hldAsImpl;
}

export function resolveKnowledgeQa(input: {
  text: string;
  session: ConversationSessionState;
  lastAssistant?: string | null;
}): KnowledgeQaHit | null {
  const { text, session, lastAssistant } = input;
  if (isCausalUnsupported(text)) return null;
  if (isPermitClusterFtttScopePremise(text)) {
    return {
      answer: FACT.permitClusterNotFttt,
      knowledgeObject: 'permit_cluster',
      previousKnowledgeObject: asObj(session.knowledgeObject),
      knowledgeRelation: 'scope',
    };
  }
  if (isDefinitionOnlyQuery(text) && !isKnownPremise(text) && detectKnowledgeTargets(text).length <= 1) {
    return null;
  }

  const m = normalizeId(text);
  const targets = detectKnowledgeTargets(text);
  const inferred = inferKnowledgeSession(text, session);

  if (targets.includes('permit_process') && targets.includes('pic_pu') && (targets.includes('bakp_validate') || /bakp/.test(m))) {
    return {
      answer: FACT.t35,
      knowledgeObject: 'bakp',
      previousKnowledgeObject: 'pu',
      knowledgeRelation: 'process',
    };
  }

  if (targets.includes('bakp_upload') && targets.includes('bakp_validate')) {
    if (/admin/.test(m) && /(berarti|kan|juga|ya)/.test(m)) {
      return {
        answer: FACT.bakpSplit,
        knowledgeObject: 'bakp',
        previousKnowledgeObject: asObj(session.knowledgeObject),
        knowledgeRelation: 'validator',
      };
    }
    return {
      answer: FACT.bakpBoth,
      knowledgeObject: 'bakp',
      previousKnowledgeObject: asObj(session.previousKnowledgeObject),
      knowledgeRelation: 'validator',
    };
  }

  if (isPermitProcessIdentificationQuery(text) && targets.length <= 1) {
    return {
      answer: FACT.permitProcess,
      knowledgeObject: 'permit_cluster',
      previousKnowledgeObject: asObj(session.knowledgeObject),
      knowledgeRelation: 'process',
    };
  }

  if (reversedHldLld(text)) {
    return {
      answer: FACT.hldLldReversed,
      knowledgeObject: 'hld_lld',
      previousKnowledgeObject: asObj(session.knowledgeObject),
      knowledgeRelation: 'comparison',
    };
  }

  if (
    /admin/.test(m) &&
    /bakp/.test(m) &&
    /(upload|unggah)/.test(m) &&
    /validasi/.test(m)
  ) {
    return {
      answer: FACT.bakpSplit,
      knowledgeObject: 'bakp',
      previousKnowledgeObject: asObj(session.knowledgeObject),
      knowledgeRelation: 'validator',
    };
  }

  const lastWasBakp =
    session.knowledgeObject === 'bakp' ||
    /validasi bakp/.test(normalizeId(lastAssistant || ''));
  if (
    lastWasBakp &&
    /admin/.test(m) &&
    (isKnowledgeRuleChallenge(text) || /^(tapi|namun)\b/.test(m))
  ) {
    return {
      answer: FACT.bakpHold,
      knowledgeObject: 'bakp',
      previousKnowledgeObject: asObj(session.previousKnowledgeObject),
      knowledgeRelation: 'validator',
    };
  }

  if (/bakp/.test(m) && /(tadi|yang tadi)/.test(m) && /(upload|unggah)/.test(m)) {
    return {
      answer: FACT.bakpUploadFull,
      knowledgeObject: 'bakp',
      previousKnowledgeObject: asObj(session.knowledgeObject),
      knowledgeRelation: 'uploader',
    };
  }

  const obj =
    detectKnowledgeObject(text, session) ||
    (isReferentFollowUp(text) ? session.knowledgeObject : null);

  if ((obj === 'pu' || targets.includes('pic_pu')) && /(pic|siapa|penanggung)/.test(m)) {
    return {
      answer: FACT.picPu,
      knowledgeObject: 'pu',
      previousKnowledgeObject:
        session.knowledgeObject === 'pu'
          ? asObj(session.previousKnowledgeObject)
          : asObj(session.knowledgeObject),
      knowledgeRelation: 'pic',
    };
  }

  if (obj === 'hld_lld' || session.knowledgeObject === 'hld_lld') {
    if (/(yang satunya|direvisi|masih bisa di)/.test(m)) {
      return {
        answer: FACT.hldRevise,
        knowledgeObject: 'hld_lld',
        previousKnowledgeObject: asObj(session.previousKnowledgeObject),
        knowledgeRelation: 'revisable',
      };
    }
    if (/(acuan implementasi|yang dipakai|yang mana)/.test(m) && !/hld.*(lld)|apa bedanya/.test(m)) {
      return {
        answer: FACT.lldImpl,
        knowledgeObject: 'hld_lld',
        previousKnowledgeObject: asObj(session.previousKnowledgeObject),
        knowledgeRelation: 'implementation_ref',
      };
    }
  }

  if (obj === 'bakp' || session.knowledgeObject === 'bakp') {
    if (/(yang upload|yang unggah|kalau yang upload)/.test(m) && !/validasi/.test(m)) {
      return {
        answer: FACT.bakpUpload,
        knowledgeObject: 'bakp',
        previousKnowledgeObject: asObj(session.previousKnowledgeObject),
        knowledgeRelation: 'uploader',
      };
    }
    if (/(yang validasi|siapa.*(validasi))/.test(m) && !/(upload|unggah)/.test(m)) {
      return {
        answer: FACT.bakpValidate,
        knowledgeObject: 'bakp',
        previousKnowledgeObject: asObj(session.previousKnowledgeObject),
        knowledgeRelation: 'validator',
      };
    }
  }

  if (targets.includes('pic_pu')) {
    return {
      answer: FACT.picPu,
      knowledgeObject: 'pu',
      previousKnowledgeObject: asObj(inferred.previousKnowledgeObject),
      knowledgeRelation: 'pic',
    };
  }

  return null;
}
