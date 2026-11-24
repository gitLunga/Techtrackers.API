/**
 * src/services/mail.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old code had EmailService.cs AND MailServices.cs, and CollabController
 *   did `var mailService = new MailServices();` — constructing it by hand inside
 *   a controller, bypassing DI entirely. SMTP credentials were also committed to
 *   appsettings.json in plain text.
 *
 * WHAT IT ACHIEVES
 *   One mail module, credentials from the environment, and a development mode:
 *   when SMTP_HOST is empty, emails are logged to the console rather than sent.
 *   That means you can exercise the whole password-reset flow locally — and read
 *   the OTP straight from the terminal — without any mail account at all.
 *
 *   Sending never throws into the caller. A ticket must not fail to be created
 *   because a mail server was briefly unreachable.
 */
import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../config/logger.js';

let transporter = null;

function getTransporter() {
  if (!env.mailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function send({ to, subject, text, html }) {
  const mailer = getTransporter();

  if (!mailer) {
    // Development fallback — the message body, including OTP codes, is printed
    // so local flows are fully testable without a mail provider.
    logger.info(`[MAIL:CONSOLE] To: ${to} | Subject: ${subject}\n${text}`);
    return { delivered: false, console: true };
  }

  try {
    const info = await mailer.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
    logger.info(`Email sent to ${to} (${info.messageId})`);
    return { delivered: true, messageId: info.messageId };
  } catch (error) {
    // Logged, never rethrown: mail is a side effect, not the transaction.
    logger.error(`Failed to send email to ${to}: ${error.message}`);
    return { delivered: false, error: error.message };
  }
}

export function sendOtpEmail({ to, code, ttlMinutes }) {
  return send({
    to,
    subject: 'Techtrackers password reset code',
    text:
      `Your Techtrackers one-time code is ${code}.\n\n` +
      `It expires in ${ttlMinutes} minutes. If you did not request a password reset, ignore this email.`,
    html:
      `<p>Your Techtrackers one-time code is <strong style="font-size:20px">${code}</strong>.</p>` +
      `<p>It expires in ${ttlMinutes} minutes. If you did not request a password reset, ignore this email.</p>`,
  });
}

export function sendCollaborationInvite({ to, inviteeName, requesterName, logReference, logTitle, message }) {
  return send({
    to,
    subject: `Collaboration request on ticket ${logReference}`,
    text:
      `Hello ${inviteeName},\n\n${requesterName} has asked you to collaborate on ticket ` +
      `${logReference}: "${logTitle}".\n${message ? `\nMessage: ${message}\n` : ''}\n` +
      `Sign in to Techtrackers to accept or decline.`,
  });
}

export function sendAssignmentEmail({ to, technicianName, logReference, logTitle, priority, dueAt }) {
  return send({
    to,
    subject: `You have been assigned ticket ${logReference}`,
    text:
      `Hello ${technicianName},\n\nYou have been assigned ticket ${logReference}: "${logTitle}".\n` +
      `Priority: ${priority}\nResolution due: ${dueAt}\n\nSign in to Techtrackers to begin work.`,
  });
}

export default { sendOtpEmail, sendCollaborationInvite, sendAssignmentEmail };
