export class LeadsError extends Error {
  constructor(code, status = 403, fields = []) {
    super(`Design preview: ${code}`);
    this.name = "LeadsError"; this.code = code; this.status = status; this.fields = fields;
  }
}
