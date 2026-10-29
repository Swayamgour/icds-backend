// Small typed error so services can signal 400/403/404 without touching req/res.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

module.exports = { HttpError };
