import { BAKP_ALL_DOCS, BAKP_KOMPENSASI_DOCS, BAKP_KOORDINASI_DOCS, BAKP_MANDATORY_KEYS } from './bakp.constants';

describe('BAKP dokumen constants', () => {
  it('memiliki 11 dokumen kompensasi mandatory', () => {
    expect(BAKP_KOMPENSASI_DOCS).toHaveLength(11);
    expect(BAKP_KOMPENSASI_DOCS.every((doc) => doc.mandatory)).toBe(true);
  });

  it('memiliki 6 dokumen koordinasi optional', () => {
    expect(BAKP_KOORDINASI_DOCS).toHaveLength(6);
    expect(BAKP_KOORDINASI_DOCS.every((doc) => !doc.mandatory)).toBe(true);
  });

  it('set mandatory sinkron dengan dokumen kompensasi', () => {
    const mandatoryKeys = BAKP_KOMPENSASI_DOCS.map((doc) => doc.key);
    mandatoryKeys.forEach((key) => expect(BAKP_MANDATORY_KEYS.has(key)).toBe(true));
    expect(BAKP_ALL_DOCS).toHaveLength(17);
  });
});
