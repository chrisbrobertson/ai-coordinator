import { ToolName } from '../types';
import { getDefaultLeadOrder } from './registry';

export interface RoleAssignment {
  lead: ToolName;
  validators: ToolName[];
}

export function assignRoles(
  availableTools: ToolName[],
  requestedLead?: ToolName,
  requestedValidators?: ToolName[]
): RoleAssignment {
  if (availableTools.length < 2) {
    throw new Error('At least 2 AI tools required');
  }

  const uniqueAvailable = new Set(availableTools);
  let lead: ToolName | undefined = requestedLead;
  let validators: ToolName[] | undefined = requestedValidators;

  if (lead && !uniqueAvailable.has(lead)) {
    throw new Error(`Lead tool not available: ${lead}`);
  }

  if (validators) {
    for (const validator of validators) {
      if (!uniqueAvailable.has(validator)) {
        throw new Error(`Validator tool not available: ${validator}`);
      }
    }
  }

  if (!lead) {
    const preference = getDefaultLeadOrder();
    lead = preference.find((tool) => uniqueAvailable.has(tool));
  }

  if (!lead) {
    throw new Error('No lead tool available');
  }

  if (!validators) {
    validators = availableTools.filter((tool) => tool !== lead);
  }

  validators = validators.filter((tool) => tool !== lead);

  if (validators.length === 0) {
    throw new Error('At least 1 validator required');
  }

  return { lead, validators };
}
