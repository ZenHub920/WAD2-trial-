/** SMTP only. Credentials and token-bearing bodies never enter logs or an outbox. */
export function createSmtpMailer(config = process.env, { createTransport } = {}) {
  const host = config.SMTP_HOST;
  const from = config.SMTP_FROM;
  const configured = Boolean(host && from && config.SMTP_USER && config.SMTP_PASS);
  let transport;
  return {
    configured,
    async send({ to, subject, text }) {
      if (!configured) return false;
      if (typeof to !== 'string' || /[\r\n]/.test(to) || /[\r\n]/.test(from)) return false;
      const port = Number(config.SMTP_PORT ?? 587);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
      if (!transport) {
        const factory = createTransport ?? (await import('nodemailer')).default.createTransport;
        transport = factory({
          host, port, secure: port === 465,
          // Remote SMTP must upgrade to TLS. This is not configurable off.
          requireTLS: port !== 465,
          auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
          tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
          connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
          disableFileAccess: true, disableUrlAccess: true,
        });
      }
      await transport.sendMail({ from, to, subject, text, disableFileAccess: true, disableUrlAccess: true });
      return true;
    },
    close() { transport?.close?.(); },
  };
}
