import { actionFromMethod, buildActivityDescription, buildEntityHref } from './activity-description';

describe('activity-description', () => {
  it('builds financial request create text', () => {
    const text = buildActivityDescription('POST', '/api/fttt-projects/abc/transactions', {
      siteName: 'Site A',
      category: 'PERIZINAN',
      amount: 1500000,
    });
    expect(text).toContain('Create Financial Request Perizinan');
    expect(text).toContain('"Site A"');
    expect(text).toContain('Rp1.500.000');
  });

  it('builds daily log upload text', () => {
    const text = buildActivityDescription(
      'POST',
      '/api/fttt-projects/abc/spans/xyz/logs',
      { siteName: 'Site A' },
    );
    expect(text).toBe('Upload Daily Log for "Site A"');
  });

  it('maps approve action', () => {
    expect(actionFromMethod('POST', '/api/fttt-projects/x/transactions/y/accept')).toBe('APPROVE');
  });

  it('builds href for fttt project', () => {
    expect(
      buildEntityHref('/api/fttt-projects/proj1/transactions', { ftttProjectId: 'proj1' }),
    ).toBe('/fttt-projects/proj1');
  });
});
