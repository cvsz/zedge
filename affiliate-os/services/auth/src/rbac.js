/** Every action maps to one permission, checked on the server for each call. Roles live in the database per organization. */
export const PERMISSIONS = {
  read: 'View everything in the organization',
  'catalog.write': 'Create and edit brands, channels, products and offers',
  'campaigns.write': 'Create and edit campaigns; lower a campaign autonomy level',
  'content.write': 'Create and edit content and creatives',
  'links.write': 'Create, disable and retire tracked links',
  'publish.schedule': 'Schedule or queue content for publishing',
  'approvals.decide': 'Approve or reject requests made by someone else',
  'autonomy.raise': 'Apply an approved increase of a campaign autonomy level',
  'users.admin': 'Manage members and roles',
  'audit.read': 'Read and verify the audit log'
};
export const can = (perms, perm) => perms.includes('*') || perms.includes(perm);
export const validPermissions = (list) => Array.isArray(list) && list.length > 0 && list.length <= 40 && list.every((p) => p in PERMISSIONS);
export const AUTONOMY = ['MANUAL', 'DRAFT_ONLY', 'APPROVAL_REQUIRED', 'AUTO_PUBLISH_APPROVED_TEMPLATES', 'AUTONOMOUS_WITH_POLICY'];
