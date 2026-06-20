using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Service
{
    public interface IOTPService
    {
        string GenerateOtp();
        Task SaveOtp(string email, string otp);
        Task<bool> ValidateOtp(string email, string otp);
        // Task<string> GetOtp(string email);
        Task InvalidateOtp(string email, string otp);
    }
}
