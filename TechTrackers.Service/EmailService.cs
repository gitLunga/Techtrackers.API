using MailKit.Net.Smtp;
using MimeKit;
using Microsoft.Extensions.Configuration;
using System;
using System.Threading.Tasks;

namespace TechTrackers.Service
{
    public class EmailService : IEmailService
    {
        private readonly IConfiguration _config;

        public EmailService(IConfiguration config)
        {
            _config = config;
        }

        public async Task SendOtpEmail(string toEmail, string otp)
        {
            try
            {
                var emailMessage = new MimeMessage();
                emailMessage.From.Add(new MailboxAddress("TechTrackers Support", _config["Ethereal:SenderEmail"]));
                emailMessage.To.Add(new MailboxAddress("", toEmail));
                emailMessage.Subject = "Your OTP Code";
                emailMessage.Body = new TextPart("plain")
                {
                    Text = $"Your OTP code is {otp}. Please use this code to reset your password."
                };

                using var smtpClient = new SmtpClient();
                Console.WriteLine("Connecting to SMTP server...");
                await smtpClient.ConnectAsync(_config["Ethereal:SmtpServer"], int.Parse(_config["Ethereal:Port"]), MailKit.Security.SecureSocketOptions.StartTls);
                await smtpClient.AuthenticateAsync(_config["Ethereal:Username"], _config["Ethereal:Password"]);

                Console.WriteLine("Sending email...");
                await smtpClient.SendAsync(emailMessage);
                await smtpClient.DisconnectAsync(true);

                Console.WriteLine("Email sent successfully!");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error sending OTP email: {ex.Message}");
                throw;
            }
        }
    }
}
