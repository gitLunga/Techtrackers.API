using MailKit.Net.Smtp;
using MimeKit;
using System.Threading.Tasks;

namespace TechTrackers.Service
{
    public class MailServices
    {
        public async Task SendCollaborationEmail(string toEmail, string toName, string issueTitle)
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress("TechTrackers", "no-reply@techtrackers.com"));
            message.To.Add(new MailboxAddress(toName, toEmail));
            message.Subject = $"New Collaboration Request: {issueTitle}";

            message.Body = new TextPart("html")
            {
                Text = $@"
                <p>Hi {toName},</p>
                <p>You have been invited to collaborate on the issue titled <strong>{issueTitle}</strong>.</p>
                <p>Please log into TechTrackers to accept or decline the request.</p>"
            };

            using var client = new SmtpClient();
            await client.ConnectAsync("smtp.ethereal.email", 587, MailKit.Security.SecureSocketOptions.StartTls);
            await client.AuthenticateAsync("breanne.weber81@ethereal.email", "7VNNUS1tXrmp21dt4H");
            await client.SendAsync(message);
            await client.DisconnectAsync(true);
        }
    }
}
