export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function notFound(kind, id) {
  return new HttpError(404, `${kind} '${id}' non trovato`);
}

export function unprocessable(message) {
  return new HttpError(422, message);
}
