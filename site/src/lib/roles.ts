import { loadRecord } from './record';

/**
 * Whether a role is performed, as opposed to written or produced. The kinds
 * come from the registry (data/schema/properties.yaml, `creation roles`)
 * through the derived record. Contribution roles never substitute for
 * separately sourced unqualified billing.
 */
export const performs = (role: unknown): boolean => typeof role === 'string' && loadRecord().roles[role] === 'performance';
