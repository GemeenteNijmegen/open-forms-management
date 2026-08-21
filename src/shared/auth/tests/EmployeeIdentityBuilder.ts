import { EmployeeIdentity } from '../EmployeeIdentity';

export function anEmployeeIdentity(overrides: Partial<EmployeeIdentity> = {}): EmployeeIdentity {
  return {
    principalId: 'employee-1',
    email: 'medewerker@nijmegen.nl',
    ...overrides,
  };
}
