using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data.Model;
using TechTrackers.Data;
using Microsoft.EntityFrameworkCore;

namespace TechTrackers.Service
{

    public class OTPService : IOTPService
    {
        private readonly TechTrackersDbContext _context;

        public OTPService(TechTrackersDbContext context)
        {
            _context = context;
        }

        public string GenerateOtp()
        {
            var random = new Random();
            return random.Next(1000, 9999).ToString();
        }

        public async Task SaveOtp(string email, string otp)
        {
            var userOtp = new UserOtp
            {
                UserEmail = email,
                OtpCode = otp,
                Expiration = DateTime.UtcNow.AddMinutes(5), // Set expiration as needed
                IsValid = true
            };
            _context.User_Otps.Add(userOtp);
            await _context.SaveChangesAsync();
        }

        public async Task<bool> ValidateOtp(string email, string otp)
        {
            var storedOtp = await _context.User_Otps
                .Where(o => o.UserEmail == email && o.IsValid && o.Expiration > DateTime.UtcNow)
                .OrderByDescending(o => o.Expiration) // If multiple, get the latest
                .FirstOrDefaultAsync();

            if (storedOtp == null || storedOtp.OtpCode != otp)
            {
                return false;
            }

            // Mark OTP as used
            /*storedOtp.IsValid = false;
            await _context.SaveChangesAsync();*/

            return true;
        }

        public async Task InvalidateOtp(string email, string otp)
        {
            var storedOtp = await _context.User_Otps
                .Where(o => o.UserEmail == email && o.OtpCode == otp && o.IsValid)
                .FirstOrDefaultAsync();

            if (storedOtp != null)
            {
                storedOtp.IsValid = false;
                await _context.SaveChangesAsync();
            }
        }
    }
}
