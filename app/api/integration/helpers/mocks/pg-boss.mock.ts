export class PgBoss {
  async start() {}
  async stop() {}
  async unschedule(_name: string) {}
  async createQueue(_name: string) {}
  async schedule(_name: string, _cron: string, _data: unknown, _opts?: unknown) {}
  async work(_name: string, _handler: unknown) {}
}
