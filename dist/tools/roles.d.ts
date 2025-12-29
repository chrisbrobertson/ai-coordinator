import { ToolName } from '../types.js';
export interface RoleAssignment {
    lead: ToolName;
    validators: ToolName[];
}
export declare function assignRoles(availableTools: ToolName[], requestedLead?: ToolName, requestedValidators?: ToolName[]): RoleAssignment;
