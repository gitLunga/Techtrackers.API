using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model;

namespace TechTrackers.Service
{

    public class UserOtpService : IUserService
    {
        private readonly TechTrackersDbContext _context;

        public UserOtpService(TechTrackersDbContext context)
        {
            _context = context;
        }

        public async Task<User?> GetUserByEmail(string email)
        {
            return await _context.Users.FirstOrDefaultAsync(u => u.EmailAddress == email);
        }

        public async Task ResetPassword(User user, string newPassword)
        {
            user.PasswordHash = newPassword;  //  for now I'm Storing plain text password (use user.Password instead if no PasswordHash field)
            await _context.SaveChangesAsync();
        }
    }
}
