/** Every action in the console maps to exactly one of these permissions. */
export const PERMISSIONS = {
  read: 'View zones, DNS, settings, rules, Workers, storage, Zero Trust and email',
  'domains.write': 'Add domains and request activation checks',
  'dns.write': 'Create, edit and delete DNS records; bulk origin update',
  'zone.write': 'Zone settings, DNSSEC and cache purge',
  'security.write': 'Security level, WAF custom rules and IP access rules',
  'rules.write': 'Rate limits, managed rulesets, redirects, cache rules and page rules',
  'workers.write': 'Deploy and roll back Workers; variables and secrets',
  'r2.write': 'Create buckets; upload and delete objects; lifecycle and CORS',
  'zerotrust.write': 'Tunnels, Access apps and policies, device posture, Gateway',
  'email.write': 'Email routing and DMARC',
  'tokens.read': 'List API tokens',
  'tokens.write': 'Create, roll and revoke API tokens',
  'audit.read': 'View the Cloudflare account audit log and the console audit log',
  'users.admin': 'Manage console users and roles'
};

export const BUILTIN_ROLES = {
  admin: ['*'],
  operator: ['read', 'domains.write', 'dns.write', 'zone.write', 'security.write', 'rules.write', 'email.write'],
  viewer: ['read']
};

export const can = (perms, perm) => perms.includes('*') || perms.includes(perm);
export const validPermissions = (list) => Array.isArray(list) && list.every((p) => p in PERMISSIONS);
