using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class VerifyOtpDto
    {
        public string Email { get; set; } // The user's email address
        public string Otp { get; set; }
    }
}
