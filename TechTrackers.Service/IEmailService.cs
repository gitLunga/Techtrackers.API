using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Service
{
    public interface IEmailService
    {
        Task SendOtpEmail(string toEmail, string otp);
    }

}
