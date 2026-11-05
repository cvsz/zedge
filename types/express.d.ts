// The auth middleware attaches the signed-in user to the request.
declare global {
  namespace Express {
    interface Request { user?: any }
  }
}
export {};
