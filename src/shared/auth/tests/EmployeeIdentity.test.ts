import { mapToEmployeeIdentity } from '../EmployeeIdentity';

describe('mapToEmployeeIdentity', () => {
  it('maps sub to principalId and includes email when present', () => {
    const identity = mapToEmployeeIdentity({
      sub: 'synthetic-subject-123',
      email: 'medewerker@nijmegen.nl',
    });

    expect(identity).toEqual({
      principalId: 'synthetic-subject-123',
      email: 'medewerker@nijmegen.nl',
    });
  });

  it('maps sub to principalId with email undefined when the email claim is absent', () => {
    const identity = mapToEmployeeIdentity({
      sub: 'synthetic-subject-123',
    });

    expect(identity).toEqual({
      principalId: 'synthetic-subject-123',
      email: undefined,
    });
  });

  it('never uses email as principalId', () => {
    const identity = mapToEmployeeIdentity({
      sub: 'synthetic-subject-123',
      email: 'medewerker@nijmegen.nl',
    });

    expect(identity.principalId).not.toBe(identity.email);
    expect(identity.principalId).toBe('synthetic-subject-123');
  });

  it('throws when the sub claim is missing', () => {
    expect(() => mapToEmployeeIdentity({ email: 'medewerker@nijmegen.nl' } as any))
      .toThrow('ID token is missing the sub claim');
  });

  it('throws when the sub claim is an empty string', () => {
    expect(() => mapToEmployeeIdentity({ sub: '' }))
      .toThrow('ID token is missing the sub claim');
  });

  it('throws when the sub claim is not a string', () => {
    expect(() => mapToEmployeeIdentity({ sub: 12345 } as any))
      .toThrow('ID token is missing the sub claim');
  });

  it('ignores a non-string email claim rather than trusting it', () => {
    const identity = mapToEmployeeIdentity({ sub: 'synthetic-subject-123', email: 12345 as any });

    expect(identity.email).toBeUndefined();
  });
});
