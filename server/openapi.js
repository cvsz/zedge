export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Zedge API',
    version: '1.0.0',
    description: 'Self-hosted Cloudflare control panel API spec'
  },
  paths: {
    '/api/session': {
      get: {
        summary: 'Get current session state',
        responses: {
          '200': { description: 'Session information' }
        }
      }
    },
    '/api/login': {
      post: {
        summary: 'Log in with username and password',
        responses: {
          '200': { description: 'Successfully authenticated' },
          '401': { description: 'Invalid credentials' }
        }
      }
    },
    '/api/meta': {
      get: {
        summary: 'Get account metadata and token status',
        responses: {
          '200': { description: 'Metadata response' }
        }
      }
    },
    '/api/domains': {
      post: {
        summary: 'Add a new domain / zone',
        responses: {
          '201': { description: 'Zone created' }
        }
      }
    }
  }
};
